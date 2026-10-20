import { useEffect, useRef, useState } from 'react';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
const seenKey = 'poker-install-offer-dismissed';
function standalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    !!(navigator as Navigator & { standalone?: boolean }).standalone
  );
}
function dismissed() {
  try {
    return localStorage.getItem(seenKey) === '1';
  } catch {
    return false;
  }
}
export function useInstallPrompt(enabled: boolean) {
  const [installed, setInstalled] = useState(standalone);
  const [seen, setSeen] = useState(dismissed);
  const [opened, setOpened] = useState(false);
  const [candidate, setCandidate] = useState<InstallEvent | null>(null);
  const [mode, setMode] = useState<'ios' | 'browser' | null>(() =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      ? 'ios'
      : null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const prompting = useRef(false);
  function remember() {
    setSeen(true);
    try {
      localStorage.setItem(seenKey, '1');
    } catch {
      // Storage restrictions must not block installation or playing.
    }
  }
  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const before = (event: Event) => {
      event.preventDefault();
      if (standalone()) return;
      setCandidate(event as InstallEvent);
      setMode('browser');
    };
    const completed = () => {
      setInstalled(true);
      setCandidate(null);
      setOpened(false);
    };
    const changed = () => {
      if (standalone()) completed();
    };
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', completed);
    media.addEventListener('change', changed);
    return () => {
      window.removeEventListener('beforeinstallprompt', before);
      window.removeEventListener('appinstalled', completed);
      media.removeEventListener('change', changed);
    };
  }, []);
  function close() {
    if (prompting.current) return;
    remember();
    setOpened(false);
    setError('');
  }
  async function install() {
    if (!candidate || prompting.current) return;
    const event = candidate;
    prompting.current = true;
    setPending(true);
    setOpened(true);
    remember();
    setCandidate(null);
    setError('');
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setOpened(false);
    } catch {
      setError('설치 창을 열지 못했습니다. 아래 방법으로 설치할 수 있어요.');
    } finally {
      prompting.current = false;
      setPending(false);
    }
  }
  return {
    available: !installed && mode !== null,
    visible: enabled && !installed && mode !== null && (opened || !seen),
    mode,
    canPrompt: candidate !== null,
    pending,
    error,
    open: () => setOpened(true),
    close,
    install,
  };
}
