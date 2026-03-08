MAIN = docker-compose.yml
SUB = docker-compose-sub.yml

#전체 실행 (c-client + runner)
up:
	docker compose -f $(MAIN) -f $(SUB) up

#전체 실행 (c-client + runner)
up-d:
	docker compose -f $(MAIN) -f $(SUB) up -d

# 전체 종료
down:
	docker compose -f $(MAIN) -f $(SUB) down