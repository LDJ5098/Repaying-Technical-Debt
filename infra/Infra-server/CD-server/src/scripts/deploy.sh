#!/bin/sh
set -e

IMAGE="ghcr.io/ldj5098/iot-security-architecture-configure/backend"
COMPOSE_FILE="/infra-server/docker-compose.yml"
IMAGE_TAG="${1:-latest}"  # 인자로 tag 받음, 없으면 latest

echo ">> 배포 이미지: ${IMAGE}:${IMAGE_TAG}"

echo ">> docker-compose 이미지 태그 적용..."
IMAGE_TAG="${IMAGE_TAG}" docker compose -f "${COMPOSE_FILE}" up -d --no-build backend

echo ">> 배포 완료"