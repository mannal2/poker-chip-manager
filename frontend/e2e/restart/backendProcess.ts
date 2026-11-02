import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../backend');
const LOG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../test-results');
const PORT = 8080;
const HEALTH = `http://127.0.0.1:${PORT}/api/health`;
// The restart config serves the frontend preview here; the e2e profile allows only the online one.
const ORIGIN = 'http://127.0.0.1:4175';

// Gradle이 쓰는 Java 25 실행 파일과 실행 가능한 jar 경로를 출력하는 초기화 스크립트
const INIT_SCRIPT = `
allprojects { project ->
  if (project.path == ':server') {
    project.tasks.register('printBackendLaunch') {
      dependsOn 'bootJar'
      doLast {
        def launcher = project.javaToolchains.launcherFor(project.java.toolchain).get()
        println 'JAVA=' + launcher.executablePath.asFile.absolutePath
        println 'JAR=' + project.tasks.bootJar.archiveFile.get().asFile.absolutePath
      }
    }
  }
}
`;

// 실행 중인 백엔드 프로세스 하나
export interface BackendProcess {
  // 프로세스 트리를 끝내고 포트가 비면 끝난다
  stop(): Promise<void>;
}

let launch: Promise<{ java: string; jar: string }> | undefined;
let started = 0;

// jar를 한 번만 만들고 Gradle 도구 체인의 Java와 jar 경로를 돌려준다
function backendLaunch(): Promise<{ java: string; jar: string }> {
  launch ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-restart-'));
    const script = join(dir, 'launch.gradle');
    writeFileSync(script, INIT_SCRIPT);
    const args = ['-q', '--init-script', script, ':server:printBackendLaunch'];
    const { stdout } = await promisify(execFile)(
      process.platform === 'win32' ? 'cmd.exe' : join(BACKEND_DIR, 'gradlew'),
      process.platform === 'win32' ? ['/d', '/c', join(BACKEND_DIR, 'gradlew.bat'), ...args] : args,
      { cwd: BACKEND_DIR, maxBuffer: 16 * 1024 * 1024 },
    );
    // Gradle 출력에서 이름이 붙은 한 줄의 값을 읽는다
    const value = (key: string) => stdout.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1].trim();
    const java = value('JAVA');
    const jar = value('JAR');
    if (!java || !jar) throw new Error(`Gradle did not report the backend launch:\n${stdout}`);
    return { java, jar };
  })();
  return launch;
}

// 포트에 연결을 받는 프로세스가 있는지 확인한다
function portOpen(): Promise<boolean> {
  return new Promise((resolvePort) => {
    const socket = connect({ host: '127.0.0.1', port: PORT });
    // 연결되면 바로 닫고 사용 중이라고 알린다
    socket.once('connect', () => {
      socket.destroy();
      resolvePort(true);
    });
    // 연결이 거절되면 비어 있다고 알린다
    socket.once('error', () => resolvePort(false));
  });
}

// 조건이 참이 될 때까지 짧게 반복 확인하고 제한 시간이 지나면 실패한다
async function waitFor(check: () => Promise<boolean>, timeout: number, what: string) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 200));
  }
}

// 상태 경로가 정상 응답하는지 확인한다
async function healthy(): Promise<boolean> {
  try {
    return (await fetch(HEALTH)).ok;
  } catch {
    return false;
  }
}

// 자식 프로세스와 그 아래 프로세스를 모두 강제로 끝낸다
async function killTree(child: ChildProcess) {
  if (process.platform === 'win32')
    await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
  else
    try {
      // The child leads its own process group, so the negative id reaches everything it started.
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      // The group is already gone.
    }
}

// e2e 프로필 백엔드를 8080에서 직접 실행하고 상태 경로가 답하면 돌려준다
export async function startBackend(): Promise<BackendProcess> {
  const { java, jar } = await backendLaunch();
  if (await portOpen()) throw new Error(`Port ${PORT} is already in use; stop that server first`);
  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = join(LOG_DIR, `restart-backend-${++started}.log`);
  const log = createWriteStream(logPath);
  const child = spawn(
    java,
    ['-jar', jar, '--spring.profiles.active=e2e', `--poker.allowed-origins=${ORIGIN}`],
    { cwd: BACKEND_DIR, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);
  // 종료 이벤트를 한 번만 기다릴 수 있도록 미리 약속으로 만든다
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  let gone = false;
  void exited.then(() => (gone = true));
  try {
    await waitFor(
      // 시작 중에 프로세스가 끝나면 기록과 함께 실패하고 아니면 상태 경로를 확인한다
      async () => {
        if (gone)
          throw new Error(`Backend exited during startup:\n${readFileSync(logPath, 'utf8')}`);
        return healthy();
      },
      90_000,
      'the backend health check',
    );
  } catch (error) {
    await killTree(child);
    throw error;
  }
  return {
    // 강제 종료로 메모리의 방과 세션을 모두 잃게 하고 포트가 빌 때까지 기다린다
    async stop() {
      if (!gone) await killTree(child);
      await exited;
      await waitFor(async () => !(await portOpen()), 30_000, `port ${PORT} to close`);
      log.end();
    },
  };
}
