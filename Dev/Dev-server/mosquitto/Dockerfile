FROM eclipse-mosquitto:latest

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["sh", "/docker-entrypoint.sh"]

#CI/CD test 26.03.15.0204