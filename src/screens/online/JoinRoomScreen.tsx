import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText, Button, Header, Screen } from '@/components';
import { haptic } from '@/services/haptics';
import { friendlyMessage, onlineApi } from '@/services/onlineApi';
import { storage } from '@/services/storage';
import { colors, fontFor, radii, spacing } from '@/theme';

const CODE_LENGTH = 6;

/** Entrar em uma sala existente pelo código (antes ou durante a partida). */
export function JoinRoomScreen() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setLoading(true);
    setError(null);
    try {
      const name = (await storage.loadProfileName()) ?? '';
      const room = await onlineApi.joinRoom(code, name);
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
      keyboard
      header={<Header title="Entrar na sala" subtitle="Peça o código para o host" onBack={() => router.back()} large />}
      footer={
        <Button
          title="Entrar"
          icon="arrow-forward"
          iconPosition="right"
          loading={loading}
          disabled={code.length !== CODE_LENGTH}
          onPress={join}
        />
      }>
      <View style={styles.content}>
        <TextInput
          value={code}
          onChangeText={(text) => {
            setCode(text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH));
            if (error) setError(null);
          }}
          placeholder="ABC123"
          placeholderTextColor={colors.lilacStrong}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          maxLength={CODE_LENGTH}
          returnKeyType="go"
          onSubmitEditing={() => code.length === CODE_LENGTH && join()}
          accessibilityLabel="Código da sala"
          style={[styles.code, error ? styles.codeError : null]}
        />
        {error ? (
          <AppText variant="subhead" color={colors.danger} align="center">
            {error}
          </AppText>
        ) : (
          <AppText variant="subhead" color={colors.inkTertiary} align="center">
            O código tem 6 letras e números.
          </AppText>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingTop: spacing.xl,
  },
  code: {
    height: 84,
    borderRadius: radii.xl,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.lilacStrong,
    textAlign: 'center',
    fontSize: 38,
    letterSpacing: 10,
    color: colors.primaryDark,
    ...fontFor('bold'),
    outlineStyle: 'none',
  } as object,
  codeError: {
    borderColor: colors.danger,
  },
});
