import express from 'express';
import { exec } from 'child_process';
import { readFileSync, writeFileSync, watchFile } from 'fs';
import axios from 'axios';

const app = express();
app.use(express.json());

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN!;
const GITHUB_REPO   = process.env.GITHUB_REPO!;
const DEPLOY_BRANCH = 'main';
const IMAGE_BASE    = `ghcr.io/${GITHUB_REPO.toLowerCase()}/backend`;
const STATUS_FILE   = '/deploy-setting/deploy_status.txt';

// ─── 설정 (deploy_status.txt) ─────────────────────────────────────────────

interface DeploySettings {
  sshAccess: boolean;
  timeLock:  boolean;
  waitTime:  number;
}

const readSettings = (): DeploySettings => {
  const txt = readFileSync(STATUS_FILE, 'utf-8');
  const get = (key: string) => txt.match(new RegExp(`${key}:\\s*(\\S+)`))?.[1].trim() ?? '';
  return {
    sshAccess: get('SSH_ACCESS') === 'true',
    timeLock:  get('TIME_LOCK')  === 'true',
    waitTime:  parseInt(get('WAIT_TIME')) || 0,
  };
};

let settings = readSettings();

// ─── QUEUE 파일 동기화 ────────────────────────────────────────────────────

let isWritingFile = false;

/** 파일의 QUEUE_Backend / QUEUE_Dev 섹션에서 순번 Set 추출 */
const readQueueIndices = (type: 'backend' | 'dev'): Set<number> => {
  const txt = readFileSync(STATUS_FILE, 'utf-8');
  const key = type === 'backend' ? 'QUEUE_Backend' : 'QUEUE_Dev';
  const section = txt.match(new RegExp(`${key}=[\\s\\S]*?(?=\\n[A-Z]|$)`))?.[0] ?? '';
  return new Set(
    section.split('\n')
      .filter(l => l.startsWith('- '))
      .map(l => parseInt(l.slice(2).trim().split(':')[0]))
      .filter(n => !isNaN(n))
  );
};

/** deploying 제외한 job 목록을 파일의 QUEUE_Backend / QUEUE_Dev 섹션에 기록 */
const writeQueueToFile = (type: 'backend' | 'dev', jobs: DeployJob[]) => {
  isWritingFile = true;
  try {
    const txt = readFileSync(STATUS_FILE, 'utf-8');
    const key = type === 'backend' ? 'QUEUE_Backend' : 'QUEUE_Dev';
    const lines = jobs
      .map((j, idx) => `- ${idx + 1}:${j.type}:${j.runId ?? ''}:${j.status}`)
      .join('\n');

    const newTxt = txt.includes(`${key}=`)
      ? txt.replace(new RegExp(`${key}=[\\s\\S]*?(?=\\n[A-Z]|$)`), `${key}=\n${lines}`)
      : txt + `\n${key}=\n${lines}`;
    writeFileSync(STATUS_FILE, newTxt);
  } finally {
    setTimeout(() => { isWritingFile = false; }, 200);
  }
};

// ─── 타입 ────────────────────────────────────────────────────────────────

type JobStatus = 'waiting' | 'timerlock_running' | 'timerlock_paused' | 'deploying';

interface DeployJob {
  jobId:       string;
  runId:       string | null;
  type:        'backend' | 'dev';
  callbackUrl: string;
  status:      JobStatus;
  elapsed:     number;
  timerStart?: number;
  timer?:      NodeJS.Timeout;
}

// ─── 콜백 전송 ───────────────────────────────────────────────────────────

const sendCallback = (url: string, jobId: string, event: string, data: object = {}) => {
  axios.post(url, { job_id: jobId, event, data }).catch((err: any) =>
    console.error(`콜백 전송 실패 (${event}, ${jobId}): ${err.message}`)
  );
};

// ─── 배포 큐 ─────────────────────────────────────────────────────────────

class DeployQueue {
  private jobs: DeployJob[] = [];

  constructor(private type: 'backend' | 'dev') {}

  private get active() { return this.jobs[0] as DeployJob | undefined; }

  /** 큐에 추가. position 반환 */
  add(job: DeployJob): number {
    this.jobs.push(job);
    const pos = this.jobs.length - 1;
    this.syncFileFromQueue();
    if (pos === 0) setImmediate(() => this.processNext());
    return pos;
  }

  /** 관리자 API 요청으로 job 삭제 */
  remove(jobId: string): boolean {
    const idx = this.jobs.findIndex(j => j.jobId === jobId);
    if (idx === -1) return false;

    const job = this.jobs[idx];
    if (job.timer) clearTimeout(job.timer);
    this.jobs.splice(idx, 1);

    this.syncFileFromQueue();
    sendCallback(job.callbackUrl, job.jobId, 'job_deleted');

    if (idx === 0 && this.jobs.length > 0) {
      this.notifyPositions();
      this.processNext();
    } else if (idx > 0) {
      this.notifyPositions(idx);
    }
    return true;
  }

  /**
   * watchFile 감지 시 호출.
   * 파일에서 사라진 순번의 job을 큐에서 제거.
   */
  syncFromFile(fileIndices: Set<number>) {
    const nonDeployingJobs = this.jobs.filter(j => j.status !== 'deploying');
    const toRemove = nonDeployingJobs.filter((_, idx) => !fileIndices.has(idx + 1));

    for (const job of toRemove) {
      const idx = this.jobs.indexOf(job);
      if (idx === -1) continue;
      if (job.timer) clearTimeout(job.timer);
      this.jobs.splice(idx, 1);
      sendCallback(job.callbackUrl, job.jobId, 'job_deleted');
      console.log(`>> 파일 동기화로 job 삭제 (jobId: ${job.jobId})`);
    }

    if (toRemove.length > 0 && this.jobs.length > 0) {
      this.notifyPositions();
      if (this.active?.status === 'waiting') this.processNext();
    }
  }

  /** deploy_status.txt 설정 변경 시 호출 */
  onSettingsChanged(prev: DeploySettings, next: DeploySettings) {
    const job = this.active;
    if (!job) return;

    // SSH_ACCESS false → true : 타이머락 일시정지
    if (!prev.sshAccess && next.sshAccess && job.status === 'timerlock_running') {
      this.pauseTimerlock(job);
    }

    // SSH_ACCESS true → false : 재개 또는 시작
    if (prev.sshAccess && !next.sshAccess) {
      if (job.status === 'timerlock_paused') this.resumeTimerlock(job);
      else if (job.status === 'waiting')     this.processNext();
    }

    // TIME_LOCK true → false : 타이머락 해제
    if (prev.timeLock && !next.timeLock) {
      if (job.status === 'timerlock_running') {
        clearTimeout(job.timer);
        job.timer = undefined;
        this.startDeploying(job);
      } else if (job.status === 'timerlock_paused') {
        // SSH_ACCESS가 true라 배포는 못 하고 대기 상태로 복귀
        job.status = 'waiting';
        this.syncFileFromQueue();
      }
    }

    // TIME_LOCK false → true : 대기 중인 job에 타이머락 적용
    if (!prev.timeLock && next.timeLock) {
      if (job.status === 'waiting' && !next.sshAccess) {
        this.startTimerlock(job);
      }
    }

    // WAIT_TIME 변경
    if (prev.waitTime !== next.waitTime) {
      if (job.status === 'timerlock_running') {
        job.elapsed   += (Date.now() - job.timerStart!) / 1000;
        job.timerStart = Date.now();
        clearTimeout(job.timer);
        const remaining = Math.max(0, next.waitTime - job.elapsed);
        sendCallback(job.callbackUrl, job.jobId, 'timerlock_update', { seconds: Math.ceil(remaining) });
        if (remaining <= 0) this.startDeploying(job);
        else job.timer = setTimeout(() => this.startDeploying(job), remaining * 1000);
      }
      // timerlock_paused는 SSH_ACCESS가 true인 상태이므로 콜백 전송 안 함
      // resumeTimerlock 호출 시 새 waitTime 기준으로 자동 계산
    }
  }

  // ── 내부 메서드 ──────────────────────────────────────────────────────

  private processNext() {
    const job = this.active;
    if (!job || job.status !== 'waiting') return;
    if (settings.sshAccess) return;
    if (settings.timeLock) this.startTimerlock(job);
    else                   this.startDeploying(job);
  }

  private startTimerlock(job: DeployJob) {
    const remaining = Math.max(0, settings.waitTime - job.elapsed);
    job.status     = 'timerlock_running';
    job.timerStart = Date.now();
    this.syncFileFromQueue();
    sendCallback(job.callbackUrl, job.jobId, 'timerlock_start', { seconds: Math.ceil(remaining) });
    if (remaining <= 0) { this.startDeploying(job); return; }
    job.timer = setTimeout(() => this.startDeploying(job), remaining * 1000);
  }

  private pauseTimerlock(job: DeployJob) {
    if (job.timer) clearTimeout(job.timer);
    job.elapsed += (Date.now() - job.timerStart!) / 1000;
    job.status   = 'timerlock_paused';
    sendCallback(job.callbackUrl, job.jobId, 'paused');
    this.syncFileFromQueue();
  }

  private resumeTimerlock(job: DeployJob) {
    const remaining = Math.max(0, settings.waitTime - job.elapsed);
    job.status     = 'timerlock_running';
    job.timerStart = Date.now();
    this.syncFileFromQueue();
    sendCallback(job.callbackUrl, job.jobId, 'timerlock_resume', { seconds: Math.ceil(remaining) });
    if (remaining <= 0) { this.startDeploying(job); return; }
    job.timer = setTimeout(() => this.startDeploying(job), remaining * 1000);
  }

  private startDeploying(job: DeployJob) {
    job.status = 'deploying';
    job.timer  = undefined;
    this.syncFileFromQueue(); // deploying 진입 → 파일에서 제거
    const label = job.type === 'backend' ? 'Backend' : 'Dev';
    sendCallback(job.callbackUrl, job.jobId, 'deploy_start', { label });
    this.executeDeploy(job).catch(err => console.error(`executeDeploy 오류: ${err.message}`));
  }

  private async executeDeploy(job: DeployJob) {
    const label = job.type === 'backend' ? 'Backend' : 'Dev';
    let imageTag: string | null = null;

    try {
      if (job.type === 'backend') {
        imageTag = await verifyRun(job.runId!);
        const auth = Buffer.from(`ldj5098:${GITHUB_TOKEN}`).toString('base64');
        const cfg  = JSON.stringify({ auths: { 'ghcr.io': { auth } } });
        await runCommand(`mkdir -p /root/.docker && echo '${cfg}' > /root/.docker/config.json`);
        
        //배포 시간 측정
        const output = await runCommand(`sh /app/src/scripts/deploy-Backend.sh sha-${imageTag}`);
        console.log(output);
      } else {
        await runCommand('sh /app/src/scripts/deploy-Dev.sh');
      }
      sendCallback(job.callbackUrl, job.jobId, 'deploy_complete', { label });
    } catch (err: any) {
      if (imageTag) await removeLocalImage(imageTag);
      sendCallback(job.callbackUrl, job.jobId, 'deploy_failed', { label, error: err.message });
    }

    this.jobs.shift();
    if (this.jobs.length > 0) {
      this.notifyPositions();
      this.processNext();
    }
  }

  private notifyPositions(fromIdx = 0) {
    this.jobs.forEach((job, idx) => {
      if (idx >= fromIdx && idx > 0 && job.status === 'waiting') {
        sendCallback(job.callbackUrl, job.jobId, 'queue_update', { position: idx });
      }
    });
  }

  /** deploying 제외한 job만 파일에 기록 */
  private syncFileFromQueue() {
    const jobs = this.jobs.filter(j => j.status !== 'deploying');
    writeQueueToFile(this.type, jobs);
  }
}

const backendQueue = new DeployQueue('backend');
const devQueue     = new DeployQueue('dev');

// Discord interaction token이 만료되어 복원 불가하므로 서버 재시작 시 큐 초기화
writeQueueToFile('backend', []);
writeQueueToFile('dev', []);

// ─── 설정 파일 감시 ──────────────────────────────────────────────────────

watchFile(STATUS_FILE, { interval: 1000 }, () => {
  if (isWritingFile) return;

  try {
    const prev = settings;
    const next = readSettings();
    settings = next;
    console.log('>> 설정 변경 감지:', next);

    backendQueue.syncFromFile(readQueueIndices('backend'));
    devQueue.syncFromFile(readQueueIndices('dev'));

    backendQueue.onSettingsChanged(prev, next);
    devQueue.onSettingsChanged(prev, next);
  } catch (err: any) {
    console.error('설정 파일 읽기 실패:', err.message);
  }
});

// ─── API 배포 검증 ───────────────────────────────────────────────────────

const verifyRun = async (runId: string): Promise<string> => {
  const timeout = 10 * 60 * 1000;
  const start   = Date.now();

  while (true) {
    if (Date.now() - start > timeout) throw new Error('빌드 타임아웃 (10분 초과)');
    const { data } = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${runId}`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
    );
    if (data.status !== 'completed') {
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    if (data.conclusion !== 'success')      throw new Error(`CI 미통과 (conclusion: ${data.conclusion})`);
    if (data.head_branch !== DEPLOY_BRANCH) throw new Error(`잘못된 브랜치 (head_branch: ${data.head_branch})`);
    return data.head_sha.slice(0, 7);
  }
};

const removeLocalImage = (tag: string): Promise<void> =>
  new Promise(resolve => exec(`docker rmi ${IMAGE_BASE}:sha-${tag}`, () => resolve()));

const runCommand = (cmd: string): Promise<string> =>
  new Promise((resolve, reject) =>
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else     resolve(stdout);
    })
  );

// ─── 엔드포인트 ──────────────────────────────────────────────────────────

app.post('/deploy', (req, res) => {
  const { run_id, type, job_id, callback_url } = req.body;

  if (!type || !job_id || !callback_url) {
    return res.status(400).json({ error: 'type, job_id, callback_url 필요' });
  }
  if (type === 'backend' && !run_id) {
    return res.status(400).json({ error: 'backend은 run_id 필요' });
  }
  if (settings.sshAccess) {
    return res.json({ status: 'blocked' });
  }

  const job: DeployJob = {
    jobId:       job_id,
    runId:       run_id ?? null,
    type,
    callbackUrl: callback_url,
    status:      'waiting',
    elapsed:     0,
  };

  const queue    = type === 'backend' ? backendQueue : devQueue;
  const position = queue.add(job);

  return res.json({ status: 'queued', position });
});

app.delete('/queue/:type/:jobId', (req, res) => {
  const { type, jobId } = req.params;
  const queue   = type === 'backend' ? backendQueue : devQueue;
  const removed = queue.remove(jobId);
  return res.json({ removed });
});

app.listen(3000, () => console.log('CD Server 시작 (port 3000)'));