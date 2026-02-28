#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "MQTTClient.h"

volatile int response_received = 0;

int messageArrived(void* context, char* topicName, int topicLen, MQTTClient_message* message) {
    printf("서버 응답: %.*s\n", message->payloadlen, (char*)message->payload);
    fflush(stdout);
    response_received = 1;
    MQTTClient_freeMessage(&message);
    MQTTClient_free(topicName);
    return 1;
}

int main() {
    srand(time(NULL));
    MQTTClient client;
    char hostname[100];
    gethostname(hostname, 100);

    MQTTClient_create(&client, "tcp://host.docker.internal:5098", hostname, MQTTCLIENT_PERSISTENCE_NONE, NULL);
    MQTTClient_connectOptions opts = MQTTClient_connectOptions_initializer;

    // 응답 콜백 등록
    MQTTClient_setCallbacks(client, NULL, NULL, messageArrived, NULL);

    int rc = MQTTClient_connect(client, &opts);
    if (rc != 0) {
        printf("서버 연결 실패! (에러 코드: %d)\n", rc);
        return -1;
    }

    // 응답 토픽 구독
    MQTTClient_subscribe(client, "device/response", 0);

    while(1) {
        char input[20];
        printf("명령어 입력 (push/break): ");
        fflush(stdout);
        fgets(input, sizeof(input), stdin);
        input[strcspn(input, "\n")] = 0;

        if (strcmp(input, "push") == 0) {
            char msg[100];
            int code = 10000 + (rand() % 90000);
            sprintf(msg, "ID:%s / CODE:%d", hostname, code);

            MQTTClient_message pubmsg = MQTTClient_message_initializer;
            pubmsg.payload = msg;
            pubmsg.payloadlen = (int)strlen(msg);

            MQTTClient_publishMessage(client, "device/data", &pubmsg, NULL);
            printf("[%s] 보냄: %d\n", hostname, code);

            // 응답 대기 (최대 5초)
            response_received = 0;
            int timeout = 5;
            while (!response_received && timeout > 0) {
                sleep(1);
                timeout--;
            }
            if (!response_received) {
                printf("서버 응답 없음 (타임아웃)\n");
            }

        } else if (strcmp(input, "break") == 0) {
            printf("종료합니다.\n");
            break;
        } else {
            printf("알 수 없는 명령어: %s\n", input);
        }
    }
    return 0;
}