import { useEffect, useRef, useState } from 'react';

// 잠시 보였다 사라지는 토스트 메시지 상태를 관리하는 훅
export function useToast(duration = 2400) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function show(text: string) {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), duration);
  }
  function clear() {
    setMessage('');
  }
  return { message, show, clear };
}
