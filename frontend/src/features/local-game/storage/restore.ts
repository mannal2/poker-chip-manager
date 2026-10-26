import type { StoredGame } from './repository';
import { assertInvariants } from '../../../game/invariants';
import { validateSettings, validChips } from '../../../game/settings';
export function validateStored(value: StoredGame): void {
  if (value.schemaVersion !== 1)
    throw Error('지원하지 않는 저장 형식입니다. 원본을 보존하며 쓰기를 차단합니다.');
  if (value.rulesVersion !== 1)
    throw Error('지원하지 않는 게임 규칙입니다. 호환되는 앱으로 열어주세요.');
  const s = value.state;
  if (
    !s ||
    typeof s.tournamentId !== 'string' ||
    !s.tournamentId ||
    !Number.isSafeInteger(s.version) ||
    s.version < 0 ||
    !Number.isSafeInteger(value.eventSequence) ||
    value.eventSequence < 0
  )
    throw Error('저장 식별자·기록 경계가 손상되었습니다.');
  if (
    !['setup', 'playing', 'ended', 'aborted'].includes(s.status) ||
    !Array.isArray(s.players) ||
    s.players.length < 2 ||
    s.players.length > 10 ||
    !validateSettings(s.settings).ok ||
    s.players.length !== s.settings.names.length
  )
    throw Error('저장 설정이 손상되었습니다.');
  if (
    s.initialTotal !== s.settings.initial * s.players.length ||
    s.players.some((p, i) => p.name !== s.settings.names[i])
  )
    throw Error('저장 설정·참가자·총량이 일치하지 않습니다.');
  if (
    s.pendingBlinds &&
    (!validChips(s.pendingBlinds.sb) ||
      !validChips(s.pendingBlinds.bb) ||
      s.pendingBlinds.sb >= s.pendingBlinds.bb)
  )
    throw Error('블라인드 예약이 손상되었습니다.');
  if (
    s.status === 'setup' &&
    (s.hand !== null ||
      s.pot !== 0 ||
      s.undo !== null ||
      s.players.some(
        (p) => p.stack !== s.settings.initial || p.eliminated || p.folded || p.B !== 0 || p.H !== 0,
      ))
  )
    throw Error('준비 상태가 손상되었습니다.');
  if (
    s.players.some(
      (p) =>
        typeof p.id !== 'string' ||
        typeof p.name !== 'string' ||
        typeof p.folded !== 'boolean' ||
        typeof p.eliminated !== 'boolean' ||
        !(p.actedAt === null || Number.isSafeInteger(p.actedAt)) ||
        !Number.isSafeInteger(p.reopenAt),
    )
  )
    throw Error('저장 참가자 정보가 손상되었습니다.');
  if (
    s.setupOrder &&
    (!Array.isArray(s.setupOrder) ||
      s.setupOrder.length !== s.players.length ||
      new Set(s.setupOrder).size !== s.players.length ||
      s.setupOrder.some((id) => !s.players.some((p) => p.id === id)))
  )
    throw Error('저장 참가자 추가 순서가 손상되었습니다.');
  if (s.status !== 'setup' && s.settings.button < 0) throw Error('딜러 설정이 손상되었습니다.');
  if (s.status !== 'setup' && !s.hand) throw Error('핸드 정보가 없습니다.');
  if (s.hand) {
    const h = s.hand,
      n = s.players.length;
    if (
      !['betting', 'revealPending', 'revealed', 'settlement'].includes(h.phase) ||
      ![h.buttonSeat, h.sbSeat, h.bbSeat].every((v) => Number.isInteger(v) && v >= 0 && v < n) ||
      !Number.isInteger(h.street) ||
      h.street < 0 ||
      h.street > 3 ||
      !Number.isSafeInteger(h.number) ||
      h.number < 1 ||
      typeof h.id !== 'string' ||
      !h.id ||
      typeof h.showdown !== 'boolean' ||
      !Array.isArray(h.pending) ||
      new Set(h.pending).size !== h.pending.length ||
      h.pending.some(
        (id) => !s.players.some((p) => p.id === id && !p.folded && !p.eliminated && p.stack > 0),
      ) ||
      ![h.W, h.R, h.sb, h.bb].every((v) => Number.isSafeInteger(v) && v >= 0 && v % 5 === 0) ||
      h.R === 0 ||
      !validChips(h.sb) ||
      !validChips(h.bb) ||
      h.sb >= h.bb
    )
      throw Error('저장 핸드 정보가 손상되었습니다.');
  }
  assertInvariants(s);
  if (s.undo) {
    const old = { ...s.undo, undo: null };
    validateStored({ ...value, state: old });
    if (
      old.version >= s.version ||
      old.tournamentId !== s.tournamentId ||
      old.status !== 'playing' ||
      old.initialTotal !== s.initialTotal ||
      old.players.map((p) => p.id).join(',') !== s.players.map((p) => p.id).join(',') ||
      !old.hand ||
      !s.hand ||
      ![old.hand.number, old.hand.number + 1].includes(s.hand.number) ||
      (s.undo.eventIds !== undefined &&
        (!Array.isArray(s.undo.eventIds) ||
          !s.undo.eventIds.length ||
          s.undo.eventIds.some((id) => typeof id !== 'string' || !id)))
    )
      throw Error('저장 취소 경계가 손상되었습니다.');
  }
}
