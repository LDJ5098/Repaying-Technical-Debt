import express from 'express';
import { exec } from 'child_process';
import { readFileSync, writeFileSync, watchFile } from 'fs';
import axios from 'axios';

const app = express();
app.use(express.json());

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN!;
const GITHUB_REPO   = process.env.GITHUB_REPO!;
//const DEPLOY_BRANCH = 'main';
const IMAGE_BASE    = `ghcr.io/${GITHUB_REPO.toLowerCase()}/backend`;
const STATUS_FILE   = '/deploy-setting/deploy_status.txt';

// ─── 설정 (deploy_status.txt) ─────────────────────────────────────────────

interface DeploySettings {
  sshAccess:       boolean;
  timeLock:        boolean;
  waitTime:        number;
  rollbackBackend: string; // A 관리자가 허용한 롤백 RunID (비어있으면 롤백 없음)
}

const readSettings = (): DeploySettings => {
  const txt = readFileSync(STATUS_FILE, 'utf-8');
  const get = (key: string) => txt.match(new RegExp(`${key}:[ \\t]*([^\\n\\r]*)`))?.[1].trim() ?? '';
  return {
    sshAccess:       get('SSH_ACCESS') === 'true',
    timeLock:        get('TIME_LOCK')  === 'true',
    waitTime:        parseInt(get('WAIT_TIME')) || 0,
    rollbackBackend: get('ROLLBACK_Backend') ?? '',
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

// ─── Used RunID 관리 ──────────────────────────────────────────────────────

/** USED_RunID_Backend 섹션에서 RunID → SHA Map 추출 */
const readUsedRunIds = (): Map<string, string> => {
  const txt = readFileSync(STATUS_FILE, 'utf-8');
  const section = txt.match(/USED_RunID_Backend=[\s\S]*?(?=\n[A-Z]|$)/)?.[0] ?? '';
  const map = new Map<string, string>();
  section.split('\n')
    .filter(l => l.startsWith('- '))
    .forEach(l => {
      const parts = l.slice(2).trim().split(':');
      if (parts.length === 2) map.set(parts[0], parts[1]);
    });
  return map;
};

/** USED_RunID_Backend 섹션에 RunID → SHA Map 기록 */
const writeUsedRunIds = (runIds: Map<string, string>) => {
  isWritingFile = true;
  try {
    const txt = readFileSync(STATUS_FILE, 'utf-8');
    const lines = Array.from(runIds.entries())
      .map(([runId, sha]) => `- ${runId}:${sha}`)
      .join('\n');
    const newTxt = txt.includes('USED_RunID_Backend=')
      ? txt.replace(/USED_RunID_Backend=[\s\S]*?(?=\n[A-Z]|$)/, `USED_RunID_Backend=\n${lines}`)
      : txt + `\nUSED_RunID_Backend=\n${lines}`;
    writeFileSync(STATUS_FILE, newTxt);
  } finally {
    setTimeout(() => { isWritingFile = false; }, 200);
  }
};

/** GHCR 이미지 존재 여부 확인 */
const checkImageExists = async (sha: string): Promise<boolean> => {
  try {
    await runCommand(`docker manifest inspect ${IMAGE_BASE}:sha-${sha}`);
    return true;
  } catch {
    return false;
  }
};

/**
 * 새 승인 요청이 들어올 때마다 USED_RunID_Backend를 GHCR 이미지 존재 여부로 동기화.
 * GHCR cleanup 정책으로 삭제된 이미지의 RunID는 목록에서 제거.
 */
const syncUsedRunIds = async (): Promise<Map<string, string>> => {
  const runIds = readUsedRunIds();
  const synced = new Map<string, string>();
  for (const [runId, sha] of runIds) {
    if (await checkImageExists(sha)) {
      synced.set(runId, sha);
    } else {
      console.log(`>> Used_RunID 동기화: GHCR 이미지 없음, 제거 (runId: ${runId}, sha: ${sha})`);
    }
  }
  if (synced.size !== runIds.size) writeUsedRunIds(synced);
  return synced;
};

/** 배포 완료 후 RunID를 Used_RunID에 추가 */
const addUsedRunId = (runId: string, sha: string) => {
  const runIds = readUsedRunIds();
  runIds.set(runId, sha);
  writeUsedRunIds(runIds);
  console.log(`>> Used_RunID 추가 (runId: ${runId}, sha: ${sha})`);
};

/**
 * 롤백 완료/실패 결과를 ROLLBACK_Backend에 기록.
 * check.sh가 polling으로 감지하여 SSH 화면에 결과 출력.
 * '[' 문자로 완료/실패 여부를 구분하여 watchFile 재트리거 방지.
 */
const writeRollbackResult = (runId: string, result: string) => {
  isWritingFile = true;
  try {
    const txt     = readFileSync(STATUS_FILE, 'utf-8');
    const time    = new Date().toLocaleTimeString('ko-KR');
    const newTxt  = txt.replace(/ROLLBACK_Backend:\s*\S*/, `ROLLBACK_Backend: ${runId} [${time}/${result}]`);
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
        // RunID → SHA 추출 (GitHub Actions 모니터링 및 디버깅 추적 목적으로 RunID 유지)
        imageTag = await extractSha(job.runId!);
        const auth = Buffer.from(`ldj5098:${GITHUB_TOKEN}`).toString('base64');
        const cfg  = JSON.stringify({ auths: { 'ghcr.io': { auth } } });
        await runCommand(`mkdir -p /root/.docker && echo '${cfg}' > /root/.docker/config.json`);

        //배포 시간 측정
        const output = await runCommand(`sh /app/src/scripts/deploy-Backend.sh sha-${imageTag}`);
        console.log(output);

        // 배포 성공 후 Used_RunID에 추가 (이후 동일 RunID 재사용 차단)
        addUsedRunId(job.runId!, imageTag);
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

// ─── 서버 시작 시 Used_RunID 초기화 ──────────────────────────────────────

/**
 * 서버 시작 시 GitHub API로 최근 완료된 B-Prod 워크플로우 Run들을 조회.
 * 기존 USED_RunID_Backend가 비어있을 경우 초기 데이터로 채워
 * 서버 재시작 직후의 공백 기간을 방지.
 */
const initUsedRunIds = async () => {
  const existing = readUsedRunIds();
  if (existing.size > 0) {
    console.log(`>> Used_RunID 초기화 스킵 (기존 데이터 ${existing.size}개 존재)`);
    return;
  }

  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/B-Prod.yml/runs?status=success&per_page=10`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
    );

    const runIds = new Map<string, string>();
    for (const run of data.workflow_runs) {
      const sha = run.head_sha.slice(0, 7);
      if (await checkImageExists(sha)) {
        runIds.set(String(run.id), sha);
        console.log(`>> Used_RunID 초기화: (runId: ${run.id}, sha: ${sha})`);
      }
    }

    if (runIds.size > 0) {
      writeUsedRunIds(runIds);
      console.log(`>> Used_RunID 초기화 완료 (${runIds.size}개 등록)`);
    } else {
      console.log(`>> Used_RunID 초기화: GHCR에 일치하는 이미지 없음`);
    }
  } catch (err: any) {
    console.error(`>> Used_RunID 초기화 실패: ${err.message}`);
  }
};

// ─── 설정 파일 감시 ──────────────────────────────────────────────────────

watchFile(STATUS_FILE, { interval: 1000 }, () => {
  if (isWritingFile) return;

  try {
    const prev = settings;
    const next = readSettings();
    settings = next;
    console.log('>> 설정 변경 감지:', next);
    console.log('>> prev.rollbackBackend:', JSON.stringify(prev.rollbackBackend));
    console.log('>> next.rollbackBackend:', JSON.stringify(next.rollbackBackend));

    backendQueue.syncFromFile(readQueueIndices('backend'));
    devQueue.syncFromFile(readQueueIndices('dev'));

    backendQueue.onSettingsChanged(prev, next);
    devQueue.onSettingsChanged(prev, next);

    // A 관리자 롤백 감지 : ROLLBACK_Backend에 순수 RunID가 입력된 경우만 트리거
    // '[' 문자가 없는 경우만 = 완료/실패 결과 갱신으로 인한 재트리거 방지
    if (next.rollbackBackend && !next.rollbackBackend.includes('[') && prev.rollbackBackend !== next.rollbackBackend) {
      console.log(`>> 롤백 감지 (runId: ${next.rollbackBackend})`);
      handleRollback(next.rollbackBackend);
    }
  } catch (err: any) {
    console.error('설정 파일 읽기 실패:', err.message);
  }
});

// ─── A 관리자 롤백 처리 ──────────────────────────────────────────────────

/**
 * A 관리자가 ROLLBACK_Backend에 RunID를 입력하면 즉시 롤백 실행.
 * Used_RunID에 등록된 RunID만 롤백 허용 (한번도 배포된 적 없는 RunID 차단).
 * SHA는 Used_RunID에서 직접 조회 (GitHub API 재호출 불필요).
 * Discord 승인 절차 없이 A 관리자만 실행 가능 (SSH 접속 권한 = 롤백 권한).
 */
const handleRollback = async (runId: string) => {
  console.log(`>> 롤백 시작 (runId: ${runId})`);
  try {
    // Used_RunID 동기화 후 롤백 대상 RunID 확인
    const usedRunIds = await syncUsedRunIds();

    if (!usedRunIds.has(runId)) {
      console.error(`>> 롤백 실패: 최근 배포된 적 없는 RunID (runId: ${runId})`);
      writeRollbackResult(runId, '배포 실패: 배포된 적 없는 RunID');
      return;
    }

    // SHA는 Used_RunID에서 직접 조회 (GitHub API 재호출 불필요)
    const sha = usedRunIds.get(runId)!;
    const auth = Buffer.from(`ldj5098:${GITHUB_TOKEN}`).toString('base64');
    const cfg  = JSON.stringify({ auths: { 'ghcr.io': { auth } } });
    await runCommand(`mkdir -p /root/.docker && echo '${cfg}' > /root/.docker/config.json`);
    const output = await runCommand(`sh /app/src/scripts/deploy-Backend.sh sha-${sha}`);
    console.log(output);
    console.log(`>> 롤백 완료 (runId: ${runId}, sha: ${sha})`);
    writeRollbackResult(runId, '배포 완료');
  } catch (err: any) {
    console.error(`>> 롤백 실패 (runId: ${runId}): ${err.message}`);
    writeRollbackResult(runId, `배포 실패: ${err.message}`);
  } finally {
    // writeRollbackResult에서 이미 파일 갱신 완료
    // clearRollback 불필요 (결과 문구가 남아있어야 check.sh가 감지 가능)
  }
};

// ─── API 배포 검증 ───────────────────────────────────────────────────────

/**
 * RunID → SHA 추출
 * CI 통과 여부 및 브랜치 검증은 워크플로우(B-Prod.yml)에서 이미 보장되므로 제거.
 * RunID는 GitHub Actions 모니터링 및 디버깅 추적에 유리하여 SHA 대신 유지.
 */
const extractSha = async (runId: string): Promise<string> => {
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

app.post('/deploy', async (req, res) => {
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

  // Backend 배포 시 Used_RunID 검증
  if (type === 'backend' && run_id) {
    // 새 요청마다 GHCR 이미지 존재 여부로 Used_RunID 동기화
    const usedRunIds = await syncUsedRunIds();

    if (usedRunIds.has(run_id)) {
      // 이미 사용된 RunID → 차단 (롤백은 관리자에게 문의)
      return res.status(400).json({
        status: 'rejected',
        error:  '이미 한번 사용한 RunID입니다. 롤백은 관리자에게 문의하십시오.',
      });
    }
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

app.listen(3000, async () => {
  console.log('CD Server 시작 (port 3000)');
  await initUsedRunIds();
});