import express from 'express';
import axios from 'axios';
import {
  Client,
  GatewayIntentBits,
  Events,
  Message
} from 'discord.js';

const app = express();
app.use(express.json());

const DISCORD_TOKEN = process.env.DISCORD_TOKEN!;
const CD_SERVER_URL = process.env.CD_SERVER_URL!;
const CD_DEV_SERVER_URL = process.env.CD_DEV_SERVER_URL!;

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, () => {
  console.log(`Discord Bot 시작: ${client.user?.tag}`);
});

// embed description에서 run_id 파싱
const parseRunId = (description: string | null): string | null => {
  if (!description) return null;
  const match = description.match(/\*\*Run ID:\*\* (\d+)/);
  return match ? match[1] : null;
};

client.on(Events.InteractionCreate, async (interaction) => {
  console.log('인터랙션 수신:', interaction.type);  // 추가
  if (!interaction.isButton()) return;
  console.log('버튼 클릭:', interaction.customId);  // 추가

  const { customId } = interaction;
  const message = interaction.message as Message;
  const description = message.embeds[0]?.description ?? null;
  const runId = parseRunId(description);

  if (customId === 'approve_backend') {
    await interaction.update({ content: '✅ Backend 배포 승인됨. 검증 중...', components: [] });
    try {
      await axios.post(`${CD_SERVER_URL}/deploy`, { run_id: runId, type: 'backend' });
      await interaction.editReply({ content: '✅ Backend 배포 완료' });
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Backend 배포 실패: ${err.response?.data?.error || err.message}` });
    }

  } else if (customId === 'reject_backend') {
    await interaction.update({ content: '❌ Backend 배포 거부됨.', components: [] });

  } else if (customId === 'approve_dev') {
    await interaction.update({ content: '✅ Dev 배포 승인됨. 검증 중...', components: [] });
    try {
      await axios.post(`${CD_DEV_SERVER_URL}/deploy`, { run_id: runId, type: 'dev' });
      await interaction.editReply({ content: '✅ Dev 배포 완료' });
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Dev 배포 실패: ${err.response?.data?.error || err.message}` });
    }

  } else if (customId === 'reject_dev') {
    await interaction.update({ content: '❌ Dev 배포 거부됨.', components: [] });
  }
});

client.login(DISCORD_TOKEN);

app.listen(3000, () => {
  console.log('Discord Bot 서버 시작 (port 3000)');
});