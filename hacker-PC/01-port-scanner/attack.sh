#!/bin/sh

TARGET="host.docker.internal"

echo "========================================"
echo " [*] STEP 1: 호스트 전체 포트 스캔"
echo "========================================"
SCAN_RESULT=$(nmap -p 1-10000 "$TARGET")
echo "$SCAN_RESULT"

# 열린 포트 번호만 추출
OPEN_PORTS=$(echo "$SCAN_RESULT" | grep "^[0-9]*/tcp.*open" | awk -F'/' '{print $1}')

echo ""
echo "========================================"
echo " [*] STEP 2: 열린 포트 MQTT 브로커 확인"
echo "========================================"

#mqtt-subscribe 스크립트를 모든 포트에서 동작하도록 수정

MQTT_PORTS=""

for PORT in $OPEN_PORTS; do
  echo " [*] 포트 $PORT 확인 중..."

  RESPONSE=$(printf '\x10\x0d\x00\x04\x4d\x51\x54\x54\x04\x02\x00\x3c\x00\x01\x2d' | nc -w 3 "$TARGET" "$PORT" 2>/dev/null | od -An -tx1 | tr -d ' \n')

  PREFIX=$(echo "$RESPONSE" | cut -c1-4)
  BYTE3=$(echo "$RESPONSE" | cut -c5-6)
  BYTE4=$(echo "$RESPONSE" | cut -c7-8)
  PREVIEW="$(echo "$RESPONSE" | cut -c1-12)..."

  if [ "$PREFIX" = "2002" ] && { [ "$BYTE3" = "00" ] || [ "$BYTE3" = "01" ]; } && [ "$BYTE4" -le "05" ] 2>/dev/null; then
    echo " [+] 성공: 포트 $PORT → MQTT 확인 ($PREVIEW)"
    MQTT_PORTS="$MQTT_PORTS $PORT"
  else
    echo " [-] 실패: 포트 $PORT → MQTT 아님 ($PREVIEW)"
  fi
done