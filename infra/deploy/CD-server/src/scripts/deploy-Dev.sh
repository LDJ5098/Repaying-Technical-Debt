#!/bin/bash
set -e

# 환경 변수는 CD 서버(Node.js) 프로세스에서 그대로 상속받습니다.
TOKEN="${GITHUB_TOKEN}"
REPO="${GITHUB_REPO}"
BRANCH="main"

# deploy-compose.yml에 정의된 볼륨 마운트 경로
INFRA_SERVER_DIR="/Infra-server"
INFRA_CLIENT_DIR="/Infra-c-client-device"

echo ">> [Dev 배포] 인수 없이 내부 설정에 따라 파일 동기화 시작"

echo ">> Client Device 관련 파일 다운로드 중..."
curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
     -L "https://raw.githubusercontent.com/${REPO}/${BRANCH}/Dev/Dev-c-client-device/device.c" \
     -o "${INFRA_CLIENT_BASE}/device.c"
curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
     -L "https://raw.githubusercontent.com/${REPO}/${BRANCH}/Dev/Dev-c-client-device/Dockerfile" \
     -o "${INFRA_CLIENT_BASE}/Dockerfile"
curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
     -L "https://raw.githubusercontent.com/${REPO}/${BRANCH}/Dev/Dev-c-client-device/docker-compose.yml" \
     -o "${INFRA_CLIENT_BASE}/docker-compose.yml"

# --- Mosquitto 관련 파일 동기화 ---
echo ">> Mosquitto 관련 파일 다운로드 중..."
curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
     -L "https://raw.githubusercontent.com/${REPO}/${BRANCH}/Dev/Dev-server/mosquitto/docker-entrypoint.sh" \
     -o "${INFRA_SERVER_BASE}/mosquitto/docker-entrypoint.sh"

# 권한 설정
chmod +x "${INFRA_SERVER_BASE}/mosquitto/docker-entrypoint.sh"

echo ">> 인프라 서비스 재빌드 및 재시작..."
cd "${INFRA_CLIENT_DIR}"
docker compose up -d --build

echo ">> [Dev 배포] 완료"