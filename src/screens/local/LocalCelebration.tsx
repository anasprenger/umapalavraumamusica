import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter } from '@/animations';
import { AppText, Avatar, Button, Scoreboard, Screen } from '@/components';
import { useLocalGame } from '@/hooks/useLocalGame';
import { colors, spacing } from '@/theme';

type Props = {
  onNext: () => void;
  onFinish: () => void;
};

/** Comemoração do acerto no modo local, seguida de "Próxima palavra". */
export function LocalCelebration({ onNext, onFinish }: Props) {
  const { state } = useLocalGame();
  const winner = state.players.find((player) => player.id === state.lastWinnerId);

  return (
    <Screen
      tone="purple"
      scroll
      footer={
        <>
          <Button title="Próxima palavra" variant="light" icon="arrow-forward" iconPosition="right" onPress={onNext} />
          <Button title="Finalizar jogo" variant="lightLink" size="small" icon="flag-outline" onPress={onFinish} />
        </>
      }>
      <View style={styles.hero}>
        <Animated.View entering={enter.fade}>
          <AppText variant="overline" color={colors.onPrimarySecondary} align="center">
            {`RODADA ${state.currentRoundNumber ?? state.roundsPlayed} · ${state.currentWord?.toUpperCase() ?? ''}`}
          </AppText>
        </Animated.View>
        <Animated.View entering={enter.pop}>
          <Avatar name={winner?.name ?? '?'} size={88} tone="white" />
        </Animated.View>
        <Animated.View entering={enter.up} style={styles.titles}>
          <AppText variant="largeTitle" color={colors.white} align="center">
            {winner ? `Ponto para ${winner.name}!` : 'Acertou!'}
          </AppText>
          <AppText variant="title2" color={colors.gold} align="center">
            +1
          </AppText>
        </Animated.View>
      </View>
      <Animated.View entering={enter.stagger(3)} style={styles.scores}>
        <Scoreboard players={state.players} tone="purple" />
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
  },
  titles: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  scores: {
    backgroundColor: colors.onPrimarySurface,
    borderRadius: 28,
    padding: spacing.lg,
  },
});
