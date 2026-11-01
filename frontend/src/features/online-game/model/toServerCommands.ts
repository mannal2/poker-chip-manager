import type { GameCommand } from '../../../game/types';
import type { RoomSnapshot, ServerCommand } from '../api/types';

// 서버가 현재 핸드 식별자를 요구하는 명령인지 확인한다.
export function isHandScoped(type: string): boolean {
  return [
    'CHECK',
    'CALL',
    'BET',
    'RAISE',
    'FOLD',
    'ALL_IN',
    'SETTLE_HAND',
    'SETTLEMENT_DRAFT',
  ].includes(type);
}

// 공통 화면 명령을 서버 payload와 순서가 명확한 요청 목록으로 바꾼다.
export function toServerCommands(command: GameCommand, snapshot: RoomSnapshot): ServerCommand[] {
  if (command.type === 'SETUP_UPDATE') {
    const result: ServerCommand[] = [];
    const current = snapshot.participants.map((p) => p.participantId);
    const order = command.order ?? current;
    const settings = command.settings;
    if (order.some((id, i) => id !== current[i]))
      result.push({
        type: 'SET_SEAT_ORDER',
        payload: { participantIds: order },
        handScoped: false,
      });
    const dealer = order[settings.button];
    if (dealer !== undefined && dealer !== current[snapshot.settings.button])
      result.push({ type: 'SET_DEALER', payload: { participantId: dealer }, handScoped: false });
    if (
      settings.initial !== snapshot.settings.initial ||
      settings.sb !== snapshot.settings.sb ||
      settings.bb !== snapshot.settings.bb
    )
      result.push({
        type: 'SET_SETTINGS',
        payload: { initial: settings.initial, sb: settings.sb, bb: settings.bb },
        handScoped: false,
      });
    const ownIndex = order.indexOf(snapshot.you.participantId);
    const own = snapshot.participants.find((p) => p.participantId === snapshot.you.participantId);
    if (own && settings.names[ownIndex] !== own.name)
      result.push({
        type: 'RENAME',
        payload: { name: settings.names[ownIndex] },
        handScoped: false,
      });
    return result;
  }
  const type = command.type === 'START_TOURNAMENT' ? 'START' : command.type;
  const base = { type, handScoped: isHandScoped(type) };
  switch (command.type) {
    case 'BET':
    case 'RAISE':
      return [{ ...base, payload: { additional: command.additional } }];
    case 'SETTLE_HAND':
      return [{ ...base, payload: { winners: command.winners } }];
    case 'SCHEDULE_BLINDS':
      return [{ ...base, payload: { sb: command.sb, bb: command.bb } }];
    default:
      return [base];
  }
}
