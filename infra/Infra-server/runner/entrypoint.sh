#!/bin/bash
set -e

REPO_URL="${REPO_URL}"
RUNNER_NAME="${RUNNER_NAME}"
ACCESS_TOKEN="${ACCESS_TOKEN}"
RUNNER_WORKDIR="${RUNNER_WORKDIR:-/tmp/runner}"
LABELS="${LABELS:-self-hosted}"

# 필수 환경변수 체크
if [[ -z "${REPO_URL}" || -z "${ACCESS_TOKEN}" || -z "${RUNNER_NAME}" ]]; then
  echo "ERROR: REPO_URL, ACCESS_TOKEN, RUNNER_NAME 은 필수입니다."
  exit 1
fi

# REPO_URL에서 owner/repo 추출
REPO_PATH=$(echo "${REPO_URL}" | sed 's|https://github.com/||')

echo ">> PAT으로 Runner Registration Token 발급 중..."
REG_TOKEN=$(curl -s -X POST \
  -H "Authorization: token ${ACCESS_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO_PATH}/actions/runners/registration-token" \
  | jq -r .token)

if [[ -z "${REG_TOKEN}" || "${REG_TOKEN}" == "null" ]]; then
  echo "ERROR: Registration Token 발급 실패. ACCESS_TOKEN 또는 REPO_URL을 확인하세요."
  exit 1
fi

echo ">> Runner 등록 중..."
cd /home/runner
./config.sh \
  --url "${REPO_URL}" \
  --token "${REG_TOKEN}" \
  --name "${RUNNER_NAME}" \
  --work "${RUNNER_WORKDIR}" \
  --labels "${LABELS}" \
  --unattended \
  --replace

# 종료 시 Runner 자동 해제
cleanup() {
  echo ">> Runner 해제 중..."
  ./config.sh remove --token "${REG_TOKEN}"
}
trap cleanup SIGINT SIGTERM EXIT

echo ">> Runner 시작..."
./run.sh