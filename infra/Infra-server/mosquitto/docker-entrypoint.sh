#!/bin/sh
cat > /tmp/mosquitto-runtime.conf << EOF

# 평문 포트 (내부망 backend 전용, 외부 노출 X)
listener ${MQTT_INT_PORT} 0.0.0.0
allow_anonymous true

# TLS 포트 (mTLS 적용)
listener ${MQTT_TLS_INT_PORT} 0.0.0.0
allow_anonymous true
require_certificate true

cafile /mosquitto/certs/ca.crt
certfile /mosquitto/certs/server.crt
keyfile /mosquitto/certs/server.key

log_dest file /mosquitto/log/mosquitto.log
log_type all
EOF
exec mosquitto -c /tmp/mosquitto-runtime.conf