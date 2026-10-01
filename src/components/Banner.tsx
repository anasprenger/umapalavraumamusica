import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { enter, exit } from '@/animations';
import { colors, radii, shadows, spacing } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

type Props = {
  title: string;
  message?: string;
  icon?: IconName;
  tone?: 'info' | 'warning' | 'purple';
  action?: ReactNode;
};

const tones = {
  info: { bg: colors.white, fg: colors.ink, accent: colors.primary },
  warning: { bg: colors.warningSoft, fg: colors.ink, accent: '#B7791F' },
  purple: { bg: colors.primary, fg: colors.white, accent: colors.white },
} as const;

/** Aviso discreto no topo/rodapé da tela (conexão, pedidos de finalização...). */
export function Banner({ title, message, icon = 'information-circle', tone = 'info', action }: Props) {
  const { bg, fg, accent } = tones[tone];
  return (
    <Animated.View entering={enter.down} exiting={exit.up} style={[styles.box, { backgroundColor: bg }, shadows.medium]}>
      <View style={styles.row}>
        <Icon name={icon} size={22} color={accent} />
        <View style={styles.texts}>
          <AppText variant="subhead" weight="semibold" color={fg}>
            {title}
          </AppText>
          {message ? (
            <AppText variant="footnote" color={tone === 'purple' ? colors.onPrimarySecondary : colors.inkSecondary}>
              {message}
            </AppText>
          ) : null}
        </View>
      </View>
      {action}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  texts: {
    flex: 1,
    gap: 2,
  },
});
