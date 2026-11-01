import { isSnapshotMessage, type SnapshotMessage } from '../api/types';

export type SocketState = 'connecting' | 'open' | 'waiting';
export type FinalMessage = 'ACCESS_REVOKED' | 'ROOM_GONE' | 'PROTOCOL_INCOMPATIBLE';
export interface RoomSocketHandlers {
  // 검증한 서버 스냅샷을 화면 소유자에게 전달한다.
  onSnapshot(message: SnapshotMessage): void;
  // 연결을 종료하는 서버 메시지 종류를 전달한다.
  onFinal(type: FinalMessage): void;
  // 서버가 알린 확정 상태 버전을 전달한다.
  onPing(stateVersion: number): void;
  // 연결 단계가 바뀌면 화면 소유자에게 전달한다.
  onState(state: SocketState): void;
  // 서버가 연결 수 한도로 이 화면을 받지 못했음을 전달한다.
  onTooManyScreens?(): void;
}

const TRY_LATER = 1013;

// 재연결 횟수에 따라 최대 15초 기준의 지터 지연을 계산한다.
export function reconnectDelay(attempt: number, random: () => number): number {
  return Math.min(1000 * 2 ** Math.min(attempt, 4), 15000) * (0.8 + random() * 0.4);
}

// 방 소켓의 구독과 생존 감시 및 재연결만 관리한다.
export class RoomSocket {
  state: SocketState = 'connecting';
  private socket: WebSocket | null = null;
  private retained: WebSocket | null = null;
  private handshake: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private offline = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private subscription: { roomId: string; lastSeenVersion: number | null } | null = null;
  private tournamentId: string | null | undefined;

  // 화면 복귀 이벤트를 등록하고 첫 연결을 시작한다.
  constructor(
    private readonly url: string,
    private readonly handlers: RoomSocketHandlers,
  ) {
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('online', this.onOnline);
    this.connect();
  }

  // 호출자가 알고 있는 버전을 구독 시 마지막 수신 버전으로 설정한다.
  subscribe(roomId: string, lastSeenVersion: number | null): void {
    if (this.subscription?.roomId !== roomId) this.tournamentId = undefined;
    this.subscription = { roomId, lastSeenVersion };
    if (this.state === 'open') this.sendSubscription();
  }

  // 서버에 현재 방의 전체 상태를 요청한다.
  resync(): void {
    this.send({ type: 'RESYNC' });
  }

  // 재연결과 감시 및 화면 이벤트를 모두 정리한다.
  close(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdog);
    clearTimeout(this.handshake);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('online', this.onOnline);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.releaseRetained();
  }

  // 화면이 보이면 정지했을 수 있는 소켓을 지연 없이 교체한다.
  private onVisibility = (): void => {
    if (document.visibilityState === 'visible') this.reconnect();
  };

  // 수동 재접속과 화면 복귀 모두 기존 자리의 접속을 유지하며 구독을 교체한다.
  reconnect(): void {
    if (!this.stopped && !this.offline) {
      if (this.retained) {
        this.resync();
        return;
      }
      clearTimeout(this.reconnectTimer);
      clearTimeout(this.watchdog);
      const socket = this.socket;
      this.socket = null;
      if (socket?.readyState === 1) this.retained = socket;
      else socket?.close();
      this.connect();
    }
  }

  // 브라우저의 연결 끊김 알림으로 소켓 종료를 기다리지 않고 조작을 잠근다.
  private onOffline = (): void => {
    this.offline = true;
    if (!this.stopped) this.wait();
  };

  // 네트워크 복귀 시 예약된 지연을 해제하고 최신 상태를 다시 구독한다.
  private onOnline = (): void => {
    if (this.stopped || !this.offline) return;
    this.offline = false;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdog);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.connect();
  };

  // 현재 연결 상태를 구독자에게 전달한다.
  private setState(state: SocketState): void {
    this.state = state;
    this.handlers.onState(state);
  }

  // 새 소켓의 이벤트만 허용하고 이전 소켓의 콜백을 무시한다.
  private connect(): void {
    if (this.stopped || this.offline) return;
    const previous = this.socket;
    this.setState('connecting');
    if (this.stopped || this.socket !== previous) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.boundHandshake();
    // 연결 성공 시 지연을 초기화하고 방을 다시 구독한다.
    socket.onopen = () => {
      if (this.socket !== socket || this.stopped) return;
      this.attempt = 0;
      this.setState('open');
      if (this.stopped || this.socket !== socket) return;
      this.sendSubscription();
      this.watchPing();
    };
    // 마지막 메시지가 없는 종료는 코드와 관계없이 다시 연결한다.
    socket.onclose = (event) => {
      if (socket === this.retained) this.retained = null;
      if (this.socket !== socket || this.stopped) return;
      if (event.code === TRY_LATER) this.handlers.onTooManyScreens?.();
      this.recoverHandshake();
    };
    // 검증한 서버 메시지만 현재 연결의 핸들러에 전달한다.
    socket.onmessage = (event) => {
      if ((this.socket !== socket && this.retained !== socket) || this.stopped) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;
      if (['ACCESS_REVOKED', 'ROOM_GONE', 'PROTOCOL_INCOMPATIBLE'].includes(message.type)) {
        this.close();
        this.handlers.onFinal(message.type as FinalMessage);
      } else if (this.retained === socket) {
        if (message.type === 'PING' && typeof message.nonce === 'string' && socket.readyState === 1)
          socket.send(JSON.stringify({ type: 'PONG', nonce: message.nonce }));
      } else if (isSnapshotMessage(message)) {
        clearTimeout(this.handshake);
        this.releaseRetained();
        // 전달 버전만 추적한다. 실제 적용 여부와 토너먼트별 병합은 컨트롤러가 판단한다.
        if (this.subscription) {
          this.subscription.lastSeenVersion =
            this.tournamentId === message.state.tournamentId
              ? Math.max(this.subscription.lastSeenVersion ?? -1, message.state.stateVersion)
              : message.state.stateVersion;
          this.tournamentId = message.state.tournamentId;
        }
        this.handlers.onSnapshot(message);
      } else if (
        message.type === 'PING' &&
        typeof message.nonce === 'string' &&
        Number.isSafeInteger(message.stateVersion)
      ) {
        this.watchPing();
        this.send({ type: 'PONG', nonce: message.nonce });
        this.handlers.onPing(message.stateVersion);
      }
    };
  }

  // 새 구독이 확인되거나 방을 떠나면 보관한 이전 연결을 해제한다.
  private releaseRetained(): void {
    const socket = this.retained;
    this.retained = null;
    socket?.close();
  }

  // 교체가 거절되면 이전 연결을 재확인하고 양쪽 모두 응답하지 않으면 재접속한다.
  private recoverHandshake(): void {
    const previous = this.retained;
    if (previous?.readyState !== 1) return this.wait();
    const failed = this.socket;
    this.socket = previous;
    this.retained = null;
    failed?.close();
    this.setState('open');
    if (this.stopped || this.socket !== previous) return;
    this.resync();
    this.boundHandshake();
    this.watchPing();
  }

  // 새 연결과 기존 연결의 확인을 각각 십 초로 제한한다.
  private boundHandshake(): void {
    clearTimeout(this.handshake);
    this.handshake = setTimeout(() => this.recoverHandshake(), 10000);
  }

  // 끊어진 소켓을 폐기하고 다음 재연결을 예약한다.
  private wait(): void {
    clearTimeout(this.handshake);
    this.releaseRetained();
    clearTimeout(this.watchdog);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setState('waiting');
    if (this.stopped || this.socket !== null) return;
    this.reconnectTimer = setTimeout(
      () => this.connect(),
      reconnectDelay(this.attempt++, Math.random),
    );
  }

  // 마지막 PING 이후 45초가 지나면 연결을 교체한다.
  private watchPing(): void {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.wait(), 45000);
  }

  // 현재 연결에 방과 재접속 기준 버전을 보낸다.
  private sendSubscription(): void {
    if (this.subscription)
      this.send({ type: 'SUBSCRIBE', ...this.subscription, protocolVersion: 1 });
  }

  // 열린 연결에만 메시지를 보내며 끊긴 동안에는 보관하지 않는다.
  private send(message: object): void {
    if (!this.stopped && this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }
}
