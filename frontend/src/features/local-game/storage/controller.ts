import type { LocalRepository } from './repository';
import type { ControlLease, Request, DispatchResult } from './types';
import type { GameState } from '../../../game/types';
import type { GameSettings } from '../../../game/settings';
import { storageDeadline } from './storageDeadline';
// 조작권(lease)과 요청 순서를 관리하며 명령을 저장소에 보내는 컨트롤러
export class LocalController {
  lease: ControlLease | null = null;
  state: GameState | null = null;
  pending: Request | null = null;
  private sequence = 0;
  private running = false;
  private refreshVersion = 0;
  constructor(
    private repository: LocalRepository,
    private screenId: string,
  ) {}
  // 이 화면이 조작권을 가져오고 상태를 다시 읽는다
  async takeControl() {
    if (this.running) throw Error('저장 중입니다. 잠시만 기다려 주세요.');
    this.lease = await this.repository.takeControl(this.screenId);
    this.sequence = 0;
    this.pending = null;
    await this.refresh();
  }
  // 저장소의 게임과 조작권을 읽어 최신 상태로 맞춘다
  async refresh() {
    const version = ++this.refreshVersion;
    const [saved, c] = await storageDeadline(
      Promise.all([this.repository.load(), this.repository.control()]),
      '복원',
      () => {
        if (this.refreshVersion === version) this.refreshVersion++;
      },
    );
    if (version !== this.refreshVersion) return;
    this.state = saved?.state ?? null;
    if (
      this.lease &&
      (c?.screenId !== this.lease.screenId || c.generation !== this.lease.generation)
    ) {
      this.lease = null;
      this.pending = null;
    }
    if (this.lease && c && !this.running && !this.pending) this.sequence = c.highWatermark;
  }
  // 진행 중인 refresh 결과를 무시하도록 표시한다
  cancelRefresh() {
    this.refreshVersion++;
  }
  // 저장소를 비우고 새 토너먼트와 조작권으로 다시 시작한다
  async restart(settings: GameSettings) {
    if (this.running) throw Error('저장 중입니다. 잠시만 기다려 주세요.');
    this.cancelRefresh();
    const result = await this.repository.restart(settings, this.screenId);
    this.lease = result.lease;
    this.state = result.state;
    this.sequence = 0;
    this.pending = null;
  }
  // 명령을 요청으로 만들어 대기 상태로 두고 저장소에 보낸다
  async dispatch(command: Request['command']): Promise<DispatchResult> {
    if (this.running || this.pending)
      return { status: 'REJECTED', requestId: '', state: this.state, reason: 'REQUEST_PENDING' };
    if (!this.lease || !this.state)
      return { status: 'REJECTED', requestId: '', state: this.state, reason: 'CONTROL_LOST' };
    this.pending = {
      requestId: crypto.randomUUID(),
      sequence: this.sequence + 1,
      lease: this.lease,
      expectedVersion: this.state.version,
      tournamentId: this.state.tournamentId,
      handId: this.state.hand?.id,
      command,
    };
    return this.retry();
  }
  // 대기 중인 요청을 저장소로 (재)전송하고 결과를 반영한다
  async retry(): Promise<DispatchResult> {
    if (this.running || !this.pending)
      return { status: 'REJECTED', requestId: '', state: this.state, reason: 'NO_PENDING_REQUEST' };
    const request = this.pending;
    this.running = true;
    try {
      const result = await this.repository.dispatch(request);
      if (
        this.pending !== request ||
        this.lease?.screenId !== request.lease.screenId ||
        this.lease?.generation !== request.lease.generation
      )
        return { ...result, state: this.state, reason: 'CONTROL_LOST' };
      if (result.status !== 'UNKNOWN') {
        this.sequence = request.sequence;
        this.pending = null;
        if (result.state) this.state = result.state;
        if (result.reason === 'CONTROL_LOST') this.lease = null;
      }
      return result;
    } finally {
      this.running = false;
    }
  }
}
