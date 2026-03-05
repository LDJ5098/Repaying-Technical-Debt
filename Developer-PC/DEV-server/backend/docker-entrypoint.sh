#!/bin/sh

# DB healthy 상태 확인 후 마이그레이션 실행 (depends_on healthcheck로 보장됨)
npx prisma db push

# 백엔드 시작
exec npm run start