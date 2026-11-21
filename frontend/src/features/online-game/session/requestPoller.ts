import type { ApiClient } from '../api/client';

const INTERVAL = 3000;

// 신청 조회 결과를 받는 쪽의 알림
export interface RequestPollerEvents<T> {
  // 조회한 신청 상태를 전달한다
  onStatus(status: T): void;
  // 방이나 신청이 사라졌음을 서버 오류 코드로 전달한다
  onMissing(code: 'ROOM_NOT_FOUND' | 'REQUEST_NOT_FOUND'): void;
}

// 복구나 바이인 신청이 끝날 때까지 삼 초 간격으로 결과를 조회한다
export class RequestPoller<T extends { status: string }> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = true;

  // 조회 주소와 응답 검사 함수 및 결과 수신자를 받는다
  constructor(
    private readonly api: Pick<ApiClient, 'get'>,
    private readonly path: string,
    private readonly isStatus: (value: unknown) => value is T,
    private readonly events: RequestPollerEvents<T>,
  ) {}

  // 한 번 조회하고 대기 중이거나 응답이 없으면 다음 조회를 예약한다
  async poll(): Promise<void> {
    const result = await this.api.get(this.path);
    if (!this.active) return;
    if (
      !result.ok &&
      !('unknown' in result) &&
      result.status === 404 &&
      (result.code === 'ROOM_NOT_FOUND' || result.code === 'REQUEST_NOT_FOUND')
    )
      return this.events.onMissing(result.code);
    if (result.ok && this.isStatus(result.body)) {
      this.events.onStatus(result.body);
      if (result.body.status !== 'PENDING') return;
    }
    this.timer = setTimeout(() => void this.poll(), INTERVAL);
  }

  // 예약된 조회와 늦은 응답을 무시한다
  stop(): void {
    this.active = false;
    clearTimeout(this.timer);
  }
}
