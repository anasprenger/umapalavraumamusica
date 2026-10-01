import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Header, RoundSelector, Screen } from '@/components';
import { haptic } from '@/services/haptics';
import { friendlyMessage, onlineApi } from '@/services/onlineApi';
import { storage } from '@/services/storage';
import { colors, spacing } from '@/theme';

/** Tela 2 — Criar partida online: escolha do número de rodadas. */
export function CreateRoomScreen() {
  const [rounds, setRounds] = useState<number | null>(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!rounds) return;
    setLoading(true);
    setError(null);
    try {
      const name = (await storage.loadProfileName()) ?? '';
      const room = await onlineApi.createRoom(name, rounds);
      haptic('success');
      router.replace({ pathname: '/online/room/[code]', params: { code: room.code } });
    } catch (caught) {
      setError(friendlyMessage(caught));
      haptic('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen
      scroll
      keyboard
      header={<Header title="Criar sala" subtitle="Você será o host da partida" onBack={() => router.back()} large />}
      footer={
        <>
          {error ? (
            <AppText variant="footnote" color={colors.danger} align="center">
              {error}
            </AppText>
          ) : null}
          <Button title="Criar sala" icon="sparkles-outline" loading={loading} disabled={!rounds} onPress={create} />
        </>
      }>
      <View style={styles.content}>
        <Card>
          <RoundSelector value={rounds} onChange={setRounds} />
        </Card>
        <AppText variant="footnote" color={colors.inkTertiary} style={styles.note}>
          Uma rodada só conta quando alguém envia um palpite que é verificado. Palavras puladas sem tentativa não
          contam. O host pode adicionar mais rodadas durante o jogo.
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
  },
  note: {
    paddingHorizontal: spacing.xxs,
  },
});
