import mqtt from 'mqtt';
import { PrismaClient } from '@prisma/client';

// Prisma DB 연결 객체 생성
const prisma = new PrismaClient();

// MQTT 브로커 연결 (포트는 환경변수에서 읽음, 같은 compose-net 안이라 컨테이너 이름으로 접근)
const mqttPort = process.env.MQTT_INT_PORT;
const client = mqtt.connect(`mqtt://mqtt-broker:${mqttPort}`);

// 브로커 연결 성공 시
client.on('connect', () => {
  console.log('MQTT 브로커 연결 성공');

  // device/data 토픽 구독 시작
  client.subscribe('device/data', (err) => {
    if (err) {
      console.error('구독 실패:', err);
    } else {
      console.log('device/data 토픽 구독 중');
    }
  });
});

// 메시지 수신 시 (DB 저장이 비동기라 async 사용)
client.on('message', async (topic, message) => {
  const raw = message.toString();
  console.log(`수신: ${raw}`);

  // "ID:hostname / CODE:xxxxx" 형식에서 hostname과 code 추출
  const match = raw.match(/ID:(\S+) \/ CODE:(\S+)/);
  if (!match) {
    console.error('파싱 실패:', raw);
    return;
  }

  const device_id = match[1]; // hostname
  const code = match[2];      // 랜덤코드

  try {
    // DeviceLog 테이블에 저장 (저장 완료까지 대기)
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    await prisma.deviceLog.create({
      data: { device_id, code, created_at: kst }
    });
    console.log(`DB 저장 완료 - device_id: ${device_id}, code: ${code}`);

    // 저장 완료 후 C클라이언트에 응답 발행
    client.publish('device/response', `ACK:${device_id}`);
    console.log(`응답 발행 완료 - ACK:${device_id}`);

  } catch (err) {
    // DB 저장 실패 시 에러 출력 (C클라이언트는 타임아웃으로 처리됨)
    console.error('DB 저장 실패:', err);
  }
});

// MQTT 연결 에러 처리
client.on('error', (err) => {
  console.error('MQTT 에러:', err);
});