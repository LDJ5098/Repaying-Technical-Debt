MAIN = docker-compose-infra.yml
SUB = docker-compose-sub.yml

#전체 실행 (c-client + runner)
up:
	docker compose -f $(MAIN) -f $(SUB) up 

#전체 실행 (c-client + runner)
up-d:
	docker compose -f $(MAIN) -f $(SUB) up -d

#전체 실행 (c-client + runner)
up--build:
	docker compose -f $(MAIN) -f $(SUB) up --build

#전체 실행 (c-client + runner)
up-d--build:
	docker compose -f $(MAIN) -f $(SUB) up -d --build

# 전체 종료
down:
	docker compose -f $(MAIN) -f $(SUB) down