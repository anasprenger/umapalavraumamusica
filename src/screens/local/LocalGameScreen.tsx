import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter, PressableScale } from '@/animations';
import {
  AppText,
  Button,
  Card,
  Header,
  Icon,
  IconButton,
  Pill,
  PlayerRow,
  Screen,
  SectionTitle,
  WordDisplay,
} from '@/components';
import { displayRoundNumber } from '@/game/local/reducer';
import { useLocalGame } from '@/hooks/useLocalGame';
import { confirmAction } from '@/services/dialogs';
import { haptic } from '@/services/haptics';
import { colors, radii, spacing } from '@/theme';

import { AddPlayerSheet } from './AddPlayerSheet';

/**
 * Partida local: a palavra na tela e os jogadores decidem presencialmente quem acertou.
 * Para dar o ponto, basta tocar no nome de quem acertou e em "Próxima palavra".
 */
export function LocalGameScreen() {
  const game = useLocalGame();
  const { state, hydrated } = game;
  const [addOpen, setAddOpen] = useState(false);
  // A escolha vale só para a palavra em que foi feita.
  const [pick, setPick] = useState<{ word: string; playerId: string } | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (state.phase === 'finished') router.replace('/local/podium');
    else if (state.phase === 'setup') router.replace('/local');
  }, [hydrated, state.phase]);

  const selectedId = pick && pick.word === state.currentWord ? pick.playerId : null;
  const selected = state.players.find((player) => player.id === selectedId) ?? null;
  const leaderScore = Math.max(0, ...state.players.map((player) => player.score));

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const finish = async () => {
    const ok = await confirmAction({
      title: 'Finalizar jogo?',
      message: selected
        ? `O ponto de ${selected.name} nesta palavra será contado e o pódio será exibido.`
        : 'A partida termina agora e o pódio será exibido.',
      confirmLabel: 'Finalizar',
    });
    if (ok) {
      haptic('success');
      game.finish(selected?.id);
    }
  };

  if (!hydrated || !state.currentWord) {
    return <Screen>{null}</Screen>;
  }

  const currentWord = state.currentWord;
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
          <Button
            title="Próxima palavra"
            icon="arrow-forward"
            iconPosition="right"
            disabled={!selected}
            accessibilityHint="Dá o ponto para o jogador escolhido e mostra outra palavra."
            onPress={() => {
              if (!selected) return;
              haptic('success');
              game.markWinner(selected.id);
            }}
          />
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
          <WordDisplay word={currentWord} animated={false} />
        </Animated.View>

        <View style={styles.status}>
          {selected ? (
            <Pill icon="star" label={`+1 ponto para ${selected.name}`} tone="gold" />
          ) : counted ? (
            <Pill
              icon="checkmark-circle"
              tone="success"
              label={`${state.currentAttempts} ${state.currentAttempts === 1 ? 'tentativa' : 'tentativas'} · já conta como rodada`}
            />
          ) : (
            <AppText variant="footnote" color={colors.inkTertiary} align="center">
              Cantem! Se ninguém tentar, pular não conta como rodada.
            </AppText>
          )}
        </View>

        <Card style={styles.players}>
          <SectionTitle icon="musical-notes" title="QUEM ACERTOU?" />
          <AppText variant="footnote" color={colors.inkSecondary}>
            Toque no nome de quem acertou e depois em Próxima palavra.
          </AppText>
          <View style={styles.list}>
            {state.players.map((player) => {
              const isSelected = player.id === selectedId;
              const leads = leaderScore > 0 && player.score === leaderScore;
              return (
                <PressableScale
                  key={player.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${player.name}, ${player.score} ${player.score === 1 ? 'ponto' : 'pontos'}`}
                  onPress={() => {
                    haptic('selection');
                    setPick(isSelected ? null : { word: currentWord, playerId: player.id });
                  }}
                  style={[styles.option, isSelected ? styles.optionSelected : null]}>
                  <PlayerRow
                    name={player.name}
                    score={player.score}
                    statusText={leads ? 'Na liderança' : undefined}
                    trailing={
                      <View style={[styles.radio, isSelected ? styles.radioSelected : null]}>
                        {isSelected ? <Icon name="checkmark" size={16} color={colors.white} /> : null}
                      </View>
                    }
                  />
                </PressableScale>
              );
            })}
          </View>
        </Card>
      </View>

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
  players: {
    gap: spacing.xs,
  },
  list: {
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  option: {
    paddingHorizontal: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.separator,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.lilacSoft,
  },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.lilacStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
