#!/bin/sh
set -e

DEVICE_DIR="/Infra-c-client-device"
SERVER_DIR="/Infra-server"
COMPOSE_FILE="/Infra-server/infra-compose.yml"

# 필수 환경 변수 체크 (GITHUB_TOKEN, GITHUB_REPO가 필요함)
if [ -z "$GITHUB_TOKEN" ] || [ -z "$GITHUB_REPO" ]; then
    echo ">> Error : GITHUB_TOKEN 또는 GITHUB_REPO 환경 변수가 없습니다."
    exit 1
fi

BASE_API="https://api.github.com/repos/$GITHUB_REPO/contents"

AUTH_HEADER="Authorization: token $GITHUB_TOKEN"
ACCEPT_HEADER="Accept: application/vnd.github.v3.raw"

echo ">> GitHub에서 최신 소스 코드 다운로드 시작..."

# Device 관련 파일
echo ">> Device 파일 다운로드 중..."
curl -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" -L \
     "$BASE_API/Dev/Dev-c-client-device/device.c?ref=main" \
     -o "$DEVICE_DIR/device.c"

curl -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" -L \
     "$BASE_API/Dev/Dev-c-client-device/Dockerfile?ref=main" \
     -o "$DEVICE_DIR/Dockerfile"

curl -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" -L \
     "$BASE_API/Dev/Dev-c-client-device/docker-compose.yml?ref=main" \
     -o "$DEVICE_DIR/docker-compose.yml"

# Server(Mosquitto) 관련 파일
echo ">> Server 파일 다운로드 중..."
curl -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" -L \
     "$BASE_API/Dev/Dev-server/mosquitto/docker-entrypoint.sh?ref=main" \
     -o "$SERVER_DIR/mosquitto/docker-entrypoint.sh"

sed -i 's/\r$//' "$SERVER_DIR/mosquitto/docker-entrypoint.sh"
chmod +x "$SERVER_DIR/mosquitto/docker-entrypoint.sh"

echo ">> 다운로드 완료. 컨테이너 빌드 및 재시작..."

# Mosquitto 서비스
docker compose -f "${COMPOSE_FILE}" up -d --force-recreate --no-deps mqtt
# Device 서비스
docker compose -f "${DEVICE_DIR}/docker-compose.yml" up -d --build

echo ">> [성공] Dev 배포가 완료되었습니다."