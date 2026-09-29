import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter, exit } from '@/animations';
import {
  AppText,
  Banner,
  Button,
  Card,
  Header,
  IconButton,
  Pill,
  Scoreboard,
  Screen,
  TextField,
  WordDisplay,
} from '@/components';
import type { OnlineRoomApi } from '@/hooks/useOnlineRoom';
import { haptic } from '@/services/haptics';
import { friendlyMessage } from '@/services/onlineApi';
import { colors, spacing } from '@/theme';
import type { RoomSnapshot } from '@/types/online';
import { playerStatus } from '@/utils/players';

import { FinalRoundSheet } from './FinalRoundSheet';
import { PhaseOverlay } from './PhaseOverlay';
import { RoomMenuSheet } from './RoomMenuSheet';

type Props = {
  room: OnlineRoomApi;
  snapshot: RoomSnapshot;
  perform: (action: () => Promise<unknown>) => Promise<void>;
  notify: (text: string, tone?: 'info' | 'warning') => void;
  onLeave: () => void;
  /** Avisos flutuantes (ficam acima das fases). */
  toast?: ReactNode;
};

/** Tela 4 — Partida: palavra, palpite, pular e finalizar; as fases aparecem por cima. */
export function GameView({ room, snapshot, perform, notify, onLeave, toast }: Props) {
  const { room: info, current_word: word, me, finish, last_result: lastResult } = snapshot;
  const [guess, setGuess] = useState('');
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const seenResults = useRef(new Set<string>());
  const accepting = info.status === 'playing';

  // Falha técnica na verificação: aviso amigável, sem detalhes técnicos.
  useEffect(() => {
    if (!lastResult || seenResults.current.has(lastResult.id)) return;
    seenResults.current.add(lastResult.id);
    const recent =
      lastResult.verified_at && Date.parse(snapshot.server_time) - Date.parse(lastResult.verified_at) < 8000;
    if (lastResult.status === 'error' && recent) {
      notify(verificationErrorText(lastResult.failure_reason, lastResult.player_id === me.player_id), 'warning');
    }
  }, [lastResult, snapshot.server_time, notify, me.player_id]);

  const send = async () => {
    const text = guess.trim();
    if (!text || !accepting || sending) return;
    setSending(true);
    try {
      const result = await room.actions.submitGuess(text);
      if (result.accepted) {
        setGuess('');
        haptic('medium');
      } else {
        notify(result.reason === 'busy' ? 'Outro palpite chegou primeiro. Aguarde o resultado.' : 'Aguarde a próxima palavra.');
      }
    } catch (caught) {
      notify(friendlyMessage(caught), 'warning');
    } finally {
      setSending(false);
    }
  };

  const requestFinish = () => {
    haptic('medium');
    void perform(() => room.actions.requestFinish());
  };

  const finishLabel = finish.count > 0 ? `Finalizar (${finish.count})` : 'Finalizar';
  const firstRequester = finish.requested_by[0];
  const others = finish.count - 1;

  return (
    <Screen
      scroll
      keyboard
      overlay={
        <>
          <PhaseOverlay
            snapshot={snapshot}
            deadlineLocal={room.deadlineLocal}
            onVote={(choice) => void perform(() => room.actions.vote(choice))}
          />
          {toast}
        </>
      }
      header={
        <Header
          title={`Rodada ${word?.display_round ?? info.rounds_played + 1} de ${info.configured_rounds}`}
          subtitle={`Sala ${info.code}`}
          onBack={onLeave}
          backIcon="close"
          right={<IconButton icon="podium-outline" accessibilityLabel="Placar e opções" onPress={() => setMenuOpen(true)} />}
        />
      }
      footer={
        <>
          <TextField
            placeholder="Digite seu palpite..."
            value={guess}
            onChangeText={setGuess}
            maxLength={200}
            editable={accepting}
            returnKeyType="send"
            onSubmitEditing={send}
            accessibilityLabel="Palpite: nome da música ou trecho da letra"
            trailing={
              <IconButton
                icon="arrow-up"
                tone="primary"
                size={40}
                accessibilityLabel="Enviar palpite"
                disabled={!guess.trim() || !accepting || sending}
                onPress={send}
              />
            }
          />
          <View style={styles.row}>
            <Button
              title="Pular palavra"
              variant="secondary"
              size="medium"
              icon="play-skip-forward-outline"
              disabled={!accepting}
              style={styles.flex}
              onPress={() => perform(() => room.actions.requestNewWord())}
            />
            <Button
              title={finishLabel}
              variant={finish.i_requested ? 'primary' : 'secondary'}
              size="medium"
              icon="flag-outline"
              disabled={finish.i_requested}
              style={styles.flex}
              onPress={requestFinish}
            />
          </View>
        </>
      }>
      <View style={styles.content}>
        {room.connection === 'reconnecting' ? (
          <Banner tone="warning" icon="cloud-offline-outline" title="Reconectando…" message="Seu lugar e seus pontos estão guardados." />
        ) : null}

        {finish.count > 0 && !finish.i_requested && firstRequester ? (
          <Banner
            tone="purple"
            icon="flag"
            title={others > 0 ? `${firstRequester} e mais ${others} clicaram em finalizar.` : `${firstRequester} clicou em finalizar o jogo.`}
            message={`Deseja finalizar também? São necessários ${finish.needed} pedidos.`}
            action={<Button title={finishLabel} variant="light" size="small" onPress={requestFinish} />}
          />
        ) : null}

        {word ? (
          <Animated.View entering={enter.up}>
            <WordDisplay word={word.word} />
          </Animated.View>
        ) : null}

        <View style={styles.status}>
          {info.is_last_round ? (
            <Animated.View entering={enter.pop} exiting={exit.fade}>
              <Pill icon="flag" label="Última rodada" tone="purple" />
            </Animated.View>
          ) : word?.has_attempt ? (
            <Animated.View entering={enter.pop} exiting={exit.fade}>
              <Pill icon="checkmark-circle" label="Esta palavra já conta como rodada" />
            </Animated.View>
          ) : (
            <AppText variant="footnote" color={colors.inkTertiary} align="center">
              Envie o nome da música ou um trecho da letra. O primeiro palpite é verificado.
            </AppText>
          )}
        </View>

        <Card style={styles.scores}>
          <AppText variant="overline" color={colors.inkTertiary}>
            PLACAR
          </AppText>
          <Scoreboard
            players={snapshot.players.map((player) => ({
              id: player.id,
              name: player.name,
              score: player.score,
              joinOrder: player.join_order,
              isHost: player.is_host,
              inactive: !player.is_active,
              statusText: playerStatus(player),
            }))}
            meId={me.player_id}
          />
        </Card>
      </View>

      <FinalRoundSheet
        visible={me.is_host && info.final_round_prompt && info.status === 'playing'}
        onAnswer={(extra) => void perform(() => room.actions.respondFinalRound(extra))}
      />
      <RoomMenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        room={room}
        snapshot={snapshot}
        perform={perform}
        onLeave={() => {
          setMenuOpen(false);
          onLeave();
        }}
      />
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

/** Aviso quando a verificação falha (o palpite não conta e todos podem enviar de novo). */
function verificationErrorText(reason: string | null, mine: boolean): string {
  if (mine && reason === 'ai_not_allowed') {
    return 'Para palpitar, permita que o Claude verifique as músicas (o uso sai do seu plano).';
  }
  if (mine && reason === 'ai_rate_limited') return 'Seu limite de uso do Claude foi atingido. Tente mais tarde.';
  if (mine && reason === 'ai_session_expired') return 'Sua sessão no Claude expirou. Entre de novo para palpitar.';
  return 'Não conseguimos verificar a música agora. Tentem enviar de novo.';
}
