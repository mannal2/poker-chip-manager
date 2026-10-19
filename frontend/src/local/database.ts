import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StoredGame, ControlRecord } from './repository';
import type { GameEvent } from '../game/types';
export interface PokerDB extends DBSchema {
  slot: { key: string; value: StoredGame };
  events: { key: [string, number]; value: GameEvent };
  control: { key: string; value: ControlRecord };
}
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
