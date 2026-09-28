import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter, exit } from '@/animations';
import { AppText, Button, Card, Header, IconButton, Pill, Scoreboard, Screen, WordDisplay } from '@/components';
import { displayRoundNumber } from '@/game/local/reducer';
import { useLocalGame } from '@/hooks/useLocalGame';
import { confirmAction } from '@/services/dialogs';
import { haptic } from '@/services/haptics';
import { colors, spacing } from '@/theme';

import { AddPlayerSheet } from './AddPlayerSheet';
import { LocalCelebration } from './LocalCelebration';
import { WinnerSheet } from './WinnerSheet';

/** Partida local: a palavra na tela, e os jogadores decidem presencialmente quem acertou. */
export function LocalGameScreen() {
  const game = useLocalGame();
  const { state, hydrated } = game;
  const [winnerOpen, setWinnerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (state.phase === 'finished') router.replace('/local/podium');
    else if (state.phase === 'setup') router.replace('/local');
  }, [hydrated, state.phase]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const finish = async () => {
    const ok = await confirmAction({
      title: 'Finalizar jogo?',
      message: 'A partida termina agora e o pódio será exibido.',
      confirmLabel: 'Finalizar',
    });
    if (ok) {
      haptic('success');
      game.finish();
    }
  };

  if (!hydrated || !state.currentWord) {
    return <Screen>{null}</Screen>;
  }

  if (state.phase === 'celebrating') {
    return <LocalCelebration onNext={game.nextWord} onFinish={finish} />;
  }

  const counted = state.currentAttempts > 0;

  return (
    <Screen
      scroll
      header={
        <Header
          title={`Rodada ${displayRoundNumber(state)}`}
          subtitle="Jogo local"
          onBack={leave}
          backIcon="close"
          right={
            <IconButton icon="person-add-outline" accessibilityLabel="Adicionar jogador" onPress={() => setAddOpen(true)} />
          }
        />
      }
      footer={
        <>
          <Button title="Alguém acertou!" icon="musical-notes" onPress={() => setWinnerOpen(true)} />
          <View style={styles.row}>
            <Button
              title="Tentativa errada"
              variant="secondary"
              size="medium"
              icon="close-circle-outline"
              style={styles.flex}
              onPress={() => {
                haptic('warning');
                game.registerAttempt();
              }}
            />
            <Button
              title="Pular palavra"
              variant="secondary"
              size="medium"
              icon="play-skip-forward-outline"
              style={styles.flex}
              onPress={() => {
                haptic('light');
                game.skipWord();
              }}
            />
          </View>
          <Button title="Finalizar jogo" variant="ghost" size="small" icon="flag-outline" onPress={finish} />
        </>
      }>
      <View style={styles.content}>
        <Animated.View entering={enter.up}>
          <WordDisplay word={state.currentWord} />
        </Animated.View>

        <View style={styles.status}>
          {counted ? (
            <Animated.View key="counted" entering={enter.pop} exiting={exit.fade}>
              <Pill
                icon="checkmark-circle"
                label={`${state.currentAttempts} ${state.currentAttempts === 1 ? 'tentativa' : 'tentativas'} · já conta como rodada`}
              />
            </Animated.View>
          ) : (
            <Animated.View key="waiting" entering={enter.fade} exiting={exit.fade}>
              <AppText variant="footnote" color={colors.inkTertiary} align="center">
                Cantem! Se ninguém tentar, pular não conta como rodada.
              </AppText>
            </Animated.View>
          )}
        </View>

        <Card style={styles.scores}>
          <AppText variant="overline" color={colors.inkTertiary}>
            PLACAR
          </AppText>
          <Scoreboard players={state.players} />
        </Card>
      </View>

      <WinnerSheet
        visible={winnerOpen}
        players={state.players}
        onClose={() => setWinnerOpen(false)}
        onConfirm={(playerId) => {
          setWinnerOpen(false);
          haptic('success');
          game.markWinner(playerId);
        }}
      />
      <AddPlayerSheet visible={addOpen} onClose={() => setAddOpen(false)} onAdd={game.addPlayer} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingTop: spacing.xs,
  },
  status: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scores: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
