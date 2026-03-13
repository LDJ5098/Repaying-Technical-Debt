#!/with-contenv sh

# 중복 실행 방지
grep -q "#시작" /config/.profile 2>/dev/null && exit 0

sed -i '/#시작/,/#끝/ d' /config/.profile 2>/dev/null

cat <<'EOF' >> /config/.profile
#시작
sed -i "s/SSH_ACCESS:.*/SSH_ACCESS: true/" /deploy-setting/deploy_status.txt
source /deploy-setting/check.sh
check
#끝
EOF

ln -sf /deploy-setting/ssh-logout.sh /config/.bash_logout