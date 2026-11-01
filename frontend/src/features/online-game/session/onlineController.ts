import type { GameEvent, WinnerSelection } from '../../../game/types';
import { messageFor } from '../../gameplay/model/errorMessages';
import type { ApiClient, ApiResult } from '../api/client';
import {
  isCommandResponse,
  isJoinResponse,
  isRecoveryRequestResponse,
  isRecoveryStatus,
  isRoomSnapshot,
  type RecoveryStatus,
  type RoomSnapshot,
  type ServerCommand,
  type SnapshotMessage,
} from '../api/types';
import type { FinalMessage, RoomSocket, RoomSocketHandlers } from '../realtime/roomSocket';
import type { KnownEvent } from '../model/eventNotices';

export interface OnlineView {
  phase: 'entry' | 'joining' | 'recovering' | 'room' | 'gone' | 'revoked' | 'incompatible';
  snapshot: RoomSnapshot | null;
  connection: 'online' | 'syncing' | 'offline';
  hasControl: boolean;
  pending: boolean;
  recovery: RecoveryStatus | null;
  error: string | null;
}
type SocketPort = Pick<RoomSocket, 'subscribe' | 'resync' | 'close'>;
type Confirmed = { events: SnapshotMessage['events']; previous: RoomSnapshot; next: RoomSnapshot };
type Request = {
  path: string;
  body: Record<string, unknown>;
  kind: 'entry' | 'recovery' | 'control' | 'command';
  draft: boolean;
};
const LAST = 'online.lastRoom';
const TAB = 'online.controlRoom';

// 서버 상태와 요청 원장 및 화면 수명을 함께 관리한다.
export class OnlineController {
  private view: OnlineView = {
    phase: 'entry',
    snapshot: null,
    connection: 'offline',
    hasControl: false,
    pending: false,
    recovery: null,
    error: null,
  };
  private listeners = new Set<() => void>();
  private confirmed = new Set<(value: Confirmed) => void>();
  private knownEvents = new Map<string, KnownEvent>();
  private socket: SocketPort | null = null;
  private generation = 0;
  private sequence = 0;
  private streamSequence = 0;
  private epoch = 0;
  private active = false;
  private opened = false;
  private opening: Promise<void> | null = null;
  private closing: Promise<unknown> | null = null;
  private request: Request | null = null;
  private processing: Promise<boolean> | null = null;
  private queuedDraft: { potIndex: number; winners: WinnerSelection } | null = null;
  private sending = false;
  private polling: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;

  // API와 핸들러를 받는 소켓 생성자를 주입받는다.
  constructor(
    private readonly api: Pick<
      ApiClient,
      'open' | 'streamId' | 'get' | 'post' | 'refresh' | 'closeStream'
    >,
    private readonly makeSocket: (handlers: RoomSocketHandlers) => SocketPort,
  ) {}

  // 외부 저장소가 같은 객체를 읽도록 현재 화면을 반환한다.
  getView = (): OnlineView => this.view;
  // 서버 이벤트를 변형하지 않고 최근 이벤트의 표시 이름 메타데이터를 제공한다.
  getKnownEvents(): ReadonlyMap<string, KnownEvent> {
    return this.knownEvents;
  }
  // API 인스턴스를 노출하지 않고 현재 방의 토너먼트 기록을 조회한다.
  async loadEvents(tournamentId: string, after: number, limit: number): Promise<GameEvent[]> {
    const roomId = this.view.snapshot!.roomId;
    const query = new URLSearchParams({ tournamentId, after: String(after), limit: String(limit) });
    const result = await this.api.get<{ events: GameEvent[]; nextAfter: number }>(
      `/api/rooms/${encodeURIComponent(roomId)}/history?${query}`,
    );
    if (!result.ok) {
      if (!('unknown' in result) && result.status === 410) return [];
      throw new Error('기록을 불러오지 못했습니다.');
    }
    return result.body.events;
  }
  // 방의 최신 상태를 다시 구독하여 연결을 복구한다.
  reconnect(): void {
    if (this.active && this.view.phase === 'room') this.connect();
  }
  // 화면 변경 구독을 등록하고 해제 함수를 반환한다.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  // 연속 확정 상태의 효과 구독을 등록한다.
  onConfirmed(listener: (value: Confirmed) => void): () => void {
    this.confirmed.add(listener);
    return () => this.confirmed.delete(listener);
  }
  // 새 화면 값을 저장하고 모든 구독자에게 알린다.
  private update(patch: Partial<OnlineView>): void {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  // 활성 화면의 세션과 스트림을 한 번 준비한다.
  private async open(): Promise<boolean> {
    if (this.opened) return true;
    this.active = true;
    const epoch = this.epoch;
    try {
      if (this.closing) await this.closing;
      if (epoch !== this.epoch) return false;
      const opening = this.api.open();
      this.opening = opening;
      await opening;
      if (this.opening === opening) this.opening = null;
    } catch {
      if (epoch === this.epoch) this.update({ pending: false, error: messageFor('NOT_CONNECTED') });
      return false;
    }
    if (epoch !== this.epoch) {
      return false;
    }
    this.opened = true;
    this.streamSequence = 0;
    document.addEventListener('visibilitychange', this.onVisible);
    this.refreshTimer = setInterval(
      () => {
        if (document.visibilityState === 'visible') void this.api.refresh();
      },
      6 * 60 * 60 * 1000,
    );
    return true;
  }
  // 화면 복귀 시 세션을 갱신한다.
  private onVisible = (): void => {
    if (this.active && document.visibilityState === 'visible') void this.api.refresh();
  };
  // 스트림 원장의 공통 요청 필드를 만든다.
  private envelope(): Record<string, unknown> {
    return {
      protocolVersion: 1,
      streamId: this.api.streamId,
      requestId: crypto.randomUUID(),
      sequence: ++this.streamSequence,
    };
  }
  // 새 방을 생성한다.
  create(name: string): Promise<boolean> {
    return this.enter('/api/rooms', { name }, 'entry');
  }
  // 방 코드와 이름으로 참가한다.
  join(code: string, name: string): Promise<boolean> {
    return this.enter('/api/room-joins', { code, name }, 'entry');
  }
  // 기존 참가자 자리의 복구 승인을 요청한다.
  requestRecovery(code: string, name: string): Promise<boolean> {
    return this.enter('/api/recovery-requests', { code, name }, 'recovery');
  }
  // 입장 요청을 보관하여 명시적 재시도에도 같은 본문을 사용한다.
  private async enter(path: string, payload: object, kind: 'entry' | 'recovery'): Promise<boolean> {
    if (this.request || this.view.pending || this.view.phase === 'room') return false;
    const epoch = this.epoch;
    this.update({
      phase: kind === 'recovery' ? 'recovering' : 'joining',
      snapshot: null,
      hasControl: false,
      pending: true,
      error: null,
    });
    if (!(await this.open()) || epoch !== this.epoch) {
      if (epoch === this.epoch) this.update({ phase: 'entry', pending: false });
      return false;
    }
    this.request = { path, body: { ...this.envelope(), ...payload }, kind, draft: false };
    return this.execute(false);
  }
  // 마지막 방을 조회하고 이 탭의 표시가 있을 때만 조작권을 인수한다.
  async resume(): Promise<boolean> {
    if (this.view.pending || this.request || this.view.phase === 'room') return false;
    const saved = localStorage.getItem(LAST);
    if (!saved) return false;
    let roomId: string;
    try {
      roomId = (JSON.parse(saved) as { roomId: string }).roomId;
    } catch {
      localStorage.removeItem(LAST);
      sessionStorage.removeItem(TAB);
      return false;
    }
    const epoch = this.epoch;
    this.update({ phase: 'joining', pending: true });
    if (!(await this.open()) || epoch !== this.epoch) {
      if (epoch === this.epoch) {
        localStorage.removeItem(LAST);
        sessionStorage.removeItem(TAB);
        this.update({ phase: 'entry', pending: false });
      }
      return false;
    }
    const result = await this.api.get(`/api/rooms/${encodeURIComponent(roomId)}/state`);
    if (epoch !== this.epoch) return false;
    if (!result.ok || !isRoomSnapshot(result.body)) {
      localStorage.removeItem(LAST);
      sessionStorage.removeItem(TAB);
      this.update({
        phase: 'entry',
        pending: false,
        error: messageFor(!result.ok && !('unknown' in result) ? result.code : 'NOT_CONNECTED'),
      });
      return false;
    }
    this.generation = result.body.you.controlGeneration;
    this.apply(result.body);
    this.update({ phase: 'room', pending: false, hasControl: false });
    this.connect();
    if (sessionStorage.getItem(TAB) === roomId) return this.takeControl();
    return true;
  }
  // 입장 응답의 세대와 저장 가능한 방 정보만 보관한다.
  private joined(body: unknown): boolean {
    if (!isJoinResponse(body)) return false;
    this.generation = body.controlGeneration;
    this.sequence = 0;
    localStorage.setItem(LAST, JSON.stringify({ roomId: body.roomId, code: body.code }));
    sessionStorage.setItem(TAB, body.roomId);
    this.apply(body.state);
    this.update({
      phase: 'room',
      pending: false,
      hasControl: body.state.you.controlGeneration === this.generation,
      recovery: null,
    });
    this.connect();
    return true;
  }
  // 현재 수명에 속한 소켓 콜백만 처리한다.
  private connect(): void {
    this.socket?.close();
    const epoch = this.epoch;
    this.update({ connection: 'syncing' });
    this.socket = this.makeSocket({
      // 수신 상태를 적용한 뒤 연결 동기화를 확정한다.
      onSnapshot: (message) => {
        if (epoch !== this.epoch || !this.active) return;
        this.apply(message.state, message);
        this.update({ connection: 'online' });
      },
      // 최종 메시지에 맞는 종료 단계를 설정한다.
      onFinal: (type) => {
        if (epoch === this.epoch) this.finish(type);
      },
      // 화면보다 높은 서버 버전을 발견하면 동기화를 요청한다.
      onPing: (version) => {
        if (epoch === this.epoch && version > (this.view.snapshot?.stateVersion ?? -1)) {
          this.update({ connection: 'syncing' });
          this.socket?.resync();
        }
      },
      // 열린 소켓에서도 스냅샷을 받기 전에는 조작을 잠근다.
      onState: (state) => {
        if (epoch !== this.epoch || !this.active) return;
        this.queuedDraft = null;
        this.update({ connection: state === 'waiting' ? 'offline' : 'syncing' });
        if (state === 'open' && this.request) void this.retry();
      },
    });
    this.socket.subscribe(this.view.snapshot!.roomId, this.view.snapshot!.stateVersion);
  }
  // 토너먼트와 버전 쌍으로 상태 적용 및 효과 재생을 결정한다.
  private apply(next: RoomSnapshot, message?: SnapshotMessage): void {
    const previous = this.view.snapshot;
    const same = previous?.tournamentId === next.tournamentId;
    if (previous && same) {
      if (
        next.stateVersion < previous.stateVersion ||
        (next.stateVersion === previous.stateVersion && next.draftVersion < previous.draftVersion)
      )
        return;
      if (
        message &&
        next.stateVersion === previous.stateVersion &&
        next.draftVersion === previous.draftVersion &&
        message.previousVersion !== null
      )
        return;
    }
    if (next.you.controlGeneration > this.generation) this.queuedDraft = null;
    if (!same) this.knownEvents.clear();
    const fresh: GameEvent[] = [];
    for (const event of message?.events ?? []) {
      if (this.knownEvents.has(event.id)) continue;
      fresh.push(event);
      const id = event.details.playerId;
      const actorName =
        next.game?.players.find((p) => p.id === id)?.name ??
        previous?.game?.players.find((p) => p.id === id)?.name;
      this.knownEvents.set(event.id, { event, actorName });
    }
    while (this.knownEvents.size > 200)
      this.knownEvents.delete(this.knownEvents.keys().next().value!);
    try {
      if (
        previous &&
        same &&
        message?.previousVersion === previous.stateVersion &&
        next.stateVersion > previous.stateVersion
      )
        this.confirmed.forEach((listener) => listener({ events: fresh, previous, next }));
    } finally {
      // 구독자가 이전 DOM에서 좌표를 준비한 뒤 확정 상태를 화면에 적용한다.
      this.update({
        snapshot: next,
        ...(next.you.controlGeneration > this.generation ? { hasControl: false } : {}),
      });
    }
  }
  // 일반 명령 목록을 초안 뒤에서 순서대로 실행한다.
  async send(commands: ServerCommand[]): Promise<boolean> {
    if (
      this.sending ||
      this.view.pending ||
      this.view.connection !== 'online' ||
      !this.view.hasControl ||
      (this.request && !this.request.draft)
    )
      return false;
    this.sending = true;
    this.update({ pending: true });
    const epoch = this.epoch;
    try {
      if (this.processing) await this.processing;
      if (epoch !== this.epoch) return false;
      while (this.queuedDraft && !this.request) await this.flushDraft();
      if (this.request || epoch !== this.epoch) return false;
      for (const command of commands) {
        if (
          epoch !== this.epoch ||
          this.view.connection !== 'online' ||
          !this.view.hasControl ||
          !(await this.command(command, false))
        )
          return false;
      }
      return true;
    } finally {
      if (epoch === this.epoch) {
        this.sending = false;
        this.update({ pending: this.request !== null });
      }
    }
  }
  // 최신 승자 선택 한 건만 대기시킨다.
  sendDraft(potIndex: number, winners: WinnerSelection): void {
    if (
      this.view.connection !== 'online' ||
      !this.view.hasControl ||
      this.view.pending ||
      this.sending ||
      (this.request && !this.request.draft)
    )
      return;
    this.queuedDraft = { potIndex, winners: structuredClone(winners) };
    if (!this.request && !this.processing) void this.flushDraft();
  }
  // 대기 중인 최신 초안을 전송한다.
  private async flushDraft(): Promise<boolean> {
    const draft = this.queuedDraft;
    this.queuedDraft = null;
    if (!this.active || this.view.connection !== 'online' || !this.view.hasControl) return false;
    return draft
      ? this.command({ type: 'SETTLEMENT_DRAFT', payload: draft, handScoped: true }, true)
      : true;
  }
  // 최신 상태의 식별자로 세대별 명령을 만든다.
  private command(command: ServerCommand, draft: boolean): Promise<boolean> {
    const state = this.view.snapshot!;
    this.request = {
      kind: 'command',
      draft,
      path: `/api/rooms/${encodeURIComponent(state.roomId)}/commands`,
      body: {
        protocolVersion: 1,
        requestId: crypto.randomUUID(),
        sequence: ++this.sequence,
        controlGeneration: this.generation,
        expectedStateVersion: state.stateVersion,
        tournamentId: state.tournamentId,
        ...(command.handScoped ? { handId: state.game?.hand?.id ?? null } : {}),
        type: command.type,
        ...(command.payload ? { payload: structuredClone(command.payload) } : {}),
      },
    };
    return this.execute(false);
  }
  // 스트림 원장 순서로 새 조작 세대를 요청한다.
  async takeControl(): Promise<boolean> {
    if (
      this.request ||
      !this.view.snapshot ||
      this.view.pending ||
      !this.active ||
      this.view.phase !== 'room'
    )
      return false;
    this.update({ pending: true });
    this.request = {
      path: `/api/rooms/${encodeURIComponent(this.view.snapshot.roomId)}/control`,
      body: {
        ...this.envelope(),
        expectedControlGeneration: this.view.snapshot.you.controlGeneration,
      },
      kind: 'control',
      draft: false,
    };
    return this.execute(false);
  }
  // 결과 불명 요청을 보관된 식별자와 본문으로 해결한다.
  retry(): Promise<boolean> {
    return this.processing ?? (this.request ? this.execute(true) : Promise.resolve(false));
  }
  // 동시에 한 개의 HTTP 처리만 시작한다.
  private execute(lookup: boolean): Promise<boolean> {
    const work = this.perform(lookup);
    this.processing = work;
    // 완료한 처리만 해제하고 최신 초안을 이어서 보낸다.
    void work.finally(() => {
      if (this.processing === work) {
        this.processing = null;
        if (this.queuedDraft && !this.request && !this.sending && this.active)
          void this.flushDraft();
      }
    });
    return work;
  }
  // 원장 조회와 응답 검증으로 보관된 요청을 확정한다.
  private async perform(lookup: boolean): Promise<boolean> {
    const request = this.request!;
    const epoch = this.epoch;
    let result: ApiResult<unknown>;
    if (lookup && request.kind === 'command') {
      result = await this.api.get(
        `/api/rooms/${encodeURIComponent(this.view.snapshot!.roomId)}/requests/${encodeURIComponent(String(request.body.requestId))}`,
      );
      if (epoch !== this.epoch) return false;
      if (!result.ok && !('unknown' in result) && result.code === 'REQUEST_NOT_FOUND')
        result = await this.api.post(request.path, request.body);
    } else result = await this.api.post(request.path, request.body);
    if (epoch !== this.epoch) return false;
    if ('unknown' in result) {
      this.update({ pending: true, error: messageFor('NOT_CONNECTED') });
      return false;
    }
    const body = result.body;
    if (request.kind === 'command' && isCommandResponse(body)) {
      if (body.requestId !== request.body.requestId || body.sequence !== request.body.sequence) {
        this.update({ pending: true, error: messageFor('NOT_CONNECTED') });
        return false;
      }
      if (body.latestState) this.apply(body.latestState);
      this.request = null;
      this.update({
        pending: this.sending,
        error: body.outcome === 'REJECTED' ? messageFor(body.code) : null,
      });
      if (body.outcome === 'REJECTED') {
        await this.reject(body.code);
        return false;
      }
      if (request.body.type === 'LEAVE') {
        localStorage.removeItem(LAST);
        this.leaveRoomScreen();
      }
      return true;
    }
    if (!result.ok) {
      this.request = null;
      this.update({
        pending: this.sending,
        error: messageFor(result.code),
        ...(request.kind === 'entry' || request.kind === 'recovery'
          ? { phase: 'entry' as const }
          : {}),
      });
      if (
        result.code !== 'ROOM_NOT_FOUND' ||
        request.kind === 'command' ||
        request.kind === 'control'
      )
        await this.reject(result.code);
      return false;
    }
    if (request.kind === 'entry' && isJoinResponse(body)) {
      this.request = null;
      return this.joined(body);
    }
    if (request.kind === 'recovery' && isRecoveryRequestResponse(body)) {
      this.request = null;
      this.update({
        pending: false,
        recovery: {
          recoveryRequestId: body.recoveryRequestId,
          status: body.status === 'APPROVED' ? 'PENDING' : body.status,
        },
      });
      void this.pollRecovery(body.recoveryRequestId);
      return true;
    }
    if (
      request.kind === 'control' &&
      typeof body === 'object' &&
      body !== null &&
      'requestId' in body &&
      body.requestId === request.body.requestId &&
      'sequence' in body &&
      body.sequence === request.body.sequence &&
      'outcome' in body &&
      body.outcome === 'APPLIED' &&
      'controlGeneration' in body &&
      typeof body.controlGeneration === 'number' &&
      'latestState' in body &&
      isRoomSnapshot(body.latestState)
    ) {
      this.request = null;
      this.generation = body.controlGeneration;
      this.sequence = 0;
      this.apply(body.latestState);
      sessionStorage.setItem(TAB, body.latestState.roomId);
      this.update({
        pending: false,
        hasControl: this.generation === this.view.snapshot!.you.controlGeneration,
        error: null,
      });
      return true;
    }
    this.update({ pending: true, error: messageFor('NOT_CONNECTED') });
    return false;
  }
  // 권한 상실과 순번 오류를 서버 동기화로 복구한다.
  private async reject(code: string | undefined): Promise<void> {
    if (code === 'CONTROL_LOST') {
      this.queuedDraft = null;
      this.update({ hasControl: false });
    }
    if (
      ['SEQUENCE_GAP', 'REQUEST_CONFLICT', 'RESULT_EXPIRED'].includes(code ?? '') &&
      this.view.snapshot
    ) {
      this.update({ connection: 'syncing', pending: false, hasControl: false });
      this.socket?.resync();
      await this.takeControl();
    }
    if (code === 'ROOM_NOT_FOUND') this.finish('ROOM_GONE');
    if (code === 'PROTOCOL_INCOMPATIBLE') this.finish(code);
  }
  // 복구 승인이 나올 때까지 삼 초 간격으로 결과를 조회한다.
  private async pollRecovery(id: string): Promise<void> {
    const epoch = this.epoch;
    const result = await this.api.get(`/api/recovery-requests/${encodeURIComponent(id)}`);
    if (epoch !== this.epoch) return;
    if (result.ok && isRecoveryStatus(result.body)) {
      this.update({ recovery: result.body });
      if (result.body.status === 'APPROVED') {
        this.joined(result.body);
        return;
      }
      if (result.body.status !== 'PENDING') {
        const reasons = {
          REJECTED: '방장이 복구 신청을 거절했습니다.',
          EXPIRED: '복구 신청이 만료되었습니다.',
          SUPERSEDED: '다른 복구 신청으로 대체되었습니다.',
        };
        this.update({ phase: 'entry', pending: false, error: reasons[result.body.status] });
        return;
      }
    }
    this.polling = setTimeout(() => {
      void this.pollRecovery(id);
    }, 3000);
  }
  // 최종 메시지에 맞는 단계를 보관하고 모든 채널을 종료한다.
  private finish(type: FinalMessage): void {
    if (type === 'ACCESS_REVOKED' && this.request?.body.type === 'LEAVE') {
      localStorage.removeItem(LAST);
      this.leaveRoomScreen();
      return;
    }
    this.stop();
    this.update({
      phase: type === 'ROOM_GONE' ? 'gone' : type === 'ACCESS_REVOKED' ? 'revoked' : 'incompatible',
      connection: 'offline',
      hasControl: false,
      pending: false,
    });
  }
  // 현재 화면의 비동기 처리와 타이머 및 스트림을 무효화한다.
  private stop(): void {
    ++this.epoch;
    this.active = false;
    this.opened = false;
    clearTimeout(this.polling);
    clearInterval(this.refreshTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.socket?.close();
    this.socket = null;
    this.request = null;
    this.queuedDraft = null;
    this.processing = null;
    this.sending = false;
    if (!this.closing) {
      this.closing = this.opening
        ? this.opening.catch(() => {}).then(() => this.api.closeStream())
        : this.api.closeStream();
      const closing = this.closing;
      // 삭제가 끝난 스트림만 해제하여 다음 준비 요청과 겹치지 않게 한다.
      void closing.finally(() => {
        if (this.closing === closing) this.closing = null;
      });
    }
  }
  // 방 화면만 떠나고 다시 찾을 마지막 방 정보는 보관한다.
  leaveRoomScreen(): void {
    this.stop();
    sessionStorage.removeItem(TAB);
    this.update({
      phase: 'entry',
      snapshot: null,
      connection: 'offline',
      hasControl: false,
      pending: false,
      recovery: null,
      error: null,
    });
  }
  // 컨트롤러의 외부 구독과 브라우저 자원을 모두 정리한다.
  dispose(): void {
    this.stop();
    this.listeners.clear();
    this.confirmed.clear();
  }
}
