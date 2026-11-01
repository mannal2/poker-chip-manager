export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; code: string | undefined; body: unknown }
  | { ok: false; unknown: true };

// 초기 연결 실패의 HTTP 결과를 호출자에게 전달한다.
export class ApiOpenError extends Error {
  // 초기화가 실패한 단계와 결과를 보관한다.
  constructor(public readonly result: ApiResult<unknown>) {
    super('온라인 세션 또는 스트림을 준비하지 못했습니다.');
  }
}

// 세션 토큰을 메모리에 보관하고 REST 요청과 화면 스트림 수명을 관리한다.
export class ApiClient {
  private csrfToken = '';
  streamId: string | null = null;

  // 세션 토큰을 받은 뒤 화면 스트림을 등록한다.
  async open(): Promise<void> {
    const session = await this.loadSession();
    if (!session.ok) throw new ApiOpenError(session);
    const stream = await this.post<{ streamId: string }>('/api/session/streams', {});
    if (!stream.ok) throw new ApiOpenError(stream);
    if (typeof stream.body?.streamId !== 'string')
      throw new ApiOpenError({ ok: false, unknown: true });
    this.streamId = stream.body.streamId;
  }

  // 세션 유지 응답으로 메모리 토큰을 갱신한다.
  async refresh(): Promise<ApiResult<{ csrfToken: string; protocolVersion: number }>> {
    const result = await this.post<{ csrfToken: string; protocolVersion: number }>(
      '/api/session/refresh',
      {},
    );
    return this.acceptSession(result);
  }

  // 문서 종료 중에도 스트림 삭제 요청을 전달한다.
  async closeStream(): Promise<ApiResult<void>> {
    if (this.streamId === null) return { ok: true, status: 204, body: undefined };
    const result = await this.request<void>(
      `/api/session/streams/${encodeURIComponent(this.streamId)}`,
      'DELETE',
      undefined,
      true,
    );
    if (result.ok) this.streamId = null;
    return result;
  }

  // 변경 요청에 CSRF 토큰을 붙여 전송한다.
  async post<T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> {
    try {
      return this.request<T>(path, 'POST', JSON.stringify(body));
    } catch {
      return { ok: false, unknown: true };
    }
  }

  // 조회 요청을 쿠키 인증과 함께 전송한다.
  get<T = unknown>(path: string): Promise<ApiResult<T>> {
    return this.request<T>(path, 'GET');
  }

  // 세션 조회로 CSRF 토큰을 다시 받는다.
  private async loadSession() {
    return this.acceptSession(
      await this.get<{ csrfToken: string; protocolVersion: number }>('/api/session'),
    );
  }

  // 유효한 세션 응답의 토큰만 보관한다.
  private acceptSession(
    result: ApiResult<{ csrfToken: string; protocolVersion: number }>,
  ): ApiResult<{ csrfToken: string; protocolVersion: number }> {
    if (result.ok) {
      if (typeof result.body?.csrfToken !== 'string' || result.body.protocolVersion !== 1)
        return { ok: false, unknown: true };
      this.csrfToken = result.body.csrfToken;
    }
    return result;
  }

  // 결과 불명 요청은 재전송하지 않고 CSRF 거절만 최대 한 번 재시도한다.
  private async request<T>(
    path: string,
    method: string,
    body?: string,
    keepalive = false,
    retry = true,
  ): Promise<ApiResult<T>> {
    try {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive,
        headers:
          method === 'GET'
            ? {}
            : { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': this.csrfToken },
        ...(body === undefined ? {} : { body }),
      });
      if (response.status >= 500) return { ok: false, unknown: true };
      const value = response.status === 204 ? undefined : await response.json();
      if (response.ok) return { ok: true, status: response.status, body: value as T };
      const code = typeof value?.code === 'string' ? value.code : undefined;
      if (method !== 'GET' && response.status === 403 && code === 'CSRF_REJECTED' && retry) {
        const session = await this.loadSession();
        if (!session.ok) return session;
        return this.request<T>(path, method, body, keepalive, false);
      }
      return { ok: false, status: response.status, code, body: value };
    } catch {
      return { ok: false, unknown: true };
    }
  }
}
