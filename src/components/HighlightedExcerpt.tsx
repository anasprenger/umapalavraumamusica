import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';
import { highlightWord } from '@/utils/highlight';

import { AppText } from './AppText';

type Props = {
  excerpt: string;
  word: string;
  tone?: 'light' | 'purple';
};

/** Trecho da letra com a palavra sorteada destacada. */
export function HighlightedExcerpt({ excerpt, word, tone = 'purple' }: Props) {
  const segments = highlightWord(excerpt, word);
  const onPurple = tone === 'purple';
  return (
    <View style={[styles.box, { backgroundColor: onPurple ? colors.onPrimarySurface : colors.lilacSoft }]}>
      <AppText variant="callout" align="center" color={onPurple ? colors.onPrimarySecondary : colors.inkSecondary}>
        {'“'}
        {segments.map((segment, index) =>
          segment.highlight ? (
            <AppText
              key={index}
              variant="callout"
              weight="heavy"
              color={onPurple ? colors.primaryDeep : colors.white}
              style={[styles.mark, { backgroundColor: onPurple ? colors.white : colors.primary }]}>
              {` ${segment.text.toUpperCase()} `}
            </AppText>
          ) : (
            segment.text
          ),
        )}
        {'”'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignSelf: 'stretch',
  },
  mark: {
    borderRadius: 6,
    overflow: 'hidden',
  },
});
