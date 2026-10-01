import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastMessage = { id: number; text: string; tone: 'info' | 'warning' };

/** Aviso temporário (some sozinho após alguns segundos). */
export function useToast(durationMs = 3200) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const counter = useRef(0);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), durationMs);
    return () => clearTimeout(timer);
  }, [toast, durationMs]);

  const show = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    counter.current += 1;
    setToast({ id: counter.current, text, tone });
  }, []);

  return { toast, show, hide: () => setToast(null) };
}
