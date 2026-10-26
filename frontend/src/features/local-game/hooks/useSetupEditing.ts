import { useRef, useState } from 'react';
import { validateSettings, type GameSettings } from '../../../game/settings';
import type { GameCommand, GameState } from '../../../game/types';
import { useSeatDrag } from '../../gameplay/hooks/useSeatDrag';

export function useSetupEditing({
  state: s,
  generation,
  busy,
  notify,
  isLocked,
  getSettings,
  run,
  dispatch,
}: {
  state: GameState | null;
  generation: number | undefined;
  busy: boolean;
  notify: (message: string) => void;
  isLocked: () => boolean;
  getSettings: () => GameSettings;
  run: (action: () => Promise<void>) => Promise<void>;
  dispatch: (command: GameCommand) => Promise<boolean>;
}) {
  const [renameId, setRenameId] = useState('');
  const finishName = useRef<{ key: string; finish: () => Promise<boolean> } | null>(null);
  const draftScope = s?.tournamentId + ':' + generation;
  function saveSettings(settings: GameSettings, order?: string[]) {
    if (busy) return notify('저장 완료를 기다려주세요.');
    void run(async () => {
      await dispatch({ type: 'SETUP_UPDATE', settings, order });
    });
  }
  const drag = useSeatDrag(
    s?.players.map((p) => p.id) ?? [],
    !busy && s?.status === 'setup' && !renameId.startsWith(draftScope + ':'),
    s?.settings.viewSeat ?? 0,
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
  function changeCount(add: boolean) {
    if (!s || busy || s.status !== 'setup') return;
    const n = s.players.length;
    if (add) {
      if (n >= 10) return;
      const settings = { ...s.settings, names: [...s.settings.names, `P${n + 1}`] };
      const v = validateSettings(settings);
      if (!v.ok)
        return notify(`P${n + 1} 이름이 이미 사용 중입니다. 해당 이름을 변경한 뒤 추가하세요.`);
      saveSettings(v.settings);
    } else {
      if (n <= 2) return;
      const latest = (s.setupOrder ?? s.players.map((p) => p.id)).at(-1)!;
      const players = s.players.filter((p) => p.id !== latest);
      const dealer = s.players[s.settings.button]?.id;
      saveSettings(
        {
          ...s.settings,
          names: players.map((p) => p.name),
          button: players.findIndex((p) => p.id === dealer),
          viewSeat: Math.min(s.settings.viewSeat, players.length - 1),
        },
        players.map((p) => p.id),
      );
    }
  }
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
            notify(v.error);
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
  const rotate =
    s?.status === 'setup'
      ? () => {
          if (busy) return;
          void run(async () => {
            await dispatch({
              type: 'SET_VIEW',
              viewSeat: (s.settings.viewSeat + s.players.length - 1) % s.players.length,
            });
          });
        }
      : undefined;
  function start(settings: GameSettings) {
    if (renameId.startsWith(draftScope + ':'))
      return notify('이름 입력을 Enter로 저장하거나 다른 곳을 눌러 완료하세요.');
    if (busy) return notify('저장 완료를 기다려주세요.');
    const v = validateSettings(settings);
    if (!v.ok) return notify(v.error);
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
    changeCount,
    onNameEditing,
    rename,
    rotate,
    start,
    clearEditing,
  };
}
