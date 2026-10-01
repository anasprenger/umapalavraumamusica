import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

type Props = {
  label: string;
  icon?: IconName;
  tone?: 'lilac' | 'purple' | 'glass' | 'white' | 'gold' | 'success';
};

const tones = {
  lilac: { bg: colors.lilac, fg: colors.primaryDark },
  purple: { bg: colors.primary, fg: colors.white },
  glass: { bg: colors.onPrimarySurface, fg: colors.white },
  white: { bg: colors.white, fg: colors.primaryDark },
  gold: { bg: colors.goldSoft, fg: colors.goldDeep },
  success: { bg: colors.successSoft, fg: colors.successDeep },
} as const;

/** Etiqueta compacta (ex.: "Rodada 3 de 10", código da sala). */
export function Pill({ label, icon, tone = 'lilac' }: Props) {
  const { bg, fg } = tones[tone];
  return (
    <View style={[styles.base, { backgroundColor: bg }]}>
      {icon ? <Icon name={icon} size={14} color={fg} /> : null}
      <AppText variant="footnote" weight="semibold" color={fg} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.pill,
    alignSelf: 'center',
  },
});
