import { useState } from 'react';

import { Button, Sheet, TextField } from '@/components';
import { PLAYER_NAME_MAX } from '@/game/local/reducer';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Retorna mensagem de erro ou `null` em caso de sucesso. */
  onAdd: (name: string) => string | null;
};

/** Adicionar jogador durante a partida local. */
export function AddPlayerSheet({ visible, onClose, onAdd }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setName('');
    setError(null);
    onClose();
  };

  const submit = () => {
    const result = onAdd(name);
    if (result) {
      setError(result);
      return;
    }
    close();
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="Adicionar jogador"
      subtitle="Novos jogadores entram com 0 pontos."
      footer={<Button title="Adicionar" icon="person-add" onPress={submit} disabled={!name.trim()} />}>
      <TextField
        autoFocus
        placeholder="Nome do jogador"
        value={name}
        maxLength={PLAYER_NAME_MAX}
        autoCapitalize="words"
        autoCorrect={false}
        onChangeText={(text) => {
          setName(text);
          if (error) setError(null);
        }}
        onSubmitEditing={submit}
        error={error}
      />
    </Sheet>
  );
}
