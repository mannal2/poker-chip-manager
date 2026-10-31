import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StoredGame, ControlRecord } from './types';
import type { GameEvent } from '../../../game/types';
// IndexedDB의 저장소 구조(게임 슬롯, 이벤트, 조작권)
export interface PokerDB extends DBSchema {
  slot: { key: string; value: StoredGame };
  events: { key: [string, number]; value: GameEvent };
  control: { key: string; value: ControlRecord };
}
// IndexedDB 데이터베이스를 열고 저장소를 만든다
export function openDatabase(
  name: string,
  onBlocked: () => void,
  onTerminated: () => void,
): Promise<IDBPDatabase<PokerDB>> {
  return openDB<PokerDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore('slot');
      db.createObjectStore('events');
      db.createObjectStore('control');
    },
    blocked: onBlocked,
    blocking(_v, _n, event) {
      (event.target as IDBDatabase).close();
      onTerminated();
    },
    terminated: onTerminated,
  });
}
