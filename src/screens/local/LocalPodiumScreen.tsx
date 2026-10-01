import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter } from '@/animations';
import { AppText, Button, Podium, Screen } from '@/components';
import { useLocalGame } from '@/hooks/useLocalGame';
import { haptic } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import { formatRounds } from '@/utils/format';

/** Tela 10 — Pódio do modo local. Ao sair daqui, a partida e os nomes são zerados. */
export function LocalPodiumScreen() {
  const { state, hydrated, reset } = useLocalGame();
  const leaving = useRef(false);

  useEffect(() => {
    if (hydrated && state.phase === 'finished') haptic('success');
  }, [hydrated, state.phase]);

  useEffect(() => {
    if (!hydrated || leaving.current || state.phase === 'finished') return;
    router.replace(state.phase === 'setup' ? '/local' : '/local/game');
  }, [hydrated, state.phase]);

  const leaveTo = (target: 'setup' | 'home') => {
    leaving.current = true;
    reset();
    if (target === 'setup') router.replace('/local');
    else router.dismissTo('/');
  };

  if (!hydrated || state.phase !== 'finished') return <Screen tone="purple">{null}</Screen>;

  return (
    <Screen
      tone="purple"
      scroll
      footer={
        <>
          <Button title="Nova partida" variant="light" icon="refresh" onPress={() => leaveTo('setup')} />
          <Button title="Voltar ao início" variant="lightGhost" icon="home-outline" onPress={() => leaveTo('home')} />
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
