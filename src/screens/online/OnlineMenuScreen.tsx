import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter } from '@/animations';
import { AppText, Banner, Button, Header, Screen, TextField } from '@/components';
import { PLAYER_NAME_MAX } from '@/game/local/reducer';
import { storage } from '@/services/storage';
import { isOnlineConfigured } from '@/services/supabase';
import { colors, spacing } from '@/theme';
import { tidyName } from '@/utils/normalize';

/** Jogar Online: nome do jogador e escolha entre criar ou entrar em uma sala. */
export function OnlineMenuScreen() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

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
          <Button title="Criar sala" icon="add-circle-outline" disabled={!isOnlineConfigured} onPress={() => go('/online/create')} />
          <Button
            title="Entrar com código"
            variant="secondary"
            icon="enter-outline"
            disabled={!isOnlineConfigured}
            onPress={() => go('/online/join')}
          />
        </>
      }>
      <View style={styles.content}>
        {!isOnlineConfigured ? (
          <Banner
            tone="warning"
            icon="cloud-offline-outline"
            title="Modo online ainda não disponível"
            message="Esta versão do app ainda não está conectada ao servidor do jogo. O modo local funciona normalmente."
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
            'O primeiro palpite enviado é verificado automaticamente.',
            'Cada música confirmada vale 1 ponto.',
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
