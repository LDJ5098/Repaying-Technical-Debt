#!/bin/bash
set -e

TOKEN="${GITHUB_TOKEN}"
REPO="${GITHUB_REPO}"
BRANCH="main"

INFRA_SERVER_DIR="/Infra-server"
INFRA_CLIENT_DIR="/Infra-c-client-device"

echo ">> 배포 시작"

echo ">> Client Device 관련..."
curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
     -L "https://raw.githubusercontent.com/${REPO}/${BRANCH}/Dev/Dev-c-client-device/device.c" \
     -o "${INFRA_CLIENT_DIR}/device.c"
curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
     -L "https://raw.githubusercontent.com/${REPO}/${BRANCH}/Dev/Dev-c-client-device/Dockerfile" \
     -o "${INFRA_CLIENT_DIR}/Dockerfile"
curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
     -L "https://raw.githubusercontent.com/${REPO}/${BRANCH}/Dev/Dev-c-client-device/docker-compose.yml" \
     -o "${INFRA_CLIENT_DIR}/docker-compose.yml"

echo ">> Mosquitto 관련..."
curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
     -L "https://raw.githubusercontent.com/${REPO}/${BRANCH}/Dev/Dev-server/mosquitto/docker-entrypoint.sh" \
     -o "${INFRA_SERVER_DIR}/mosquitto/docker-entrypoint.sh"

curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
     -L "https://raw.githubusercontent.com/${REPO}/${BRANCH}/Dev/Dev-server/mosquitto/Dockerfile" \
     -o "${INFRA_SERVER_DIR}/mosquitto/Dockerfile"

# 권한 설정
chmod +x "${INFRA_SERVER_DIR}/mosquitto/docker-entrypoint.sh"

#배포
docker compose -f "${INFRA_CLIENT_DIR}/docker-compose.yml" up -d --build

docker compose -f "${INFRA_SERVER_DIR}/infra-compose.yml" up -d --no-deps --build mqtt