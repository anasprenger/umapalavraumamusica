import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PressableScale, Pulse } from '@/animations';
import { AppText, CountdownNumber, HighlightedExcerpt, Icon, LogoMark, ProgressBar } from '@/components';
import { useCountdown } from '@/hooks/useCountdown';
import { haptic } from '@/services/haptics';
import { colors, maxContentWidth, radii, spacing } from '@/theme';
import type { GuessResult, RoomSnapshot, VoteChoice } from '@/types/online';

const OVERLAY_STATUSES = ['starting', 'verifying', 'correct', 'countdown', 'incorrect', 'decision'] as const;
const DECISION_MS = 3000;

type Props = {
  snapshot: RoomSnapshot;
  deadlineLocal: number | null;
  onVote: (choice: VoteChoice) => void;
};

/** Telas cheias das fases da rodada (5 a 8): verificação, acerto, incorreto e decisão. */
export function PhaseOverlay({ snapshot, deadlineLocal, onVote }: Props) {
  const status = snapshot.room.status;
  const visible = (OVERLAY_STATUSES as readonly string[]).includes(status);
  const countdown = useCountdown(visible ? deadlineLocal : null, status === 'decision' ? DECISION_MS : 3000);

  useEffect(() => {
    if (status === 'correct') haptic('success');
    else if (status === 'incorrect') haptic('error');
  }, [status]);

  if (!visible) return null;
  const word = snapshot.current_word?.word ?? '';

  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(220)} style={[StyleSheet.absoluteFill, styles.overlay]}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe}>
        <Animated.View key={status === 'countdown' ? 'correct' : status} entering={FadeIn.duration(260)} style={styles.stage}>
          {status === 'starting' ? (
            <Starting seconds={countdown.secondsLeft} rounds={snapshot.room.configured_rounds} />
          ) : null}
          {status === 'verifying' ? <Verifying name={snapshot.active_guess?.player_name} text={snapshot.active_guess?.text} /> : null}
          {status === 'correct' || status === 'countdown' ? (
            <Correct
              result={snapshot.last_result}
              word={word}
              showCountdown={status === 'countdown'}
              seconds={countdown.secondsLeft}
            />
          ) : null}
          {status === 'incorrect' ? <Incorrect result={snapshot.last_result} word={word} /> : null}
          {status === 'decision' ? (
            <Decision
              snapshot={snapshot}
              seconds={countdown.secondsLeft}
              progress={countdown.progress}
              onVote={onVote}
            />
          ) : null}
        </Animated.View>
      </SafeAreaView>
    </Animated.View>
  );
}

function Starting({ seconds, rounds }: { seconds: number; rounds: number }) {
  return (
    <View style={styles.center}>
      <Animated.View entering={ZoomIn.springify().damping(12)}>
        <LogoMark size={88} />
      </Animated.View>
      <AppText variant="overline" color={colors.onPrimarySecondary} align="center">
        {`${rounds} ${rounds === 1 ? 'RODADA' : 'RODADAS'}`}
      </AppText>
      <AppText variant="largeTitle" color={colors.white} align="center">
        Preparem-se!
      </AppText>
      <CountdownNumber seconds={Math.max(1, seconds)} />
    </View>
  );
}

/** Tela 5 — "Música de Ana em verificação..." */
function Verifying({ name, text }: { name?: string; text?: string }) {
  return (
    <View style={styles.center}>
      <Pulse to={1.12} duration={650}>
        <View style={styles.noteBubble}>
          <LogoMark variant="note" size={72} />
        </View>
      </Pulse>
      <AppText variant="overline" color={colors.onPrimarySecondary} align="center">
        {`MÚSICA DE ${(name ?? '').toUpperCase()}`}
      </AppText>
      <AppText variant="title1" color={colors.white} align="center">
        em verificação…
      </AppText>
      {text ? (
        <AppText variant="callout" color={colors.onPrimarySecondary} align="center" numberOfLines={3}>
          {`“${text}”`}
        </AppText>
      ) : null}
      <AppText variant="footnote" color={colors.onPrimarySecondary} align="center">
        Conferindo título, artista e letra. Pode levar alguns segundos.
      </AppText>
    </View>
  );
}

/** Tela 6 — Acerto + "Próxima palavra em 3, 2, 1". */
function Correct({
  result,
  word,
  showCountdown,
  seconds,
}: {
  result: GuessResult | null;
  word: string;
  showCountdown: boolean;
  seconds: number;
}) {
  return (
    <View style={styles.center}>
      <Animated.View entering={ZoomIn.springify().damping(10).stiffness(160)} style={styles.check}>
        <Icon name="checkmark" size={46} color={colors.primary} />
      </Animated.View>
      <AppText variant="largeTitle" color={colors.white} align="center">
        CONFIRMADO!
      </AppText>
      {result?.result_song ? (
        <View style={styles.song}>
          <AppText variant="title2" color={colors.white} align="center">
            {result.result_song}
          </AppText>
          {result.result_artist ? (
            <AppText variant="headline" color={colors.onPrimarySecondary} align="center">
              {result.result_artist}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {result?.matched_excerpt ? <HighlightedExcerpt excerpt={result.matched_excerpt} word={word} /> : null}
      {result ? (
        <View style={styles.pointPill}>
          <AppText variant="subhead" weight="bold" color={colors.primaryDeep}>
            {`+1 ponto para ${result.player_name}`}
          </AppText>
        </View>
      ) : null}
      <View style={styles.countdownArea}>
        {showCountdown ? (
          <Animated.View entering={FadeIn.duration(200)} style={styles.center}>
            <AppText variant="subhead" color={colors.onPrimarySecondary}>
              Próxima palavra em…
            </AppText>
            <CountdownNumber seconds={Math.max(1, seconds)} size={72} />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

function failureText(result: GuessResult | null, word: string): string {
  if (!result) return '';
  if (result.failure_reason === 'word_not_in_song' && result.result_song) {
    const artist = result.result_artist ? ` — ${result.result_artist}` : '';
    return `Encontramos “${result.result_song}”${artist}, mas ela não tem a palavra ${word.toUpperCase()}.`;
  }
  const song = result.result_song
    ? `“${result.result_song}”${result.result_artist ? ` (${result.result_artist})` : ''}`
    : null;
  if (result.failure_reason === 'song_not_found' && song) return `Não conseguimos confirmar que ${song} existe.`;
  if (result.failure_reason === 'song_mismatch' && song) return `Não conseguimos confirmar que isso é de ${song}.`;
  if (result.failure_reason === 'ambiguous') return 'Não deu para identificar de qual música é.';
  if (result.failure_reason === 'word_not_in_song') return `A música citada não tem a palavra ${word.toUpperCase()}.`;
  return `Não reconhecemos de qual música é “${result.text}”.`;
}

/** Tela 7 — Música incorreta. */
function Incorrect({ result, word }: { result: GuessResult | null; word: string }) {
  return (
    <View style={styles.center}>
      <Animated.View entering={ZoomIn.springify().damping(12)} style={[styles.check, styles.cross]}>
        <Icon name="close" size={46} color={colors.white} />
      </Animated.View>
      <AppText variant="largeTitle" color={colors.white} align="center">
        MÚSICA INCORRETA
      </AppText>
      {result ? (
        <AppText variant="callout" color={colors.onPrimarySecondary} align="center">
          {`Palpite de ${result.player_name}. ${failureText(result, word)}`}
        </AppText>
      ) : null}
      <AppText variant="title3" color={colors.white} align="center">
        Mais alguém tem palpite?
      </AppText>
    </View>
  );
}

/** Tela 8 — Decisão "Novo palpite" × "Nova palavra" (3 segundos). */
function Decision({
  snapshot,
  seconds,
  progress,
  onVote,
}: {
  snapshot: RoomSnapshot;
  seconds: number;
  progress: number;
  onVote: (choice: VoteChoice) => void;
}) {
  const { votes, room, current_word: word } = snapshot;
  const fromSkip = room.decision_origin === 'skip_request';
  const options: { choice: VoteChoice; label: string; count: number }[] = [
    { choice: 'new_guess', label: 'Novo palpite', count: votes.new_guess },
    { choice: 'new_word', label: 'Nova palavra', count: votes.new_word },
  ];

  return (
    <View style={styles.center}>
      <AppText variant="overline" color={colors.onPrimarySecondary} align="center">
        {fromSkip ? 'PEDIRAM PARA PULAR A PALAVRA' : 'MÚSICA INCORRETA'}
      </AppText>
      <AppText variant="largeTitle" color={colors.white} align="center">
        O que fazer?
      </AppText>
      <View style={styles.options}>
        {options.map((option) => {
          const mine = votes.my_choice === option.choice;
          return (
            <PressableScale
              key={option.choice}
              accessibilityRole="button"
              accessibilityState={{ selected: mine }}
              accessibilityLabel={`${option.label}, ${option.count} votos`}
              onPress={() => {
                haptic('selection');
                onVote(option.choice);
              }}
              style={[styles.option, mine ? styles.optionMine : null]}>
              <AppText variant="headline" color={mine ? colors.primaryDeep : colors.white} align="center">
                {option.label}
              </AppText>
              <AppText variant="title1" color={mine ? colors.primary : colors.white} align="center">
                {option.count}
              </AppText>
              {mine ? <Icon name="checkmark-circle" size={20} color={colors.primary} /> : null}
            </PressableScale>
          );
        })}
      </View>
      <CountdownNumber seconds={Math.max(1, seconds)} size={64} />
      <View style={styles.progress}>
        <ProgressBar progress={1 - progress} />
      </View>
      <AppText variant="footnote" color={colors.onPrimaryTertiary} align="center">
        {word?.has_attempt
          ? 'Empate ou sem votos: nova palavra. Esta palavra já conta como rodada.'
          : 'Empate ou sem votos: nova palavra. Sem palpite verificado, não conta como rodada.'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: colors.primaryDeep,
    zIndex: 50,
  },
  safe: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    width: '100%',
    maxWidth: maxContentWidth,
    paddingHorizontal: spacing.xl,
  },
  center: {
    alignItems: 'center',
    gap: spacing.md,
  },
  noteBubble: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: colors.onPrimarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cross: {
    backgroundColor: colors.onPrimarySurfaceStrong,
  },
  song: {
    alignItems: 'center',
    gap: 2,
  },
  pointPill: {
    backgroundColor: colors.gold,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  countdownArea: {
    minHeight: 120,
    justifyContent: 'center',
  },
  options: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignSelf: 'stretch',
  },
  option: {
    flex: 1,
    minHeight: 120,
    borderRadius: radii.xl,
    backgroundColor: colors.onPrimarySurface,
    borderWidth: 2,
    borderColor: colors.onPrimarySurfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    padding: spacing.md,
  },
  optionMine: {
    backgroundColor: colors.white,
    borderColor: colors.white,
  },
  progress: {
    alignSelf: 'stretch',
  },
});
