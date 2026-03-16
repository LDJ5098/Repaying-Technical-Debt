import mqtt from 'mqtt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const mqttPort = process.env.MQTT_INT_PORT;
const client = mqtt.connect(`mqtt://mqtt-broker:${mqttPort}`);

client.on('connect', () => {
  console.log('MQTT 브로커 연결 성공');

  // 모든 기기 토픽 구독
  client.subscribe('device/+/data', (err) => {
    if (err) {
      console.error('구독 실패:', err);
    } else {
      console.log('device/+/data 토픽 구독 중');
    }
  });
});

client.on('message', async (topic, message) => {
  const raw = message.toString();
  console.log(`수신: ${raw}`);

  // 토픽에서 device_id 추출 (device/{device_id}/data)
  const topicMatch = topic.match(/^device\/(.+)\/data$/);
  if (!topicMatch) {
    console.error('토픽 파싱 실패:', topic);
    return;
  }
  const device_id = topicMatch[1];

  // 메인 Data에서 code 추출
  const match = raw.match(/CODE:(\S+)/);
  if (!match) {
    console.error('데이터 파싱 실패:', raw);
    return;
  }
  const code = match[1];

  try {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    await prisma.deviceLog.create({
      data: { device_id, code, created_at: kst }
    });
    console.log(`DB 저장 완료 - device_id: ${device_id}, code: ${code}`);

    // 응답 토픽도 device_id 기반으로 발행
    client.publish(`device/${device_id}/response`, `ACK:${device_id}`);
    console.log(`응답 발행 완료 - ACK:${device_id}`);

  } catch (err) {
    console.error('DB 저장 실패:', err);
  }
});

client.on('error', (err) => {
  console.error('MQTT 에러:', err);
});