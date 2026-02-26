# 🚀 IoT Legacy Renewal: Security & Communication

기존 PHP 기반 IoT 시스템의 보안 취약점을 분석하고, MQTT와 Node.js를 활용하여 보안이 강화된 양방향 통신 시스템으로 현대화합니다.
Notion : https://www.notion.so/267853f47a35805d846de6e32330b352?source=copy_link

## 1. 🔍 Legacy 문제점
- DB 접속 정보 평문 노출 및 SQL Injection 위험.
- HTTP 프로토콜 사용으로 인한 통신 오버헤드.

## 🏗️ 2. 신규 아키텍처
- **Client:** C (MQTT Pub/Sub)
- **Broker:** Mosquitto
- **Server:** Node.js (Business Logic & MySQL)
- **Storage:** MySQL (Data), Local File (System Log)

## 🎯 3. 주요 시나리오
1. C 클라이언트가 10자 이내 문자열 전송.
2. 서버에서 데이터 가공 후 에코(Echo) 메시지 반환.
3. 데이터베이스 백업 및 시스템 로그 기록.
