import { useCallback, useEffect, useState } from 'react';

import { type AiAccess, onlineApi } from '@/services/onlineApi';

/** Se o Claude está autorizado a verificar as músicas deste jogador (`null` enquanto verifica). */
export function useAiAccess() {
  const [access, setAccess] = useState<AiAccess | null>(null);

  const check = useCallback(async () => {
    const value = await onlineApi.aiAccess().catch(() => null);
    if (value) setAccess(value);
    return value;
  }, []);

  useEffect(() => {
    let alive = true;
    void onlineApi.aiAccess().then(
      (value) => {
        if (alive) setAccess(value);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  const request = useCallback(async () => {
    const value = await onlineApi.requestAiAccess().catch(() => null);
    if (value) setAccess(value);
    return value;
  }, []);

  return { access, check, request };
}
