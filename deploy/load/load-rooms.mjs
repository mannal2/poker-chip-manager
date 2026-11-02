#!/usr/bin/env node
// Load tool: fills rooms with real participants (cookie, CSRF, Origin, WebSocket) that play like people.
// Usage: node deploy/load/load-rooms.mjs --url http://127.0.0.1:8080 --rooms 10 --players 9 --minutes 10
// The JSON result goes to stdout and progress to stderr. See deploy/load/README.md.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const PROTOCOL = 1;
const REQUEST_TIMEOUT_MS = 15_000;
const POLL_MS = 250;
// A person needs at least a second between two taps; the tool never tests the rate limit.
const MIN_GAP_MS = 1_000;
const EXTRA_GAP_MS = 1_000;
const CLEANUP_LIMIT_MS = 30_000;

// 명령줄 인자를 읽고 범위를 확인한다
function readOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: "string" },
      rooms: { type: "string", default: "10" },
      players: { type: "string", default: "9" },
      minutes: { type: "string", default: "1" },
    },
  });
  const rooms = Number(values.rooms);
  const players = Number(values.players);
  const minutes = Number(values.minutes);
  if (!values.url || !/^https?:\/\//.test(values.url))
    throw new Error(
      "--url must be an http(s) address, for example http://127.0.0.1:8080",
    );
  if (!Number.isInteger(rooms) || rooms < 1)
    throw new Error("--rooms must be a positive integer");
  if (!Number.isInteger(players) || players < 2 || players > 10)
    throw new Error("--players must be between 2 and 10");
  if (!(minutes > 0)) throw new Error("--minutes must be positive");
  const base = new URL(values.url);
  return { base: base.origin, origin: base.origin, rooms, players, minutes };
}

// 진행 상황을 표준 오류로만 남긴다
function log(message) {
  process.stderr.write(`[load] ${message}\n`);
}

// 주어진 시간만큼 기다린다
function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

// 정렬된 지연 목록에서 백분위 값을 고른다
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return Math.round(
    sorted[
      Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    ],
  );
}

// 실행 전체의 요청·오류·지연·재연결 수를 모은다
class Stats {
  // 빈 집계를 만든다
  constructor() {
    this.requests = 0;
    this.errors = {};
    this.latencies = [];
    this.reconnects = 0;
    this.setupWaits = 0;
    this.commandsApplied = 0;
  }

  // 오류 하나를 코드별로 센다
  error(code) {
    this.errors[code] = (this.errors[code] ?? 0) + 1;
    log(`error ${code}`);
  }

  // 오류 총수를 센다
  errorCount() {
    return Object.values(this.errors).reduce((sum, count) => sum + count, 0);
  }

  // 출력할 JSON 객체를 만든다
  summary(options, startedAt, playStartedAt) {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return {
      url: options.base,
      rooms: options.rooms,
      players: options.players,
      minutes: options.minutes,
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      playSeconds: playStartedAt
        ? Math.round((Date.now() - playStartedAt) / 1000)
        : 0,
      requests: this.requests,
      errorCount: this.errorCount(),
      errors: this.errors,
      latencyMs: { p50: percentile(sorted, 50), p95: percentile(sorted, 95) },
      reconnects: this.reconnects,
      setupWaits: this.setupWaits,
      commandsApplied: this.commandsApplied,
    };
  }
}

// 상태 버전과 초안 버전 쌍이 더 새로운지 비교한다
function newer(next, current) {
  if (!current) return true;
  if (next.stateVersion !== current.stateVersion)
    return next.stateVersion > current.stateVersion;
  return next.draftVersion >= current.draftVersion;
}

// 자기 쿠키·CSRF·스트림·소켓을 가진 참가자 한 명
class Participant {
  // 접속할 서버와 집계 대상을 받는다
  constructor(options, stats, name) {
    this.options = options;
    this.stats = stats;
    this.name = name;
    this.cookies = new Map();
    this.csrf = "";
    this.streamId = null;
    this.streamSequence = 0;
    this.sequence = 0;
    this.generation = null;
    this.roomId = null;
    this.snapshot = null;
    this.socket = null;
    this.leaving = false;
    this.finished = false;
    this.nextAllowed = 0;
  }

  // 쿠키·CSRF·Origin을 붙여 요청하고 설정 중 429는 Retry-After만큼 기다려 다시 보낸다
  async http(method, path, body, { setup = false } = {}) {
    for (;;) {
      const headers = { Origin: this.options.origin };
      if (this.cookies.size > 0)
        headers.Cookie = [...this.cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join("; ");
      if (method !== "GET") {
        headers["X-CSRF-TOKEN"] = this.csrf;
        if (body !== undefined) headers["Content-Type"] = "application/json";
      }
      const started = performance.now();
      let response;
      let text;
      try {
        response = await fetch(this.options.base + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        text = await response.text();
      } catch {
        this.stats.requests++;
        this.stats.error("NETWORK");
        return { ok: false, network: true };
      }
      this.stats.requests++;
      this.stats.latencies.push(performance.now() - started);
      this.keepCookies(response);
      let json;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      if (response.status === 429 && setup) {
        const wait = Number(response.headers.get("Retry-After")) || 1;
        this.stats.setupWaits++;
        log(`${this.name}: rate limited during setup, waiting ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      if (!response.ok)
        this.stats.error(`${response.status}:${json?.code ?? "UNKNOWN"}`);
      return { ok: response.ok, status: response.status, body: json };
    }
  }

  // 응답의 Set-Cookie를 이름별로 보관한다
  keepCookies(response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const at = pair.indexOf("=");
      if (at > 0)
        this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }

  // 세션과 CSRF 토큰을 받고 화면 스트림을 연다
  async open() {
    const session = await this.http("GET", "/api/session", undefined, {
      setup: true,
    });
    if (!session.ok)
      throw new Error(`${this.name}: session failed (${session.status})`);
    this.csrf = session.body.csrfToken;
    const stream = await this.http(
      "POST",
      "/api/session/streams",
      {},
      { setup: true },
    );
    if (!stream.ok)
      throw new Error(`${this.name}: stream failed (${stream.status})`);
    this.streamId = stream.body.streamId;
  }

  // 방을 만들거나 코드로 참가하고 받은 상태로 소켓을 연다
  async enter(path, payload) {
    const response = await this.http(
      "POST",
      path,
      {
        protocolVersion: PROTOCOL,
        streamId: this.streamId,
        requestId: randomUUID(),
        sequence: ++this.streamSequence,
        ...payload,
      },
      { setup: true },
    );
    if (!response.ok)
      throw new Error(`${this.name}: ${path} failed (${response.status})`);
    this.roomId = response.body.roomId;
    this.code = response.body.code;
    this.participantId = response.body.participantId;
    this.generation = response.body.controlGeneration;
    this.sequence = 0;
    this.apply(response.body.state);
    this.nextAllowed = Date.now() + MIN_GAP_MS;
    this.connect();
  }

  // 더 새로운 스냅샷만 적용한다
  apply(state) {
    if (state && newer(state, this.snapshot)) this.snapshot = state;
  }

  // 소켓을 열어 구독하고 PING에 답하며 끊기면 다시 연결한다
  connect() {
    const url = `${this.options.base.replace(/^http/, "ws")}/ws`;
    const cookie = [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    const socket = new WebSocket(url, {
      headers: { Cookie: cookie, Origin: this.options.origin },
    });
    this.socket = socket;
    // 열리면 마지막으로 본 버전으로 방을 구독한다
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: "SUBSCRIBE",
          roomId: this.roomId,
          protocolVersion: PROTOCOL,
          lastSeenVersion: this.snapshot?.stateVersion ?? null,
        }),
      );
    };
    // 스냅샷을 적용하고 PING에는 PONG으로 답하며 마지막 메시지는 기록한다
    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        this.stats.error("WS_BAD_MESSAGE");
        return;
      }
      if (message.type === "SNAPSHOT") this.apply(message.state);
      else if (message.type === "PING") {
        socket.send(JSON.stringify({ type: "PONG", nonce: message.nonce }));
        if (message.stateVersion > (this.snapshot?.stateVersion ?? -1))
          socket.send(JSON.stringify({ type: "RESYNC" }));
      } else if (
        ["ACCESS_REVOKED", "ROOM_GONE", "PROTOCOL_INCOMPATIBLE"].includes(
          message.type,
        )
      ) {
        this.finished = true;
        if (!this.leaving) this.stats.error(`WS_${message.type}`);
      }
    };
    // 의도하지 않은 닫힘이면 재연결 수를 세고 잠시 뒤 다시 연결한다
    socket.onclose = () => {
      if (this.socket !== socket || this.leaving || this.finished) return;
      this.stats.reconnects++;
      log(`${this.name}: socket closed, reconnecting`);
      setTimeout(() => {
        if (this.socket === socket && !this.leaving && !this.finished)
          this.connect();
      }, MIN_GAP_MS);
    };
    // 오류 뒤에는 닫힘 이벤트가 이어지므로 여기서는 아무것도 하지 않는다
    socket.onerror = () => {};
  }

  // 사람처럼 쉬었다가 최신 상태 버전으로 방 명령을 보내고 결과 불명이면 같은 요청을 다시 보낸다
  async command(type, { payload, handScoped = false } = {}) {
    const wait = this.nextAllowed - Date.now();
    if (wait > 0) await sleep(wait);
    const state = this.snapshot;
    const body = {
      protocolVersion: PROTOCOL,
      requestId: randomUUID(),
      sequence: ++this.sequence,
      controlGeneration: this.generation,
      expectedStateVersion: state.stateVersion,
      tournamentId: state.tournamentId,
      ...(handScoped ? { handId: state.game?.hand?.id ?? null } : {}),
      type,
      ...(payload ? { payload } : {}),
    };
    const path = `/api/rooms/${encodeURIComponent(this.roomId)}/commands`;
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await this.http("POST", path, body);
      this.nextAllowed = Date.now() + MIN_GAP_MS + Math.random() * EXTRA_GAP_MS;
      if (!response.network && response.status !== 429) break;
      await sleep(MIN_GAP_MS);
    }
    if (response.body?.outcome === "APPLIED") this.stats.commandsApplied++;
    if (response.body?.latestState) this.apply(response.body.latestState);
    return response;
  }

  // 현재 방 상태를 다시 읽어 스냅샷을 맞춘다
  async refresh() {
    const response = await this.http(
      "GET",
      `/api/rooms/${encodeURIComponent(this.roomId)}/state`,
    );
    if (response.ok) this.apply(response.body);
    return response;
  }

  // 스냅샷을 보고 지금 보낼 명령을 고른다. 방장이 아니면 자기 차례 행동만 한다
  decide() {
    const state = this.snapshot;
    if (!state || this.finished) return null;
    const host = state.hostId === this.participantId;
    if (state.roomPhase === "WAITING") {
      if (!host) return null;
      const ready =
        state.participants.length === this.options.players &&
        state.participants.every((participant) => participant.connected);
      if (!ready) return null;
      if (state.settings.button < 0)
        return {
          type: "SET_DEALER",
          payload: { participantId: this.participantId },
        };
      return { type: "START" };
    }
    if (state.roomPhase === "RESULT") return host ? { type: "RE_READY" } : null;
    const capabilities = state.you.capabilities;
    // Players only fold or check, so a hand ends before the showdown; a settlement is a fallback.
    if (capabilities.canSettle) return { type: "ABORT" };
    if (!capabilities.canAct || !state.legal) return null;
    return { type: state.legal.canCheck ? "CHECK" : "FOLD", handScoped: true };
  }

  // 마감까지 자기 차례가 오면 행동한다
  async play(until) {
    while (Date.now() < until.value && !this.finished) {
      await sleep(POLL_MS);
      if (Date.now() < this.nextAllowed) continue;
      const next = this.decide();
      if (next) await this.command(next.type, next);
    }
  }

  // 진행 중이면 방장이 중단하고 각자 방을 나간 뒤 소켓과 스트림을 닫는다
  async leave() {
    if (this.roomId && !this.finished) {
      await this.refresh();
      this.leaving = true;
      const response = await this.command("LEAVE");
      if (response.ok) this.finished = true;
    }
    this.leaving = true;
    this.socket?.close(1000);
    if (this.streamId)
      await this.http(
        "DELETE",
        `/api/session/streams/${encodeURIComponent(this.streamId)}`,
      );
  }
}

// 방 하나를 만들고 참가자를 모은다. 실패해도 정리할 수 있게 만든 참가자는 목록에 남긴다
async function setUpRoom(options, stats, index, people) {
  const host = new Participant(options, stats, `room${index}-p1`);
  people.push(host);
  await host.open();
  await host.enter("/api/rooms", { name: `R${index}P1` });
  for (let seat = 2; seat <= options.players; seat++) {
    const guest = new Participant(options, stats, `room${index}-p${seat}`);
    people.push(guest);
    await guest.open();
    await guest.enter("/api/room-joins", {
      code: host.code,
      name: `R${index}P${seat}`,
    });
  }
  log(`room ${index} ready (${host.code})`);
}

// 마감이 지나면 진행 중인 게임을 중단하고 참가자를 한 명씩 내보낸다
async function cleanUpRoom(people) {
  const host = people.find(
    (person) => person.snapshot?.hostId === person.participantId,
  );
  if (host && !host.finished) {
    await host.refresh();
    if (host.snapshot?.roomPhase === "PLAYING") await host.command("ABORT");
  }
  // Leaving one at a time, each from a fresh state read, keeps the expected versions current.
  for (const person of people) await person.leave();
}

// 방을 만들고 정해진 시간 동안 플레이한 뒤 정리하고 결과 JSON을 출력한다
async function main() {
  const options = readOptions(process.argv.slice(2));
  const stats = new Stats();
  const startedAt = Date.now();
  const until = { value: Infinity };
  let playStartedAt = null;
  const rooms = Array.from({ length: options.rooms }, () => []);
  let printed = false;
  // 결과를 한 번만 출력하고 오류가 있으면 실패 코드로 끝낸다
  const finish = () => {
    if (printed) return;
    printed = true;
    process.stdout.write(
      `${JSON.stringify(stats.summary(options, startedAt, playStartedAt), null, 2)}\n`,
    );
    process.exit(stats.errorCount() > 0 ? 1 : 0);
  };
  let interrupted = false;
  // 첫 SIGINT는 정리 후 출력하고 두 번째는 바로 출력한다
  process.on("SIGINT", () => {
    if (interrupted) finish();
    interrupted = true;
    until.value = 0;
    log("interrupted; cleaning up (press Ctrl+C again to stop now)");
    setTimeout(finish, CLEANUP_LIMIT_MS).unref();
  });

  try {
    const settled = await Promise.allSettled(
      rooms.map((people, i) => setUpRoom(options, stats, i + 1, people)),
    );
    for (const result of settled)
      if (result.status === "rejected") {
        stats.error("SETUP_FAILED");
        log(result.reason?.message ?? String(result.reason));
      }
    if (!interrupted) {
      playStartedAt = Date.now();
      until.value = playStartedAt + options.minutes * 60_000;
      log(`playing ${options.rooms} room(s) for ${options.minutes} minute(s)`);
    }
    await Promise.all(rooms.flat().map((person) => person.play(until)));
    log("cleaning up");
    await Promise.all(rooms.map((people) => cleanUpRoom(people)));
  } catch (error) {
    stats.error("CRASH");
    log(error?.stack ?? String(error));
  }
  finish();
}

main().catch((error) => {
  log(error?.stack ?? String(error));
  process.exit(2);
});
