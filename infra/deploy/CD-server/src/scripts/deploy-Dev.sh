#!/bin/sh
set -e

DEVICE_DIR="/Infra-c-client-device"
SERVER_DIR="/Infra-server"

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
curl --fail -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" -L \
     "$BASE_API/Dev/Dev-c-client-device/device.c?ref=main" \
     -o "$DEVICE_DIR/device.c"

curl --fail -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" -L \
     "$BASE_API/Dev/Dev-c-client-device/Dockerfile?ref=main" \
     -o "$DEVICE_DIR/Dockerfile"

curl --fail -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" -L \
     "$BASE_API/Dev/Dev-c-client-device/docker-compose.yml?ref=main" \
     -o "$DEVICE_DIR/docker-compose.yml"

# Server(Mosquitto) 관련 파일
echo ">> Server 파일 다운로드 중..."
curl --fail -H "$AUTH_HEADER" -H "$ACCEPT_HEADER" -L \
     "$BASE_API/Dev/Dev-server/mosquitto/docker-entrypoint.sh?ref=main" \
     -o "$SERVER_DIR/mosquitto/docker-entrypoint.sh"

echo ">> 다운로드 완료. 컨테이너 빌드 및 재시작..."
# Device 서비스
cd "$DEVICE_DIR"
docker compose up -d --build
# Mosquitto 서비스
cd "$SERVER_DIR"
docker compose -f infra-compose.yml up -d --no-deps mqtt

echo ">> [성공] Dev 배포가 완료되었습니다."