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

// 수락된 job의 정보 보관
const pendingTokens  = new Map<string, { token: string; type: 'backend' | 'dev'; runId: string | null }>();
// timerlock 카운트다운 타이머 보관
const timelockTimers = new Map<string, NodeJS.Timeout>();

// ─── 헬퍼 ────────────────────────────────────────────────────────────────

const updateInteraction = async (token: string, content: string, components: any[] = []) => {
  await rest.patch(Routes.webhookMessage(DISCORD_APP_ID, token), {
    body: { content, components },
  });
};

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

// ─── 카운트다운 ───────────────────────────────────────────────────────────

const clearTimelockTimer = (jobId: string) => {
  const existing = timelockTimers.get(jobId);
  if (existing) {
    clearInterval(existing);
    timelockTimers.delete(jobId);
  }
};

const startCountdown = async (jobId: string, token: string, seconds: number, prefix: string) => {
  clearTimelockTimer(jobId);

  let remaining = seconds;
  await updateInteraction(token, `⏱️ ${prefix}${remaining}초 후 배포가 시작됩니다.`);

  const interval = setInterval(async () => {
    remaining -= 1;
    if (remaining <= 0) {
      clearTimelockTimer(jobId);
      return;
    }
    try {
      await updateInteraction(token, `⏱️ ${prefix}${remaining}초 후 배포가 시작됩니다.`);
    } catch (err) {
      console.error(`카운트다운 업데이트 실패 (job_id: ${jobId}):`, err);
      clearTimelockTimer(jobId);
    }
  }, 1000);

  timelockTimers.set(jobId, interval);
};

// ─── 배포 요청 ───────────────────────────────────────────────────────────

const handleDeploy = async (
  interaction: any,
  type: 'backend' | 'dev',
  runId: string | null,
) => {
  const jobId = randomUUID();
  const token = interaction.token as string;

  await interaction.update({ content: '🔄 배포 서버에 연결 중...', components: [] });

  try {
    const { data } = await axios.post(`${CD_SERVER_URL}/deploy`, {
      run_id:       runId,
      type,
      job_id:       jobId,
      callback_url: `${BOT_CALLBACK_URL}/callback`,
    });

    if (data.status === 'blocked') {
      await updateInteraction(token, '🚫 관리자가 점검중입니다.', [retryRow(type, runId)]);
    } else {
      pendingTokens.set(jobId, { token, type, runId });
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
    const [, type, rawRunId] = customId.split('_');
    const runId = rawRunId === 'null' ? null : rawRunId;
    await handleDeploy(interaction, type as 'backend' | 'dev', runId);
  }
});

// ─── CD server 콜백 수신 ─────────────────────────────────────────────────

const TERMINAL_EVENTS = new Set(['deploy_complete', 'deploy_failed', 'job_deleted']);

app.post('/callback', async (req, res) => {
  const { job_id, event, data } = req.body;
  console.log(`콜백 수신 (job_id: ${job_id}, event: ${event})`);
  res.json({ ok: true });

  const pending = pendingTokens.get(job_id);
  if (!pending) {
    console.warn(`토큰 없음 (job_id: ${job_id})`);
    return;
  }

  const { token, type, runId } = pending;

  try {
    switch (event) {
      case 'queue_update':
        await updateInteraction(token, `⏳ 배포 대기열에 진입했습니다. (대기: ${data.position})`);
        break;

      case 'timerlock_start':
        await startCountdown(job_id, token, data.seconds, '');
        break;

      case 'timerlock_update':
        await startCountdown(job_id, token, data.seconds, '대기 시간이 수정되어, 다시 ');
        break;

      case 'timerlock_resume':
        await startCountdown(job_id, token, data.seconds, '남은 ');
        break;

      case 'paused':
        clearTimelockTimer(job_id);
        await updateInteraction(token, '⏸️ 배포가 일시정지 되었습니다.');
        break;

      case 'deploy_start':
        clearTimelockTimer(job_id);
        await updateInteraction(token, `🚀 ${data.label} 배포를 시작합니다...`);
        break;

      case 'deploy_complete':
        await updateInteraction(token, `✅ ${data.label} 배포 완료`);
        break;

      case 'deploy_failed':
        await updateInteraction(token, `❌ ${data.label} 배포 실패: ${data.error}`, [retryRow(type, runId)]);
        break;

      case 'job_deleted':
        clearTimelockTimer(job_id);
        await updateInteraction(token, '🗑️ 관리자가 배포를 삭제했습니다.');
        break;
    }
  } catch (err) {
    console.error(`인터랙션 업데이트 실패 (job_id: ${job_id}):`, err);
  }

  if (TERMINAL_EVENTS.has(event)) {
    clearTimelockTimer(job_id);
    pendingTokens.delete(job_id);
  }
});

// ─── 서버 시작 ────────────────────────────────────────────────────────────

client.login(DISCORD_TOKEN);
app.listen(3000, () => console.log('Discord Bot 서버 시작 (port 3000)'));