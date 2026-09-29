import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter, exit, layout, Pulse } from '@/animations';
import {
  AppText,
  Button,
  Card,
  Header,
  IconButton,
  Icon,
  PlayerRow,
  RoundSelector,
  Screen,
  Sheet,
} from '@/components';
import { useAiAccess } from '@/hooks/useAiAccess';
import type { OnlineRoomApi } from '@/hooks/useOnlineRoom';
import { confirmAction } from '@/services/dialogs';
import { haptic } from '@/services/haptics';
import { colors, fontFor, radii, spacing } from '@/theme';
import type { RoomSnapshot } from '@/types/online';
import { playerStatus } from '@/utils/players';
import { formatRounds } from '@/utils/format';

import { AiAccessBanner } from './AiAccessBanner';

type Props = {
  room: OnlineRoomApi;
  snapshot: RoomSnapshot;
  perform: (action: () => Promise<unknown>) => Promise<void>;
  onLeave: () => void;
  notify: (text: string) => void;
};

const MAX_PLAYERS = 10;

/** Tela 3 — Lobby: código da sala, jogadores e início da partida. */
export function LobbyView({ room, snapshot, perform, onLeave, notify }: Props) {
  const { room: info, players, me } = snapshot;
  const [roundsOpen, setRoundsOpen] = useState(false);
  const [rounds, setRounds] = useState<number | null>(info.configured_rounds);
  const active = players.filter((player) => player.is_active);
  const alone = active.length < 2;
  const ai = useAiAccess();

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(info.code);
      haptic('success');
      notify('Código copiado!');
    } catch {
      // Alguns navegadores bloqueiam a área de transferência: mostra o código para ditar.
      notify(`Código da sala: ${info.code}`);
    }
  };

  const share = async () => {
    try {
      await Share.share({ message: `Vem jogar Uma Palavra, Uma Música comigo! Código da sala: ${info.code}` });
    } catch {
      await copy();
    }
  };

  const start = async () => {
    if (alone) {
      const ok = await confirmAction({
        title: 'Começar sozinho?',
        message:
          'Bom para testar o jogo: seus palpites são verificados normalmente e os amigos ainda podem entrar com o código durante a partida.',
        confirmLabel: 'Começar',
      });
      if (!ok) return;
    }
    await perform(() => room.actions.start());
  };

  const kick = async (playerId: string, name: string) => {
    const ok = await confirmAction({
      title: `Remover ${name}?`,
      message: 'O jogador sai da sala e não poderá voltar.',
      confirmLabel: 'Remover',
      destructive: true,
    });
    if (ok) await perform(() => room.actions.kick(playerId));
  };

  return (
    <Screen
      scroll
      header={<Header title="Sala" subtitle={formatRounds(info.configured_rounds)} onBack={onLeave} backIcon="close" />}
      footer={
        me.is_host ? (
          <>
            <Button title={alone ? 'Começar sozinho' : 'Iniciar jogo'} icon="play" onPress={start} />
            {alone ? (
              <AppText variant="footnote" color={colors.inkTertiary} align="center">
                Sozinho dá para testar. Quem entrar depois joga a partida já em andamento.
              </AppText>
            ) : null}
          </>
        ) : (
          <Pulse to={1.03} duration={900}>
            <AppText variant="subhead" color={colors.inkSecondary} align="center">
              Aguardando o host iniciar o jogo…
            </AppText>
          </Pulse>
        )
      }>
      <View style={styles.content}>
        <AiAccessBanner access={ai.access} onRequest={ai.request} />
        <Animated.View entering={enter.pop}>
          <Card tone="purple" style={styles.codeCard}>
            <AppText variant="overline" color={colors.onPrimarySecondary} align="center">
              CÓDIGO DA SALA
            </AppText>
            <AppText selectable style={styles.code} color={colors.white} align="center" accessibilityLabel={info.code.split('').join(' ')}>
              {info.code}
            </AppText>
            <View style={styles.codeActions}>
              <Button title="Copiar código" variant="light" size="medium" icon="copy-outline" onPress={copy} style={styles.flex} />
              <IconButton icon="share-outline" tone="light" size={48} accessibilityLabel="Compartilhar código" onPress={share} />
            </View>
          </Card>
        </Animated.View>

        {me.is_host ? (
          <Card style={styles.settings}>
            <Icon name="albums-outline" size={22} color={colors.primary} />
            <AppText variant="headline" style={styles.flex}>
              {formatRounds(info.configured_rounds)}
            </AppText>
            <Button title="Alterar" variant="secondary" size="small" fullWidth={false} onPress={() => setRoundsOpen(true)} />
          </Card>
        ) : null}

        <Card style={styles.players}>
          <View style={styles.playersHeader}>
            <AppText variant="overline" color={colors.inkTertiary}>
              JOGADORES
            </AppText>
            <AppText variant="subhead" weight="semibold" color={colors.primary}>
              {`${active.length}/${MAX_PLAYERS}`}
            </AppText>
          </View>
          {players.map((player) => (
            <Animated.View key={player.id} entering={enter.up} exiting={exit.fade} layout={layout}>
              <PlayerRow
                name={player.name}
                isHost={player.is_host}
                isMe={player.id === me.player_id}
                inactive={!player.is_active}
                statusText={playerStatus(player)}
                trailing={
                  me.is_host && player.id !== me.player_id ? (
                    <IconButton
                      icon="close"
                      size={32}
                      accessibilityLabel={`Remover ${player.name}`}
                      onPress={() => kick(player.id, player.name)}
                    />
                  ) : null
                }
              />
            </Animated.View>
          ))}
        </Card>
      </View>

      <Sheet
        visible={roundsOpen}
        onClose={() => setRoundsOpen(false)}
        title="Número de rodadas"
        footer={
          <Button
            title="Salvar"
            disabled={!rounds}
            onPress={async () => {
              if (!rounds) return;
              setRoundsOpen(false);
              await perform(() => room.actions.updateRounds(rounds));
            }}
          />
        }>
        <RoundSelector value={rounds} onChange={setRounds} label="Quantas rodadas?" />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingTop: spacing.xs,
  },
  codeCard: {
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  code: {
    fontSize: 46,
    lineHeight: 54,
    letterSpacing: 8,
    ...fontFor('heavy'),
  },
  codeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  flex: {
    flex: 1,
  },
  settings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
  },
  players: {
    gap: spacing.xxs,
  },
  playersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xxs,
  },
});
