#!/bin/sh
set -e

IMAGE="ghcr.io/$GITHUB_REPO/backend"
IMAGE_TAG="${1:-latest}"
COMPOSE_FILE="/infra-server/infra-compose.yml"
BACKEND_DIR="/infra-server/backend/"

echo ">> 배포 시작 (Tag: ${IMAGE_TAG})"
PULL_START=$(date +%s)
docker pull ${IMAGE}:${IMAGE_TAG}
PULL_END=$(date +%s)
echo ">> pull 시간: $((PULL_END - PULL_START))초"

#배포
export BACKEND_IMAGE_TAG="${IMAGE_TAG}"
docker compose -f "${COMPOSE_FILE}" up -d --no-deps backend

#이미지 파일 로컬 백업
echo ">> 1. 이미지에서 최신 파일 추출 중..."
TEMP_CONTAINER=$(docker create ${IMAGE}:${IMAGE_TAG})

docker cp ${TEMP_CONTAINER}:/app/. "${BACKEND_DIR}"
docker rm ${TEMP_CONTAINER}

echo ">> 로컬 폴더(infra-server/backend) 최신화 완료!"