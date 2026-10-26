import { useCallback, useEffect, useRef } from 'react';

/**
 * BroadcastChannel signals between tabs of the local game. Messages only prompt a re-read;
 * write permission is still checked against the IndexedDB control generation.
 */
export function useCrossTabOwnership({
  ownsGame,
  onPeerChange,
}: {
  /** Whether this tab currently holds control of a game on screen (answers probes). */
  ownsGame: () => boolean;
  /** Another tab saved or took control; called for every non-probe message. */
  onPeerChange: () => void;
}) {
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef({ ownsGame, onPeerChange });
  useEffect(() => {
    latest.current = { ownsGame, onPeerChange };
  });
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const current = new BroadcastChannel('poker-local');
    channel.current = current;
    current.onmessage = (message) => {
      if (message.data?.type === 'probe') {
        if (latest.current.ownsGame())
          current.postMessage({ type: 'owner', requestId: message.data.requestId });
        return;
      }
      if (message.data?.type === 'owner') return;
      latest.current.onPeerChange();
    };
    return () => {
      channel.current = null;
      current.close();
    };
  }, []);

  const announce = useCallback((kind: 'changed' | 'control') => {
    channel.current?.postMessage(kind);
  }, []);

  /** Asks other tabs whether one of them owns the game; no answer within 180ms means none. */
  function otherWindowOwnsGame() {
    const current = channel.current;
    if (!current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const requestId = crypto.randomUUID();
      const finish = (owner: boolean) => {
        clearTimeout(timer);
        current.removeEventListener('message', listener);
        resolve(owner);
      };
      const listener = (e: MessageEvent) => {
        if (e.data?.type === 'owner' && e.data.requestId === requestId) finish(true);
      };
      const timer = setTimeout(() => finish(false), 180);
      current.addEventListener('message', listener);
      current.postMessage({ type: 'probe', requestId });
    });
  }

  return { announce, otherWindowOwnsGame };
}
