import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, IconButton, RoundSelector, Scoreboard, SectionTitle, Sheet } from '@/components';
import type { OnlineRoomApi } from '@/hooks/useOnlineRoom';
import { confirmAction } from '@/services/dialogs';
import { spacing } from '@/theme';
import type { RoomSnapshot } from '@/types/online';
import { playerStatus } from '@/utils/players';

type Props = {
  visible: boolean;
  onClose: () => void;
  room: OnlineRoomApi;
  snapshot: RoomSnapshot;
  perform: (action: () => Promise<unknown>) => Promise<void>;
  onLeave: () => void;
};

/** Placar completo e funções do host (expulsar, adicionar rodadas, encerrar). */
export function RoomMenuSheet({ visible, onClose, room, snapshot, perform, onLeave }: Props) {
  const [extending, setExtending] = useState(false);
  const [extra, setExtra] = useState<number | null>(5);
  const { me, players, room: info } = snapshot;

  const kick = async (playerId: string, name: string) => {
    const ok = await confirmAction({
      title: `Remover ${name}?`,
      message: 'O jogador sai da sala e não poderá voltar. Os pontos dele deixam de aparecer.',
      confirmLabel: 'Remover',
      destructive: true,
    });
    if (ok) await perform(() => room.actions.kick(playerId));
  };

  const endGame = async () => {
    const ok = await confirmAction({
      title: 'Encerrar a partida?',
      message: 'O jogo termina agora para todos e o pódio é exibido.',
      confirmLabel: 'Encerrar',
      destructive: true,
    });
    if (ok) {
      onClose();
      await perform(() => room.actions.endGame());
    }
  };

  if (extending) {
    return (
      <Sheet
        visible={visible}
        onClose={() => setExtending(false)}
        title="Adicionar rodadas"
        subtitle={`Hoje: ${info.rounds_played} de ${info.configured_rounds} rodadas jogadas.`}
        footer={
          <Button
            title={extra ? `Adicionar ${extra}` : 'Escolha a quantidade'}
            disabled={!extra}
            onPress={async () => {
              if (!extra) return;
              setExtending(false);
              onClose();
              await perform(() => room.actions.extendRounds(extra));
            }}
          />
        }>
        <RoundSelector value={extra} onChange={setExtra} label="Rodadas extras" />
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Placar"
      subtitle={`Sala ${info.code} · ${info.rounds_played} de ${info.configured_rounds} rodadas`}
      footer={
        <>
          {me.is_host ? (
            <View style={styles.row}>
              <Button
                title="Rodadas"
                variant="secondary"
                size="medium"
                icon="add"
                style={styles.flex}
                onPress={() => setExtending(true)}
              />
              <Button title="Encerrar" variant="danger" size="medium" icon="stop-circle-outline" style={styles.flex} onPress={endGame} />
            </View>
          ) : null}
          <Button title="Sair da sala" variant="ghost" size="small" icon="exit-outline" onPress={onLeave} />
        </>
      }>
      <Scoreboard
        players={players.map((player) => ({
          id: player.id,
          name: player.name,
          score: player.score,
          joinOrder: player.join_order,
          isHost: player.is_host,
          inactive: !player.is_active,
          statusText: playerStatus(player),
        }))}
        meId={me.player_id}
      />
      {me.is_host && players.some((player) => player.id !== me.player_id && player.is_active) ? (
        <View style={styles.kick}>
          <SectionTitle icon="person-remove" title="REMOVER JOGADOR" />
          <View style={styles.kickList}>
            {players
              .filter((player) => player.id !== me.player_id && player.is_active)
              .map((player) => (
                <View key={player.id} style={styles.kickItem}>
                  <AppText variant="subhead" numberOfLines={1} style={styles.flex}>
                    {player.name}
                  </AppText>
                  <IconButton
                    icon="person-remove-outline"
                    size={34}
                    accessibilityLabel={`Remover ${player.name}`}
                    onPress={() => kick(player.id, player.name)}
                  />
                </View>
              ))}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  kick: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  kickList: {
    gap: spacing.xxs,
  },
  kickItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 2,
  },
});
