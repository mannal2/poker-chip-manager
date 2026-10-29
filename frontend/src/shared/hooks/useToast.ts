import { useEffect, useRef, useState } from 'react';

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
