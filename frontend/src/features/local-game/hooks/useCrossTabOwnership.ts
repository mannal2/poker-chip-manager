import { useCallback, useEffect, useRef } from 'react';

// BroadcastChannel로 다른 탭의 변경 알림과 소유 여부 확인을 처리하는 훅
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

  // 다른 탭에 변경 또는 조작권 이동을 알린다
  const announce = useCallback((kind: 'changed' | 'control') => {
    channel.current?.postMessage(kind);
  }, []);

  // 다른 탭이 게임을 소유 중인지 잠시 기다려 확인한다
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
