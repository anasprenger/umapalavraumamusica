import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter } from '@/animations';
import { AppText, Button, LogoMark, Screen } from '@/components';
import { useLocalGame } from '@/hooks/useLocalGame';
import { confirmAction } from '@/services/dialogs';
import { storage } from '@/services/storage';
import { colors, shadows, spacing } from '@/theme';

/** Tela 1 — Início: nome do jogo e as duas formas de jogar. */
export function HomeScreen() {
  const { state, hydrated, backToSetup } = useLocalGame();
  const [lastRoom, setLastRoom] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      storage.loadLastRoom().then((saved) => {
        // Oferece voltar apenas para salas recentes (últimas 12 horas).
        const fresh = saved && Date.now() - saved.savedAt < 12 * 60 * 60 * 1000;
        setLastRoom(fresh ? saved.code : null);
      });
    }, []),
  );

  const localInProgress = hydrated && (state.phase === 'playing' || state.phase === 'celebrating');

  const startLocal = async () => {
    if (localInProgress) {
      const ok = await confirmAction({
        title: 'Nova partida local?',
        message: 'A partida local em andamento será encerrada. Os jogadores serão mantidos.',
        confirmLabel: 'Nova partida',
      });
      if (!ok) return;
    }
    if (state.phase !== 'setup') backToSetup();
    router.push('/local');
  };

  return (
    <Screen tone="purple">
      <View style={styles.hero}>
        <Animated.View entering={enter.pop} style={[styles.logo, shadows.strong]}>
          <LogoMark size={116} />
        </Animated.View>
        <Animated.View entering={enter.up} style={styles.titles}>
          <AppText variant="largeTitle" color={colors.white} align="center" style={styles.title}>
            {'Uma Palavra,\nUma Música'}
          </AppText>
          <AppText variant="callout" color={colors.onPrimarySecondary} align="center">
            Receba uma palavra. Encontre uma música.
          </AppText>
        </Animated.View>
      </View>

      <Animated.View entering={enter.stagger(2)} style={styles.actions}>
        <Button title="Jogar Online" variant="light" icon="globe-outline" onPress={() => router.push('/online')} />
        <Button title="Jogar Local" variant="lightGhost" icon="people-outline" onPress={startLocal} />
        {localInProgress ? (
          <Button
            title="Continuar partida local"
            variant="lightLink"
            size="medium"
            icon="play-circle-outline"
            onPress={() => router.push('/local/game')}
          />
        ) : null}
        {lastRoom ? (
          <Button
            title={`Voltar para a sala ${lastRoom}`}
            variant="lightLink"
            size="medium"
            icon="enter-outline"
            onPress={() => router.push({ pathname: '/online/room/[code]', params: { code: lastRoom } })}
          />
        ) : null}
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
  },
  logo: {
    borderRadius: 27,
  },
  titles: {
    gap: spacing.sm,
    alignItems: 'center',
  },
  title: {
    fontSize: 40,
    lineHeight: 46,
  },
  actions: {
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
});
