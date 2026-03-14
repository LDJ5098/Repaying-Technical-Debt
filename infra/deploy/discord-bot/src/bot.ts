import express from 'express';
import axios from 'axios';
import { randomUUID } from 'crypto';
import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

const app = express();
app.use(express.json());

const DISCORD_TOKEN    = process.env.DISCORD_TOKEN!;
const DISCORD_APP_ID   = process.env.DISCORD_APP_ID!;
const CD_SERVER_URL    = process.env.CD_SERVER_URL!;
const BOT_CALLBACK_URL = process.env.BOT_CALLBACK_URL!;

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

// 수락된 job의 interaction token 보관
const pendingTokens = new Map<string, string>();

// ─── 헬퍼 ────────────────────────────────────────────────────────────────

const updateInteraction = async (token: string, content: string, components: any[] = []) => {
  await rest.patch(Routes.webhookMessage(DISCORD_APP_ID, token), {
    body: { content, components },
  });
};

// 거절 시 재시도/취소 버튼 (customId에 type, runId 인코딩)
const retryRow = (type: string, runId: string | null) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`retry_${type}_${runId ?? 'null'}`)
      .setLabel('재시도')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('cancel_deploy')
      .setLabel('취소')
      .setStyle(ButtonStyle.Danger),
  ).toJSON();

const parseRunId = (desc: string | null): string | null => {
  if (!desc) return null;
  return desc.match(/\*\*Run ID:\*\* (\d+)/)?.[1] ?? null;
};

// ─── 배포 요청 ───────────────────────────────────────────────────────────

const handleDeploy = async (
  interaction: any,
  type: 'backend' | 'dev',
  runId: string | null,
) => {
  const jobId = randomUUID();
  const token = interaction.token as string;

  // 3초 이내 응답 (Discord 요구사항)
  await interaction.update({ content: '🔄 배포 서버에 연결 중...', components: [] });

  try {
    const { data } = await axios.post(`${CD_SERVER_URL}/deploy`, {
      run_id:       runId,
      type,
      job_id:       jobId,
      callback_url: `${BOT_CALLBACK_URL}/callback`,
    });

    if (data.status === 'blocked') {
      // 거절 — bot은 더 이상 이 job 추적하지 않음, 재시도 버튼 표시
      await updateInteraction(token, '🚫 관리자가 점검중입니다.', [retryRow(type, runId)]);

    } else {
      // 수락 — 이후 상태는 콜백으로만 수신
      pendingTokens.set(jobId, token);
      const msg = data.position === 0
        ? '🔄 배포를 준비 중입니다...'
        : `⏳ 배포 대기열에 진입했습니다. (대기: ${data.position})`;
      await updateInteraction(token, msg);
    }

  } catch (err: any) {
    await updateInteraction(token, `❌ 배포 서버 연결 실패: ${err.message}`);
  }
};

// ─── Discord 클라이언트 ──────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, () => {
  console.log(`Discord 시작: ${client.user?.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  const { customId } = interaction;
  console.log('버튼 클릭:', customId);

  const desc = (interaction.message as Message).embeds[0]?.description ?? null;

  if (customId === 'approve_backend') {
    await handleDeploy(interaction, 'backend', parseRunId(desc));

  } else if (customId === 'approve_dev') {
    await handleDeploy(interaction, 'dev', parseRunId(desc));

  } else if (customId === 'reject_backend') {
    await interaction.update({ content: '❌ Backend 배포 거부됨.', components: [] });

  } else if (customId === 'reject_dev') {
    await interaction.update({ content: '❌ Dev 배포 거부됨.', components: [] });

  } else if (customId === 'cancel_deploy') {
    await interaction.update({ content: '❌ 배포가 취소되었습니다.', components: [] });

  } else if (customId.startsWith('retry_')) {
    // retry_${type}_${runId|null}
    const [, type, rawRunId] = customId.split('_');
    const runId = rawRunId === 'null' ? null : rawRunId;
    await handleDeploy(interaction, type as 'backend' | 'dev', runId);
  }
});

// ─── CD server 콜백 수신 ─────────────────────────────────────────────────

// 이 이벤트들은 job의 생명주기를 종료시킴
const TERMINAL_EVENTS = new Set(['deploy_complete', 'deploy_failed', 'job_deleted']);

app.post('/callback', async (req, res) => {
  const { job_id, event, data } = req.body;
  console.log(`콜백 수신 (job_id: ${job_id}, event: ${event})`);
  res.json({ ok: true }); // CD server가 블로킹되지 않도록 즉시 응답

  const token = pendingTokens.get(job_id);
  if (!token) {
    console.warn(`토큰 없음 (job_id: ${job_id})`);
    return;
  }

  try {
    switch (event) {
      case 'queue_update':
        await updateInteraction(token, `⏳ 배포 대기열에 진입했습니다. (대기: ${data.position})`);
        break;
      case 'timerlock_start':
        await updateInteraction(token, `⏱️ ${data.seconds}초 후 배포가 시작됩니다.`);
        break;
      case 'timerlock_update':
        await updateInteraction(token, `⏱️ 배포 대기 시간이 수정되어 ${data.seconds}초 후 배포가 시작됩니다.`);
        break;
      case 'timerlock_resume':
        await updateInteraction(token, `▶️ 남은 ${data.seconds}초 후 배포가 진행됩니다.`);
        break;
      case 'paused':
        await updateInteraction(token, '⏸️ [차단] 배포가 닫혀 일시정지 합니다.');
        break;
      case 'deploy_start':
        await updateInteraction(token, `🚀 ${data.label} 배포를 시작합니다...`);
        break;
      case 'deploy_complete':
        await updateInteraction(token, `✅ ${data.label} 배포 완료`);
        break;
      case 'deploy_failed':
        await updateInteraction(token, `❌ ${data.label} 배포 실패: ${data.error}`);
        break;
      case 'job_deleted':
        await updateInteraction(token, '🗑️ 관리자가 배포를 삭제했습니다.');
        break;
    }
  } catch (err) {
    console.error(`인터랙션 업데이트 실패 (job_id: ${job_id}):`, err);
  }

  if (TERMINAL_EVENTS.has(event)) {
    pendingTokens.delete(job_id);
  }
});

// ─── 서버 시작 ────────────────────────────────────────────────────────────

client.login(DISCORD_TOKEN);
app.listen(3000, () => console.log('Discord Bot 서버 시작 (port 3000)'));