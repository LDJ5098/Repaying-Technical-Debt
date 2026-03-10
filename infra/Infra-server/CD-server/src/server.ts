import express from 'express';
import { exec } from 'child_process';
import axios from 'axios';

const app = express();
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_REPO = process.env.GITHUB_REPO!;
const DEPLOY_BRANCH = 'main';
const IMAGE_BASE = `ghcr.io/${GITHUB_REPO.toLowerCase()}/backend`;

// GitHub API로 run 검증
const verifyRun = async (runId: string): Promise<string> => {
  const timeout = 10 * 60 * 1000; // 10분
  const start = Date.now();

  while (true) {
    if (Date.now() - start > timeout) {
      throw new Error('빌드 타임아웃 (10분 초과)');
    }

    const res = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${runId}`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
    );

    const { status, conclusion, head_branch, head_sha } = res.data;

    //이미지 빌드 진행중
    if (status !== 'completed') {
      console.log(`>> 빌드 진행중... (status: ${status}) 3초 후 재확인`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      continue;
    }

    if (conclusion !== 'success') {
      throw new Error(`CI 미통과 (conclusion: ${conclusion})`);
    }

    if (head_branch !== DEPLOY_BRANCH) {
      throw new Error(`잘못된 브랜치 (head_branch: ${head_branch})`);
    }

    return head_sha.slice(0, 7);
  }
};

// 로컬 이미지 삭제
const removeLocalImage = (tag: string): Promise<void> => {
  return new Promise((resolve) => {
    exec(`docker rmi ${IMAGE_BASE}:sha-${tag}`, () => resolve()); // 실패해도 무시
  });
};

// 쉘 명령 실행
const runCommand = (cmd: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr));
      else resolve(stdout);
    });
  });
};

// 배포 엔드포인트
app.post('/deploy', async (req, res) => {
  const { run_id, type } = req.body;

  if (!run_id || !type) {
    return res.status(400).json({ error: 'run_id, type 필요' });
  }

  console.log(`>> 배포 요청 수신 (type: ${type}, run_id: ${run_id})`);

  let imageTag: string | null = null;

  try {
    if (type === 'backend') {
      // GitHub API 검증
      console.log('>> GitHub API 검증 중...');
      imageTag = await verifyRun(run_id);
      console.log(`>> 검증 완료 (image tag: sha-${imageTag})`);

      // 이미지 미리 pull
      console.log('>> 이미지 pull 중...');
      const auth = Buffer.from(`ldj5098:${GITHUB_TOKEN}`).toString('base64');
      const configJson = JSON.stringify({ auths: { 'ghcr.io': { auth } } });
      
      // 인증 파일 생성 및 Pull까지만 담당 (질문자님 기존 방식 유지)
      await runCommand(
        `mkdir -p /root/.docker && ` +
        `echo '${configJson}' > /root/.docker/config.json && ` +
        `docker pull ${IMAGE_BASE}:sha-${imageTag}`
      );
      console.log('>> 이미지 pull 완료');

      // 배포 실행
      console.log('>> 배포 실행 중...');
      await runCommand(`sh /app/src/scripts/deploy.sh sha-${imageTag}`);

    } else if (type === 'dev') {
      await runCommand('sh /app/src/scripts/deploy.sh');
    }

    console.log('>> 배포 완료');
    res.json({ success: true });

  } catch (err: any) {
    console.error(`>> 배포 실패: ${err.message}`);

    // 검증 실패 시 로컬 이미지 삭제
    if (imageTag) {
      console.log('>> 로컬 이미지 삭제 중...');
      await removeLocalImage(imageTag);
    }

    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(3000, () => {
  console.log('CD Server 시작 (port 3000)');
});