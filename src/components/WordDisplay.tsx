import { StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';

import { AppText } from './AppText';
import { Gradient } from './Gradient';
import { Icon } from './Icon';

type Props = {
  word: string;
  label?: string;
  /** `card`: cartão roxo sobre fundo claro. `plain`: texto branco direto sobre fundo roxo. */
  appearance?: 'card' | 'plain';
  /** Anima a troca de palavra (o modo local troca sem animação). */
  animated?: boolean;
};

/** A palavra da rodada, grande e centralizada, com animação a cada troca. */
export function WordDisplay({ word, label = 'PALAVRA', appearance = 'card', animated = true }: Props) {
  // Palavras longas diminuem para caber numa linha (a web não tem adjustsFontSizeToFit).
  const fontSize = Math.max(26, Math.min(56, Math.floor(280 / (Math.max(word.length, 1) * 0.72))));
  const card = appearance === 'card';
  return (
    <View style={[styles.base, card ? styles.card : null]}>
      {card ? (
        <Gradient name="word" style={[StyleSheet.absoluteFill, styles.cardFill]}>
          <View style={[styles.note, styles.noteLeft]}>
            <Icon name="musical-note" size={72} color={colors.onPrimarySurface} />
          </View>
          <View style={[styles.note, styles.noteRight]}>
            <Icon name="musical-notes" size={56} color={colors.onPrimarySurface} />
          </View>
        </Gradient>
      ) : null}
      <AppText variant="overline" color={colors.onPrimarySecondary} align="center">
        {label}
      </AppText>
      <Animated.View key={word} entering={animated ? ZoomIn.springify().damping(13).stiffness(170) : undefined}>
        <AppText
          variant="display"
          color={colors.white}
          align="center"
          uppercase
          adjustsFontSizeToFit
          numberOfLines={1}
          style={{ fontSize, lineHeight: fontSize * 1.15 }}
          accessibilityRole="header">
          {word}
        </AppText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    boxShadow: '0px 14px 30px rgba(74, 35, 176, 0.35)',
  },
  cardFill: {
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  note: {
    position: 'absolute',
  },
  noteLeft: {
    left: -10,
    bottom: -14,
    transform: [{ rotate: '-14deg' }],
  },
  noteRight: {
    right: 10,
    top: 8,
    transform: [{ rotate: '12deg' }],
  },
});
