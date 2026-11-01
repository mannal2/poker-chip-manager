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
}

// 재연결 횟수에 따라 최대 15초 기준의 지터 지연을 계산한다.
export function reconnectDelay(attempt: number, random: () => number): number {
  return Math.min(1000 * 2 ** Math.min(attempt, 4), 15000) * (0.8 + random() * 0.4);
}

// 방 소켓의 구독과 생존 감시 및 재연결만 관리한다.
export class RoomSocket {
  state: SocketState = 'connecting';
  private socket: WebSocket | null = null;
  private stopped = false;
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
    this.connect();
  }

  // 호출자가 알고 있는 버전을 구독과 이후 PING 비교의 기준으로 설정한다.
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
    document.removeEventListener('visibilitychange', this.onVisibility);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  // 화면이 보이면 정지했을 수 있는 소켓을 지연 없이 교체한다.
  private onVisibility = (): void => {
    if (!this.stopped && document.visibilityState === 'visible') {
      clearTimeout(this.reconnectTimer);
      clearTimeout(this.watchdog);
      const socket = this.socket;
      this.socket = null;
      socket?.close();
      this.connect();
    }
  };

  // 현재 연결 상태를 구독자에게 전달한다.
  private setState(state: SocketState): void {
    this.state = state;
    this.handlers.onState(state);
  }

  // 새 소켓의 이벤트만 허용하고 이전 소켓의 콜백을 무시한다.
  private connect(): void {
    if (this.stopped) return;
    this.setState('connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;
    // 연결 성공 시 지연을 초기화하고 방을 다시 구독한다.
    socket.onopen = () => {
      if (this.socket !== socket || this.stopped) return;
      this.attempt = 0;
      this.setState('open');
      this.sendSubscription();
      this.watchPing();
    };
    // 마지막 메시지가 없는 종료는 코드와 관계없이 다시 연결한다.
    socket.onclose = () => {
      if (this.socket !== socket || this.stopped) return;
      this.wait();
    };
    // 검증한 서버 메시지만 현재 연결의 핸들러에 전달한다.
    socket.onmessage = (event) => {
      if (this.socket !== socket || this.stopped) return;
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
      } else if (isSnapshotMessage(message)) {
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
        if (message.stateVersion > (this.subscription?.lastSeenVersion ?? -1)) this.resync();
      }
    };
  }

  // 끊어진 소켓을 폐기하고 다음 재연결을 예약한다.
  private wait(): void {
    clearTimeout(this.watchdog);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setState('waiting');
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
