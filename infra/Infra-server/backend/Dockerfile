FROM node:20-slim

WORKDIR /app

# Prisma 실행에 필요한 OpenSSL 설치
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# 라이브러리 목록 먼저 복사 후 설치 (소스코드 변경 시 재설치 방지)
COPY package*.json ./
RUN npm install

# Prisma 스키마 복사 후 클라이언트 자동 생성
COPY prisma ./prisma
RUN npx prisma generate

# 나머지 소스코드 복사
COPY . .

# TypeScript → JavaScript 컴파일
RUN npm run build

# entrypoint 스크립트 복사 및 실행 권한 부여
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

CMD ["/docker-entrypoint.sh"]