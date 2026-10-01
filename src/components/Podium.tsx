import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';
import { formatPoints, ordinal } from '@/utils/format';
import { buildPodium, type PodiumTier, type Rankable } from '@/utils/ranking';

import { AppText } from './AppText';
import { Avatar } from './Avatar';
import { Gradient } from './Gradient';
import { Icon } from './Icon';

type Props<T extends Rankable> = {
  players: readonly T[];
  highlightId?: string | null;
};

const STEP_HEIGHT: Record<number, number> = { 1: 150, 2: 112, 3: 84 };
const STEP_COLOR: Record<number, string> = { 1: colors.gold, 2: colors.silver, 3: colors.bronze };
// Ordem de entrada: 3º, depois 2º e por último o 1º lugar.
const STEP_DELAY: Record<number, number> = { 3: 150, 2: 550, 1: 950 };

/** Pódio animado: 2º à esquerda, 1º ao centro (destaque) e 3º à direita; demais abaixo. */
export function Podium<T extends Rankable>({ players, highlightId }: Props<T>) {
  const { tiers, rest } = buildPodium(players);
  const byPosition = new Map(tiers.map((tier) => [tier.position, tier]));
  const layout = [2, 1, 3].map((position) => byPosition.get(position) ?? null);

  return (
    <View style={styles.wrapper}>
      <View style={styles.stage}>
        {layout.map((tier, index) =>
          tier ? <Step key={tier.position} tier={tier} highlightId={highlightId} /> : <View key={`empty-${index}`} style={styles.column} />,
        )}
      </View>

      {rest.length > 0 ? (
        <View style={styles.rest}>
          {rest.map((entry, index) => (
            <Animated.View
              key={entry.id}
              entering={FadeInDown.delay(1300 + index * 90).duration(320)}
              style={[styles.restRow, entry.id === highlightId ? styles.restRowMe : null]}>
              <AppText variant="headline" color={colors.onPrimarySecondary} style={styles.restPosition}>
                {ordinal(entry.position)}
              </AppText>
              <Avatar name={entry.name} size={34} ringColor={colors.onPrimarySurfaceStrong} />
              <AppText variant="headline" color={colors.white} numberOfLines={1} style={styles.restName}>
                {entry.name}
              </AppText>
              <AppText variant="subhead" weight="semibold" color={colors.onPrimarySecondary}>
                {formatPoints(entry.score)}
              </AppText>
            </Animated.View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Step<T extends Rankable>({ tier, highlightId }: { tier: PodiumTier<T>; highlightId?: string | null }) {
  const isFirst = tier.position === 1;
  const targetHeight = STEP_HEIGHT[tier.position];
  const delay = STEP_DELAY[tier.position];
  const height = useSharedValue(0);
  const labelOpacity = useSharedValue(0);

  useEffect(() => {
    height.set(withDelay(delay, withTiming(targetHeight, { duration: 520, easing: Easing.out(Easing.back(1.3)) })));
    labelOpacity.set(withDelay(delay + 280, withTiming(1, { duration: 360 })));
  }, [delay, height, labelOpacity, targetHeight]);

  const stepStyle = useAnimatedStyle(() => ({ height: height.get() }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.get(),
    transform: [{ translateY: (1 - labelOpacity.get()) * 12 }],
  }));

  const score = tier.players[0]?.score ?? 0;
  const names = tier.players.map((player) => player.name).join(' & ');
  const isMine = tier.players.some((player) => player.id === highlightId);

  return (
    <View style={styles.column}>
      <Animated.View style={[styles.people, labelStyle]}>
        {isFirst ? <Icon name="trophy" size={26} color={colors.gold} /> : null}
        <View style={styles.avatars}>
          {tier.players.slice(0, 3).map((player, index) => (
            <View key={player.id} style={index > 0 ? styles.avatarOverlap : null}>
              <Avatar name={player.name} size={isFirst ? 60 : 48} ringColor={colors.white} />
            </View>
          ))}
        </View>
        <AppText
          variant={isFirst ? 'headline' : 'subhead'}
          weight="bold"
          color={colors.white}
          align="center"
          numberOfLines={2}>
          {names}
          {isMine ? ' (você)' : ''}
        </AppText>
        <AppText variant="footnote" weight="semibold" color={colors.onPrimarySecondary} align="center">
          {formatPoints(score)}
        </AppText>
      </Animated.View>
      <Animated.View style={[styles.step, { backgroundColor: STEP_COLOR[tier.position] }, stepStyle]}>
        {isFirst ? <Gradient name="gold" direction="vertical" style={StyleSheet.absoluteFill} /> : null}
        <AppText variant={isFirst ? 'largeTitle' : 'title2'} weight="heavy" color={colors.primaryDeep} align="center">
          {ordinal(tier.position)}
        </AppText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xl,
  },
  stage: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 330,
  },
  column: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  people: {
    alignItems: 'center',
    gap: spacing.xxs,
    paddingBottom: spacing.sm,
    paddingHorizontal: 2,
  },
  avatars: {
    flexDirection: 'row',
  },
  avatarOverlap: {
    marginLeft: -14,
  },
  step: {
    alignSelf: 'stretch',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    alignItems: 'center',
    paddingTop: spacing.sm,
    overflow: 'hidden',
  },
  rest: {
    gap: spacing.xs,
  },
  restRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.onPrimarySurface,
  },
  restRowMe: {
    borderWidth: 1.5,
    borderColor: colors.onPrimarySecondary,
  },
  restPosition: {
    width: 32,
  },
  restName: {
    flex: 1,
  },
});
