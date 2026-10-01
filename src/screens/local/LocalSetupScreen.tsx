import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter, exit, layout } from '@/animations';
import { AppText, Avatar, Button, Card, Header, IconButton, PlayerRow, Screen, SectionTitle, TextField } from '@/components';
import { LOCAL_MIN_PLAYERS, PLAYER_NAME_MAX } from '@/game/local/reducer';
import { useLocalGame } from '@/hooks/useLocalGame';
import { haptic } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import { formatPlayers } from '@/utils/format';

const SAMPLE_NAMES = ['Ana', 'João', 'Maria', 'Pedro'];

/** Configuração do jogo local: adicionar os jogadores (mínimo 2). */
export function LocalSetupScreen() {
  const { state, hydrated, addPlayer, removePlayer, start } = useLocalGame();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Uma partida em andamento ou encerrada tem a própria tela.
  useEffect(() => {
    if (!hydrated) return;
    if (state.phase === 'playing') router.replace('/local/game');
    else if (state.phase === 'finished') router.replace('/local/podium');
  }, [hydrated, state.phase]);

  const players = state.players;
  const missing = Math.max(0, LOCAL_MIN_PLAYERS - players.length);

  const submit = () => {
    const result = addPlayer(name);
    if (result) {
      setError(result);
      haptic('warning');
      return;
    }
    haptic('selection');
    setName('');
    setError(null);
    inputRef.current?.focus();
  };

  const begin = () => {
    start();
    haptic('success');
    router.replace('/local/game');
  };

  return (
    <Screen
      scroll
      keyboard
      header={<Header title="Jogo Local" subtitle="Todos jogam no mesmo aparelho" onBack={() => router.back()} large />}
      footer={
        <>
          <Button title="Começar jogo" icon="play" disabled={missing > 0} onPress={begin} />
          <AppText variant="footnote" color={colors.inkTertiary} align="center">
            {missing > 0
              ? `Adicione mais ${formatPlayers(missing)} para começar.`
              : `${formatPlayers(players.length)} prontos. Vocês podem adicionar mais durante o jogo.`}
          </AppText>
        </>
      }>
      <View style={styles.content}>
        <TextField
          ref={inputRef}
          label="Adicionar jogador"
          placeholder="Nome do jogador"
          value={name}
          maxLength={PLAYER_NAME_MAX}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          submitBehavior="submit"
          onChangeText={(text) => {
            setName(text);
            if (error) setError(null);
          }}
          onSubmitEditing={submit}
          error={error}
          trailing={
            <IconButton icon="add" tone="primary" accessibilityLabel="Adicionar jogador" onPress={submit} size={40} />
          }
        />

        {players.length > 0 ? (
          <Card style={styles.list}>
            <SectionTitle icon="people" title="JOGADORES" />
            {players.map((player) => (
              <Animated.View key={player.id} entering={enter.up} exiting={exit.fade} layout={layout}>
                <PlayerRow
                  name={player.name}
                  trailing={
                    <IconButton
                      icon="close"
                      size={32}
                      accessibilityLabel={`Remover ${player.name}`}
                      onPress={() => removePlayer(player.id)}
                    />
                  }
                />
              </Animated.View>
            ))}
          </Card>
        ) : (
          <Animated.View entering={enter.fade} style={styles.empty}>
            <View style={styles.sample}>
              {SAMPLE_NAMES.map((sample, index) => (
                <View key={sample} style={index > 0 ? styles.sampleOverlap : null}>
                  <Avatar name={sample} size={52} ringColor={colors.white} />
                </View>
              ))}
            </View>
            <AppText variant="subhead" color={colors.inkSecondary} align="center">
              {`Ex.: ${SAMPLE_NAMES.join(', ')}…`}
            </AppText>
          </Animated.View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
  },
  list: {
    gap: spacing.xxs,
  },
  empty: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
  },
  sample: {
    flexDirection: 'row',
  },
  sampleOverlap: {
    marginLeft: -12,
  },
});
