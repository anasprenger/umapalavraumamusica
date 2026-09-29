import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter } from '@/animations';
import { AppText, Banner, Button, Header, Screen, TextField } from '@/components';
import { PLAYER_NAME_MAX } from '@/game/local/reducer';
import { useOnlineAvailability } from '@/hooks/useOnlineAvailability';
import { storage } from '@/services/storage';
import { colors, spacing } from '@/theme';
import { tidyName } from '@/utils/normalize';

/** Jogar Online: nome do jogador e escolha entre criar ou entrar em uma sala. */
export function OnlineMenuScreen() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const availability = useOnlineAvailability();
  const ready = availability?.status === 'available';
  const insideClaude = availability?.status === 'available' && availability.kind === 'claude';

  useEffect(() => {
    storage.loadProfileName().then((saved) => {
      if (saved) setName((current) => current || saved);
    });
  }, []);

  const go = async (path: '/online/create' | '/online/join') => {
    const clean = tidyName(name);
    if (!clean) {
      setError('Digite seu nome para jogar.');
      return;
    }
    await storage.saveProfileName(clean);
    router.push(path);
  };

  return (
    <Screen
      scroll
      keyboard
      header={<Header title="Jogar Online" subtitle="Cada jogador no seu aparelho" onBack={() => router.back()} large />}
      footer={
        <>
          <Button title="Criar sala" icon="add-circle-outline" disabled={!ready} onPress={() => go('/online/create')} />
          <Button
            title="Entrar com código"
            variant="secondary"
            icon="enter-outline"
            disabled={!ready}
            onPress={() => go('/online/join')}
          />
        </>
      }>
      <View style={styles.content}>
        {availability?.status === 'unavailable' ? (
          <Banner
            tone="warning"
            icon="cloud-offline-outline"
            title="Modo online indisponível aqui"
            message={`${availability.message} O modo local funciona normalmente.`}
          />
        ) : null}
        <Animated.View entering={enter.up}>
          <TextField
            label="Seu nome"
            placeholder="Como os outros vão te ver"
            value={name}
            maxLength={PLAYER_NAME_MAX}
            autoCapitalize="words"
            autoCorrect={false}
            onChangeText={(text) => {
              setName(text);
              if (error) setError(null);
            }}
            error={error}
          />
        </Animated.View>
        <Animated.View entering={enter.stagger(1)} style={styles.tips}>
          {[
            'De 2 a 10 jogadores por sala.',
            insideClaude
              ? 'O primeiro palpite enviado é verificado pelo Claude, na conta de quem palpitou.'
              : 'O primeiro palpite enviado é verificado automaticamente.',
            'Cada música confirmada vale 1 ponto.',
            ...(insideClaude
              ? ['Os amigos entram por este mesmo link do Claude (com acesso de edição) e usam o código da sala.']
              : []),
          ].map((text) => (
            <AppText key={text} variant="subhead" color={colors.inkSecondary}>
              {`•  ${text}`}
            </AppText>
          ))}
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
  },
  tips: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xxs,
  },
});
