#!/bin/sh
set -e

IMAGE="ghcr.io/$GITHUB_REPO/backend"
IMAGE_TAG="${1:-latest}"
COMPOSE_FILE="/mnt/d/작업/프로그램 개발/IoT-Security-Architecture-Configure/infra/Infra-server/infra-compose.yml"
BACKEND_DIR="/mnt/d/작업/프로그램 개발/IoT-Security-Architecture-Configure/infra/Infra-server/backend"

echo ">> 배포 시작 (Tag: ${IMAGE_TAG})"
docker pull ${IMAGE}:${IMAGE_TAG}

echo ">> 1. 이미지에서 최신 파일 추출 중..."
TEMP_CONTAINER=$(docker create ${IMAGE}:${IMAGE_TAG})

docker cp ${TEMP_CONTAINER}:/app/. "${BACKEND_DIR}"
docker rm ${TEMP_CONTAINER}

echo ">> 로컬 폴더(Infra-server/backend) 최신화 완료!"

echo ">> 2. 백엔드 컨테이너 갱신 중..."

export BACKEND_IMAGE_TAG="${IMAGE_TAG}"

docker compose -f "${COMPOSE_FILE}" up -d --force-recreate --no-deps backend

echo ">> 배포 완료"