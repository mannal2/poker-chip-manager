import { useRef, useState } from 'react';
import { validateSettings, type GameSettings } from '../../../game/settings';
import type { GameCommand, GameState } from '../../../game/types';
import { useSeatDrag } from './useSeatDrag';
import { messageFor } from '../model/errorMessages';

/** Setup editing shared by modes: seat order, names, first dealer, settings and start. */
export function useSetupEditing({
  state: s,
  scope: draftScope,
  viewSeat,
  busy,
  notify,
  isLocked,
  getSettings,
  run,
  dispatch,
}: {
  state: GameState | null;
  /** Editing session key from the caller (local: tournament and control generation). */
  scope: string;
  /** Table slot drawn at the bottom, so drops land where the user sees them. */
  viewSeat: number;
  busy: boolean;
  notify: (message: string) => void;
  isLocked: () => boolean;
  getSettings: () => GameSettings;
  run: (action: () => Promise<void>) => Promise<void>;
  dispatch: (command: GameCommand) => Promise<boolean>;
}) {
  const [renameId, setRenameId] = useState('');
  const finishName = useRef<{ key: string; finish: () => Promise<boolean> } | null>(null);
  function saveSettings(settings: GameSettings, order?: string[]) {
    if (busy) return notify('저장 완료를 기다려주세요.');
    void run(async () => {
      await dispatch({ type: 'SETUP_UPDATE', settings, order });
    });
  }
  const drag = useSeatDrag(
    s?.players.map((p) => p.id) ?? [],
    !busy && s?.status === 'setup' && !renameId.startsWith(draftScope + ':'),
    viewSeat,
    (order) => {
      if (!s) return;
      const players = order.map((id) => s.players.find((p) => p.id === id)!);
      const buttonId = s.players[s.settings.button]?.id;
      saveSettings(
        {
          ...s.settings,
          names: players.map((p) => p.name),
          button: buttonId ? order.indexOf(buttonId) : -1,
        },
        order,
      );
    },
    (id) => {
      if (s) saveSettings({ ...s.settings, button: s.players.findIndex((p) => p.id === id) });
    },
    () => {
      const editor = finishName.current;
      return editor?.key.startsWith(draftScope + ':')
        ? editor.finish()
        : Promise.resolve(!busy && !isLocked());
    },
  );
  function onNameEditing(id: string, editing: boolean, finish?: () => Promise<boolean>) {
    const key = draftScope + ':' + id;
    if (editing) {
      finishName.current = { key, finish: finish! };
      setRenameId(key);
    } else if (finishName.current?.key === key) {
      finishName.current = null;
      setRenameId('');
    }
  }
  const rename =
    s?.status === 'setup'
      ? (id: string, name: string) => {
          if (busy || isLocked()) return false;
          const v = validateSettings({
            ...s.settings,
            names: s.players.map((p) => (p.id === id ? name : p.name)),
          });
          if (!v.ok) {
            notify(messageFor(v.code));
            return false;
          }
          if (JSON.stringify(v.settings) === JSON.stringify(s.settings)) return true;
          return (async () => {
            let saved = false;
            await run(async () => {
              saved = await dispatch({ type: 'SETUP_UPDATE', settings: v.settings });
            });
            return saved;
          })();
        }
      : undefined;
  function start(settings: GameSettings) {
    if (renameId.startsWith(draftScope + ':'))
      return notify('이름 입력을 Enter로 저장하거나 다른 곳을 눌러 완료하세요.');
    if (busy) return notify('저장 완료를 기다려주세요.');
    const v = validateSettings(settings);
    if (!v.ok) return notify(messageFor(v.code));
    if (settings.button < 0) return notify('첫 딜러로 시작할 플레이어 카드를 선택하세요.');
    void run(async () => {
      if (
        JSON.stringify(settings) !== JSON.stringify(getSettings()) &&
        !(await dispatch({ type: 'SETUP_UPDATE', settings }))
      )
        return;
      await dispatch({ type: 'START_TOURNAMENT' });
    });
  }
  function clearEditing() {
    setRenameId('');
  }
  return {
    scope: draftScope,
    drag,
    saveSettings,
    onNameEditing,
    rename,
    start,
    clearEditing,
  };
}
