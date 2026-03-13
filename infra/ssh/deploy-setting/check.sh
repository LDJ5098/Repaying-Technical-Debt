STATUS_FILE="/deploy-setting/deploy_status.txt"

check(){
    # 값 추출 (공백 및 줄바꿈 제거)
    S_ACC=$(grep "SSH_ACCESS" $STATUS_FILE | cut -d: -f2 | tr -d " " | tr -d "\r")
    T_LCK=$(grep "TIME_LOCK" $STATUS_FILE | cut -d: -f2 | tr -d " " | tr -d "\r")
    W_TIM=$(grep "WAIT_TIME" $STATUS_FILE | cut -d: -f2 | tr -d " " | tr -d "\r")
    
    echo "------------------------------------------"
    echo ">> [배포 상태 확인] (check로 가능)"
    echo ">> 파일 위치 : /deploy-setting/deploy_status.txt"
    echo "접속 상태 : $S_ACC"
    echo "(${W_TIM}초) 타임락 : $T_LCK"
    echo "------------------------------------------"

    # [시나리오 1] 배포가 차단되어 있는 경우
    if [ "$S_ACC" = "true" ]; then
        echo ">> 상태: [배포 차단] 현재 관리자가 접속 중이므로 배포가 차단되었습니다."
        echo ">> 조치: (수동/자동) 배포를 원하시면 SSH_ACCESS를 false로 수정하거나 접속을 종료하세요."

    # [시나리오 2] 배포는 허용하는데, 타임락을 걸때
    elif [ "$S_ACC" = "false" ] && [ "$T_LCK" = "true" ]; then
        echo ">> 상태: [배포 가능] ${W_TIM} 타임락이 작동 중입니다."
        echo ">> 결과: 배포 요청 시 ${W_TIM}초 대기 후 가동됩니다."

    # [시나리오 3] 모든 조건이 해제되어 즉시 배포 가능한 경우
    elif [ "$S_ACC" = "false" ] && [ "$T_LCK" = "false" ]; then
        echo ">> 상태: [배포 가능] 즉시 배포가 가능합니다."
    
    # [예외] 그 외 상황
    else
        echo ">> 상태: [알 수 없음] 파일을 확인해 주세요."
    fi
    echo "------------------------------------------"
}