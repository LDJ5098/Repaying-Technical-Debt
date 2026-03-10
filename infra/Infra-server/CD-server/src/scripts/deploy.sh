#!/bin/sh
set -e

IMAGE="ghcr.io/ldj5098/iot-security-architecture-configure/backend"
IMAGE_TAG="${1:-latest}"
COMPOSE_FILE="/infra-server/docker-compose-infra.yml"
COMPOSE_FILE_SUB="/infra-server/docker-compose-sub.yml"

echo ">> 배포 시작 (Tag: ${IMAGE_TAG})"

echo ">> 1. 이미지에서 최신 파일 추출 및 동기화 중..."
docker run --rm \
  -v "$(pwd)/backend:/target" \
  ${IMAGE}:${IMAGE_TAG} \
  cp -a /app/. /target/

echo ">> 파일 동기화 완료!"

# 2. 컨테이너 갱신
echo ">> 2. 백엔드 컨테이너 갱신 중..."
export TAG_FOR_BACKEND="${IMAGE_TAG}"

docker compose -f "${COMPOSE_FILE}" -f "${COMPOSE_FILE_SUB}" pull backend

docker compose -f "${COMPOSE_FILE}" -f "${COMPOSE_FILE_SUB}" up -d --force-recreate --no-deps backend

echo ">> 배포 완료"