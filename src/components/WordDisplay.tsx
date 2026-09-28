import { StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { colors, radii, shadows, spacing } from '@/theme';

import { AppText } from './AppText';

type Props = {
  word: string;
  label?: string;
  /** `card`: cartão roxo sobre fundo claro. `plain`: texto branco direto sobre fundo roxo. */
  appearance?: 'card' | 'plain';
};

/** A palavra da rodada, grande e centralizada, com animação a cada troca. */
export function WordDisplay({ word, label = 'PALAVRA', appearance = 'card' }: Props) {
  // Palavras longas diminuem para caber numa linha (a web não tem adjustsFontSizeToFit).
  const fontSize = Math.max(26, Math.min(56, Math.floor(280 / (Math.max(word.length, 1) * 0.72))));
  return (
    <View style={[styles.base, appearance === 'card' ? [styles.card, shadows.medium] : null]}>
      <AppText variant="overline" color={colors.onPrimarySecondary} align="center">
        {label}
      </AppText>
      <Animated.View key={word} entering={ZoomIn.springify().damping(13).stiffness(170)}>
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
  },
});
