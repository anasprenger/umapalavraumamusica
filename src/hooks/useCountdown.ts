import { useEffect, useState } from 'react';

/**
 * Contagem regressiva até `endsAt` (milissegundos no relógio local).
 * Retorna os segundos restantes (arredondados para cima) e o progresso de 0 a 1.
 * `null` desativa a contagem.
 */
export function useCountdown(endsAt: number | null, totalMs?: number, now: () => number = Date.now) {
  const [current, setCurrent] = useState(() => now());

  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => setCurrent(now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 100);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [endsAt, now]);

  if (endsAt === null) return { secondsLeft: 0, msLeft: 0, progress: 0, done: false };
  // Limita ao total da fase para não "piscar" um valor antigo antes do primeiro tique.
  const msLeft = Math.min(totalMs ?? Number.POSITIVE_INFINITY, Math.max(0, endsAt - current));
  const progress = totalMs ? Math.min(1, Math.max(0, 1 - msLeft / totalMs)) : 0;
  return { secondsLeft: Math.ceil(msLeft / 1000), msLeft, progress, done: msLeft <= 0 };
}
