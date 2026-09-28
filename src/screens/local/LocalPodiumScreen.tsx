import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter } from '@/animations';
import { AppText, Button, Podium, Screen } from '@/components';
import { useLocalGame } from '@/hooks/useLocalGame';
import { haptic } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import { formatRounds } from '@/utils/format';

/** Tela 10 — Pódio do modo local. */
export function LocalPodiumScreen() {
  const { state, hydrated, playAgain } = useLocalGame();

  useEffect(() => {
    if (hydrated && state.phase === 'finished') haptic('success');
  }, [hydrated, state.phase]);

  useEffect(() => {
    if (hydrated && state.phase !== 'finished') router.replace(state.phase === 'setup' ? '/local' : '/local/game');
  }, [hydrated, state.phase]);

  if (!hydrated || state.phase !== 'finished') return <Screen tone="purple">{null}</Screen>;

  return (
    <Screen
      tone="purple"
      scroll
      footer={
        <>
          <Button
            title="Jogar novamente"
            variant="light"
            icon="refresh"
            onPress={() => {
              playAgain();
              router.replace('/local/game');
            }}
          />
          <Button title="Voltar ao início" variant="lightGhost" icon="home-outline" onPress={() => router.dismissTo('/')} />
        </>
      }>
      <Animated.View entering={enter.down} style={styles.header}>
        <AppText variant="overline" color={colors.onPrimarySecondary} align="center">
          {state.endReason === 'words_exhausted' ? 'AS PALAVRAS ACABARAM' : formatRounds(state.roundsPlayed).toUpperCase()}
        </AppText>
        <AppText variant="largeTitle" color={colors.white} align="center">
          FIM DE JOGO
        </AppText>
      </Animated.View>
      <View style={styles.podium}>
        <Podium players={state.players} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  podium: {
    paddingBottom: spacing.lg,
  },
});
