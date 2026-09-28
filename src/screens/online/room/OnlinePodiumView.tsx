import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter, Pulse } from '@/animations';
import { AppText, Button, LogoMark, Podium, Screen } from '@/components';
import type { OnlineRoomApi } from '@/hooks/useOnlineRoom';
import { haptic } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import type { EndReason, RoomSnapshot } from '@/types/online';
import { formatRounds } from '@/utils/format';

type Props = {
  room: OnlineRoomApi;
  snapshot: RoomSnapshot;
  perform: (action: () => Promise<unknown>) => Promise<void>;
  onLeave: () => void;
};

const REASONS: Record<EndReason, string> = {
  rounds_completed: 'Todas as rodadas foram jogadas',
  majority_finish: 'A maioria decidiu finalizar',
  host_ended: 'O host encerrou a partida',
  words_exhausted: 'As palavras do banco acabaram',
  abandoned: 'Todos saíram da sala',
};

/** Tela 10 — Pódio do modo online. */
export function OnlinePodiumView({ room, snapshot, perform, onLeave }: Props) {
  const { room: info, me, players } = snapshot;
  const neverStarted = !info.started_at;

  useEffect(() => {
    if (!neverStarted) haptic('success');
  }, [neverStarted]);

  if (neverStarted) {
    return (
      <Screen tone="purple" footer={<Button title="Voltar ao início" variant="light" icon="home-outline" onPress={onLeave} />}>
        <View style={styles.closed}>
          <LogoMark size={88} />
          <AppText variant="title1" color={colors.white} align="center">
            Sala encerrada
          </AppText>
          <AppText variant="callout" color={colors.onPrimarySecondary} align="center">
            {info.end_reason ? REASONS[info.end_reason] : 'A partida não chegou a começar.'}
          </AppText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      tone="purple"
      scroll
      footer={
        <>
          {me.is_host ? (
            <Button title="Jogar novamente" variant="light" icon="refresh" onPress={() => perform(() => room.actions.restart())} />
          ) : (
            <Pulse to={1.03} duration={900}>
              <AppText variant="subhead" color={colors.onPrimarySecondary} align="center">
                O host pode começar uma nova partida nesta sala.
              </AppText>
            </Pulse>
          )}
          <Button title="Voltar ao início" variant="lightGhost" icon="home-outline" onPress={onLeave} />
        </>
      }>
      <Animated.View entering={enter.down} style={styles.header}>
        <AppText variant="overline" color={colors.onPrimarySecondary} align="center">
          {formatRounds(info.rounds_played).toUpperCase()}
        </AppText>
        <AppText variant="largeTitle" color={colors.white} align="center">
          FIM DE JOGO
        </AppText>
        {info.end_reason ? (
          <AppText variant="subhead" color={colors.onPrimarySecondary} align="center">
            {REASONS[info.end_reason]}
          </AppText>
        ) : null}
      </Animated.View>
      <Podium
        players={players.map((player) => ({
          id: player.id,
          name: player.name,
          score: player.score,
          joinOrder: player.join_order,
        }))}
        highlightId={me.player_id}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  closed: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
});
