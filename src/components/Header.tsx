import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme';

import { AppText } from './AppText';
import { IconButton } from './IconButton';

type Props = {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  backIcon?: 'chevron-back' | 'close';
  right?: ReactNode;
  tone?: 'light' | 'purple';
  /** Título grande abaixo da barra, no estilo "Large Title" do iOS. */
  large?: boolean;
};

/** Cabeçalho simples: voltar à esquerda, título central/grande e ações à direita. */
export function Header({ title, subtitle, onBack, backIcon = 'chevron-back', right, tone = 'light', large = false }: Props) {
  const onPurple = tone === 'purple';
  const textColor = onPurple ? colors.white : colors.primaryDeep;
  const subtitleColor = onPurple ? colors.onPrimarySecondary : colors.primary;

  return (
    <View style={styles.wrapper}>
      <View style={styles.bar}>
        <View style={styles.side}>
          {onBack ? (
            <IconButton
              icon={backIcon}
              onPress={onBack}
              accessibilityLabel={backIcon === 'close' ? 'Fechar' : 'Voltar'}
              tone={onPurple ? 'light' : 'dark'}
            />
          ) : null}
        </View>
        {!large && title ? (
          <View style={styles.center}>
            <AppText variant="headline" color={textColor} numberOfLines={1} align="center">
              {title}
            </AppText>
            {subtitle ? (
              <AppText variant="caption" color={subtitleColor} align="center" numberOfLines={1}>
                {subtitle}
              </AppText>
            ) : null}
          </View>
        ) : (
          <View style={styles.center} />
        )}
        <View style={[styles.side, styles.right]}>{right}</View>
      </View>
      {large && title ? (
        <View style={styles.large}>
          <AppText variant="largeTitle" color={textColor}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="subhead" color={subtitleColor}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  bar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  side: {
    minWidth: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  right: {
    justifyContent: 'flex-end',
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  large: {
    paddingHorizontal: spacing.xxs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    gap: spacing.xxs,
  },
});
