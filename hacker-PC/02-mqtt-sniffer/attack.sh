#!/bin/sh

#PORT="5098" #(평문 포트)
PORT="9883" #(TLS포트)

echo "========================================"
echo " [*] MQTT 평문 데이터 탈취 시작(tshark)"
echo " [!] 대상 포트: $PORT"
echo " [!] 종료: Ctrl+C"
echo "========================================"

#tshark -p -l -i eth0 -d tcp.port==$PORT,mqtt -Y "mqtt.msg" -x
tshark -p -l -i eth0 -f "tcp port $PORT" -x