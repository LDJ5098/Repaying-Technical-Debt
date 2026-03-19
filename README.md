# 🛡️ IoT Security Architecture Configure

과거 '저전력 스마트 표지판' 프로젝트의 보안 결함과 기술 부채를 청산하고,
위협 시나리오 기반 설계로 현대적인 IoT 보안 아키텍처를 구축한 1인 프로젝트입니다.

- Notion : 

## 1. 📖 소개
- 기간 : 2026.02.22 ~ 2026.02.22
- 패킷 탈취, 비인가 접속, 인증서 강탈 등 핵심 공격 시나리오를 먼저 정의하고, 직접 재현한 뒤 방어하는 위협 주도 설계(Threat-Driven Design) 방식으로 아키텍처를 구성했습니다.

## 2. 🔍 배경 (Legacy 문제점)
- **[부하]** IoT 환경에 부적합한 HTTP 통신 사용 (무거운 헤더로 인한 리소스 낭비)
- **[보안]** SSH 기본 포트(22) 방치 → Brute Force 공격에 취약
- **[보안]** DB 접속 정보 소스코드 내 평문 하드코딩 → 코드 유출 시 DB 탈취 위험
- **[보안]** SQL Injection 방어 로직 부재 → 악의적 구문 주입 및 데이터 파괴 위험
- **[보안]** 클라이언트-서버 간 평문(JSON) 전송 → 패킷 탈취 시 내용 노출

## 3. 🏗️ 기술 스택
- **Client :** C (IoT 저전력 단말 시뮬레이션)
- **Broker :** Mosquitto (MQTT, mTLS + PKI + ACL 적용)
- **Server :** Node.js + TypeScript + Prisma ORM
- **Storage :** MariaDB (데이터), Docker Volume (로그)
- **Infra :** Docker, Docker Compose
- **CI/CD :** GitHub Actions, GHCR

## 4. 🎯 주요 기능

### 신뢰 기반 통신 (mTLS + PKI + ACL)
- mTLS로 서버-클라이언트 상호 인증 및 전송 구간 암호화
- PKI로 기기별 인증서 개별 발급, 탈취 시 해당 인증서만 폐기(CRL)하여 피해 최소화
- ACL로 인증서 CN 기준 접근 가능 토픽을 제한, 강탈 시 피해 범위 차단

### 3단계 배포 보안 프로세스
1. **타임락 (Time-Lock)** : 배포 즉시 실행 대신 n초 대기, 관리자에게 Discord 알림 전송
2. **비동기 승인 (Human-in-the-Loop)** : 보안팀(C)이 Discord에서 코드 검수 후 승인 버튼으로 타임락 해제
3. **상호 배제 (Mutual Exclusion)** : 관리자(A) SSH 접속 시 배포봇(B)·보안팀(C) 세션 즉시 강제 종료

### 개발 / 실전 환경 분리
- `Dev/` : 기능 테스트, 코드 디버깅, 공격 시나리오 실행
- `infra/` : 실제 운영 서버 및 단말 (보안 자산 절대 분리)
- 개발용 CI/CD와 실전용 CI/CD를 독립 구축하여 환경 격리