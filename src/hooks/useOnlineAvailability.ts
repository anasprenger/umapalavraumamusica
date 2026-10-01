import { useEffect, useState } from 'react';

import { onlineAvailability, type OnlineAvailability } from '@/services/onlineApi';

/** Se o modo online pode ser usado aqui (`null` enquanto verifica). */
export function useOnlineAvailability(): OnlineAvailability | null {
  const [availability, setAvailability] = useState<OnlineAvailability | null>(null);
  useEffect(() => {
    let alive = true;
    void onlineAvailability().then((value) => {
      if (alive) setAvailability(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return availability;
}
