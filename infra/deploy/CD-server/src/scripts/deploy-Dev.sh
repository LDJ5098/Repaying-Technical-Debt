#!/bin/sh
set -e
set -x

TOKEN="${GITHUB_TOKEN}"
REPO="${GITHUB_REPO}"
BRANCH="main"

INFRA_SERVER_DIR="/infra-server"
INFRA_CLIENT_DIR="/infra-c-client-device"
COMPOSE_FILE="/infra-server/infra-compose.yml"
# 호스트 경로(Dev-c-client-device/docker-compose.yml 전용)
HOST_INFRA_CLIENT_DIR="${HOST_INFRA_CLIENT_DIR:-/d/작업/프로그램 개발/IoT-Security-Architecture-Configure/infra/infra-c-client-device}"

RAW_BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"

echo ">> 배포 시작"

echo ">> Client Device 관련..."
curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
     -L "${RAW_BASE}/Dev/Dev-c-client-device/device.c" \
     -o "${INFRA_CLIENT_DIR}/device.c"
curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
     -L "${RAW_BASE}/Dev/Dev-c-client-device/Dockerfile" \
     -o "${INFRA_CLIENT_DIR}/Dockerfile"
curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
     -L "${RAW_BASE}/Dev/Dev-c-client-device/docker-compose.yml" \
     -o "${INFRA_CLIENT_DIR}/docker-compose.yml"

sed -i "s|\.:/app|${HOST_INFRA_CLIENT_DIR}:/app|g" \
    "${INFRA_CLIENT_DIR}/docker-compose.yml"



echo ">> Mosquitto 관련..."
# GitHub API로 mosquitto 디렉토리 전체 파일 목록 조회
MOSQUITTO_PATHS=$(curl -s \
  -H "Authorization: token ${TOKEN}" \
  "https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1" \
  | grep '"path"' \
  | grep 'Dev/Dev-server/mosquitto/' \
  | sed 's/.*"path": *"//;s/".*//')

for FULL_PATH in $MOSQUITTO_PATHS; do
  REL_PATH="${FULL_PATH#Dev/Dev-server/mosquitto/}"
  DEST="${INFRA_SERVER_DIR}/mosquitto/${REL_PATH}"
  mkdir -p "$(dirname "$DEST")"
  curl -s -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github.v3.raw" \
       -L "${RAW_BASE}/${FULL_PATH}" \
       -o "$DEST"
  echo "   - ${REL_PATH} 다운로드 완료"
done

# 권한 설정
chmod +x "${INFRA_SERVER_DIR}/mosquitto/docker-entrypoint.sh"

#배포
docker compose -f "${COMPOSE_FILE}" up -d --no-deps --build mqtt

docker compose -f "${INFRA_CLIENT_DIR}/docker-compose.yml" up -d --build