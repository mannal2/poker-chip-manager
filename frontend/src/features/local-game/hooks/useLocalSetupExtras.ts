import { validateSettings, type GameSettings } from '../../../game/settings';
import type { GameState } from '../../../game/types';

/** Local-only setup action: changing the player count (online seats come from the room). */
export function useLocalSetupExtras({
  state: s,
  busy,
  notify,
  saveSettings,
}: {
  state: GameState | null;
  busy: boolean;
  notify: (message: string) => void;
  saveSettings: (settings: GameSettings, order?: string[]) => void;
}) {
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
        },
        players.map((p) => p.id),
      );
    }
  }
  return { changeCount };
}
