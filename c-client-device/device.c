#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include "MQTTClient.h"

int main() {
    MQTTClient client;
    char hostname[100];
    gethostname(hostname, 100);

    // 1. 우체국 연결 준비 (포트번호 5098)
    MQTTClient_create(&client, "tcp://host.docker.internal:5098", hostname, MQTTCLIENT_PERSISTENCE_NONE, NULL);
    MQTTClient_connectOptions opts = MQTTClient_connectOptions_initializer;
    
    // 2. 연결 시도 및 에러 코드 확인
    int rc = MQTTClient_connect(client, &opts);
    if (rc != 0) {
        // 여기가 핵심입니다! 왜 실패했는지 숫자로 알려줍니다.
        printf("서버 연결 실패! (에러 코드: %d)\n", rc);
        return -1;
    }

    // 3. 데이터 송신 (push 명령 입력)
    while(1) {
    char input[10];
    printf("명령어 입력: ");
    fgets(input, sizeof(input), stdin);
    input[strcspn(input, "\n")] = 0;  // 줄바꿈 제거

    if (strcmp(input, "push") == 0) {
        char msg[100];
        int code = 10000 + (rand() % 90000);
        sprintf(msg, "ID:%s / CODE:%d", hostname, code);

        MQTTClient_message pubmsg = MQTTClient_message_initializer;
        pubmsg.payload = msg;
        pubmsg.payloadlen = (int)strlen(msg);
        
        MQTTClient_publishMessage(client, "device/data", &pubmsg, NULL);
        printf("📤 [%s] 보냄: %d\n", hostname, code);
    } else {
        printf("❌ 알 수 없는 명령어: %s\n", input);
    }
}

    return 0;
}