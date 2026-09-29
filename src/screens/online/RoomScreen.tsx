import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Pulse } from '@/animations';
import { AppText, Button, Header, LogoMark, Screen, TextField, Toast } from '@/components';
import { PLAYER_NAME_MAX } from '@/game/local/reducer';
import { useOnlineRoom } from '@/hooks/useOnlineRoom';
import { useToast } from '@/hooks/useToast';
import { confirmAction } from '@/services/dialogs';
import { friendlyMessage } from '@/services/onlineApi';
import { isOnlineConfigured } from '@/services/supabase';
import { colors, spacing } from '@/theme';
import { tidyName } from '@/utils/normalize';

import { GameView } from './room/GameView';
import { LobbyView } from './room/LobbyView';
import { OnlinePodiumView } from './room/OnlinePodiumView';

/** Sala online: lobby, partida ou pódio, conforme o estado oficial do servidor. */
export function RoomScreen() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = String(params.code ?? '').toUpperCase();
  const room = useOnlineRoom(code);
  const { toast, show } = useToast();
  const [name, setName] = useState('');

  const goHome = useCallback(() => (router.canGoBack() ? router.dismissTo('/') : router.replace('/')), []);

  const perform = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (caught) {
        show(friendlyMessage(caught), 'warning');
      }
    },
    [show],
  );

  const leave = async () => {
    const inGame = room.snapshot && !['waiting', 'finished'].includes(room.snapshot.room.status);
    const ok = await confirmAction({
      title: 'Sair da sala?',
      message: inGame
        ? 'Você sai da partida. Se for o host, o cargo passa para o próximo jogador.'
        : 'Você pode voltar depois com o mesmo código.',
      confirmLabel: 'Sair',
      destructive: true,
    });
    if (!ok) return;
    await room.actions.leave();
    goHome();
  };

  if (!isOnlineConfigured) {
    return (
      <Message
        title="Modo online indisponível"
        message="Esta versão do app ainda não está conectada ao servidor do jogo."
        onBack={goHome}
      />
    );
  }

  if (room.phase === 'needs_name') {
    return (
      <Screen
        keyboard
        header={<Header title={`Sala ${code}`} onBack={goHome} backIcon="close" />}
        footer={
          <Button
            title="Entrar na sala"
            icon="enter-outline"
            disabled={!tidyName(name)}
            onPress={() => room.saveName(tidyName(name))}
          />
        }>
        <View style={styles.nameBox}>
          <AppText variant="title2">Como você quer ser chamado?</AppText>
          <TextField
            autoFocus
            placeholder="Seu nome"
            value={name}
            maxLength={PLAYER_NAME_MAX}
            autoCapitalize="words"
            onChangeText={setName}
            onSubmitEditing={() => tidyName(name) && room.saveName(tidyName(name))}
          />
        </View>
      </Screen>
    );
  }

  if (room.phase === 'kicked') {
    return <Message title="Você saiu da sala" message="O host removeu você desta partida." onBack={goHome} />;
  }

  if (room.phase === 'error') {
    return <Message title="Não foi possível entrar" message={room.error ?? ''} onBack={goHome} onRetry={room.retry} />;
  }

  if (room.phase === 'connecting' || !room.snapshot) {
    return (
      <Screen tone="purple">
        <View style={styles.center}>
          <Pulse>
            <LogoMark size={96} />
          </Pulse>
          <AppText variant="headline" color={colors.white} align="center">
            {`Entrando na sala ${code}…`}
          </AppText>
          <ActivityIndicator color={colors.white} />
        </View>
      </Screen>
    );
  }

  const snapshot = room.snapshot;
  const toastNode = <Toast toast={toast} />;

  if (snapshot.room.status === 'waiting') {
    return (
      <>
        <LobbyView room={room} snapshot={snapshot} perform={perform} onLeave={leave} notify={show} />
        {toastNode}
      </>
    );
  }

  if (snapshot.room.status === 'finished') {
    return (
      <OnlinePodiumView
        room={room}
        snapshot={snapshot}
        perform={perform}
        onLeave={async () => {
          await room.actions.leave();
          goHome();
        }}
      />
    );
  }

  return <GameView room={room} snapshot={snapshot} perform={perform} notify={show} onLeave={leave} toast={toastNode} />;
}

function Message({
  title,
  message,
  onBack,
  onRetry,
}: {
  title: string;
  message: string;
  onBack: () => void;
  onRetry?: () => void;
}) {
  return (
    <Screen
      tone="purple"
      footer={
        <>
          {onRetry ? <Button title="Tentar novamente" variant="light" icon="refresh" onPress={onRetry} /> : null}
          <Button title="Voltar ao início" variant={onRetry ? 'lightGhost' : 'light'} icon="home-outline" onPress={onBack} />
        </>
      }>
      <View style={styles.center}>
        <LogoMark size={88} />
        <AppText variant="title1" color={colors.white} align="center">
          {title}
        </AppText>
        <AppText variant="callout" color={colors.onPrimarySecondary} align="center">
          {message}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  nameBox: {
    gap: spacing.lg,
    paddingTop: spacing.xl,
  },
});
