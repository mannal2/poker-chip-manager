import type { LocalRepository, ControlLease, Request, DispatchResult } from './repository';
import type { GameState } from '../game/types';
export class LocalController {
  lease: ControlLease | null = null;
  state: GameState | null = null;
  pending: Request | null = null;
  private sequence = 0;
  private running = false;
  constructor(
    private repository: LocalRepository,
    private screenId: string,
  ) {}
  async takeControl() {
    if (this.running) throw Error('저장 완료를 기다려주세요.');
    this.lease = await this.repository.takeControl(this.screenId);
    this.sequence = 0;
    this.pending = null;
    await this.refresh();
  }
  async refresh() {
    this.state = (await this.repository.load())?.state ?? null;
    const c = await this.repository.control();
    if (
      this.lease &&
      (c?.screenId !== this.lease.screenId || c.generation !== this.lease.generation)
    ) {
      this.lease = null;
      this.pending = null;
    }
  }
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
