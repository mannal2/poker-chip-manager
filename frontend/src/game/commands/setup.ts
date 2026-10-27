import { validateSettings } from '../settings';
import { requireRule, type CommandHandler } from '../rule';
import { startHand } from '../round';
import { createTournament } from '../tournament';

const startTournament: CommandHandler<'START_TOURNAMENT'> = (s, _cmd, c, events) => {
  requireRule(s.status === 'setup');
  const v = validateSettings(s.settings);
  requireRule(v.ok);
  requireRule(s.settings.button >= 0, 'DEALER_REQUIRED');
  s.status = 'playing';
  startHand(s, c, events);
};

const setupUpdate: CommandHandler<'SETUP_UPDATE'> = (s, cmd, c) => {
  requireRule(s.status === 'setup' && cmd.settings);
  const v = validateSettings(cmd.settings);
  requireRule(v.ok, 'INVALID_SETTINGS');
  const old = s.players;
  const creation = s.setupOrder ?? old.map((p) => p.id);
  if (cmd.order)
    requireRule(
      cmd.order.length === v.settings.names.length &&
        cmd.order.every((id) => old.some((p) => p.id === id)),
    );
  const fresh = createTournament(v.settings, { ...c, id: s.tournamentId });
  s.settings = fresh.settings;
  s.initialTotal = fresh.initialTotal;
  s.players = fresh.players.map((p, i) => ({
    ...p,
    id: cmd.order?.[i] ?? old[i]?.id ?? `${c.id}:p${i}`,
  }));
  requireRule(new Set(s.players.map((p) => p.id)).size === s.players.length);
  const ids = s.players.map((p) => p.id);
  s.setupOrder = [
    ...creation.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !creation.includes(id)),
  ];
};

export const setupHandlers = {
  START_TOURNAMENT: startTournament,
  SETUP_UPDATE: setupUpdate,
};
