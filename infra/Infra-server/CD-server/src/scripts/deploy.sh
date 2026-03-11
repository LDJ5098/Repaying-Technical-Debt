#!/bin/sh
set -e

IMAGE="ghcr.io/ldj5098/iot-security-architecture-configure/backend"
IMAGE_TAG="${1:-latest}"
COMPOSE_FILE="/infra-server/docker-compose-infra.yml"
COMPOSE_FILE_SUB="/infra-server/docker-compose-sub.yml"

echo ">> 배포 시작 (Tag: ${IMAGE_TAG})"
docker pull ${IMAGE}:${IMAGE_TAG}

echo ">> 1. 이미지에서 최신 파일 추출 중..."
TEMP_CONTAINER=$(docker create ${IMAGE}:${IMAGE_TAG})

docker cp ${TEMP_CONTAINER}:/app/. /infra-server/backend/
docker rm ${TEMP_CONTAINER}

echo ">> 로컬 폴더(OS) 최신화 완료!"

echo ">> 2. 백엔드 컨테이너 갱신 중..."
# --force-recreate와 --no-deps로 깔끔하게 백엔드만 교체!
docker compose -f "${COMPOSE_FILE}" -f "${COMPOSE_FILE_SUB}" up -d --force-recreate --no-deps backend

echo ">> 배포 완료"