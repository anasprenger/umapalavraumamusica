import { useState } from 'react';

import { Banner, Button } from '@/components';
import type { AiAccess } from '@/services/onlineApi';

type Props = {
  access: AiAccess | null;
  onRequest: () => Promise<AiAccess | null>;
};

/** Aviso para autorizar o Claude a verificar as músicas (modo online dentro do Claude). */
export function AiAccessBanner({ access, onRequest }: Props) {
  const [asking, setAsking] = useState(false);
  if (!access || access === 'granted') return null;

  if (access === 'prompt') {
    return (
      <Banner
        tone="purple"
        icon="sparkles"
        title="Autorize o Claude a verificar as músicas"
        message="Cada palpite seu é conferido pelo Claude e usa um pouquinho do seu plano. Toque em Autorizar e confirme no aviso do Claude."
        action={
          <Button
            title="Autorizar"
            variant="light"
            size="small"
            loading={asking}
            onPress={async () => {
              setAsking(true);
              try {
                await onRequest();
              } finally {
                setAsking(false);
              }
            }}
          />
        }
      />
    );
  }

  if (access === 'denied') {
    return (
      <Banner
        tone="warning"
        icon="lock-closed-outline"
        title="O uso do Claude foi recusado"
        message="Para palpitar, libere o uso do Claude nas permissões deste artefato e depois feche e abra o jogo de novo."
      />
    );
  }

  return (
    <Banner
      tone="warning"
      icon="alert-circle-outline"
      title="A verificação pelo Claude não funciona nesta tela"
      message="Abra o jogo pelo link em claude.ai, no navegador do computador ou do celular, com a sua conta conectada."
    />
  );
}
