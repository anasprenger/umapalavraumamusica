import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/animations';
import { haptic } from '@/services/haptics';
import { colors, radii, spacing } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'light' | 'lightGhost' | 'lightLink' | 'danger';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'large' | 'medium' | 'small';
  icon?: IconName;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  testID?: string;
};

const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: colors.white },
  secondary: { bg: colors.lilac, fg: colors.primaryDark },
  ghost: { bg: colors.transparent, fg: colors.primary },
  light: { bg: colors.white, fg: colors.primaryDark },
  lightGhost: { bg: colors.onPrimarySurface, fg: colors.white, border: colors.onPrimarySurfaceStrong },
  lightLink: { bg: colors.transparent, fg: colors.onPrimarySecondary },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
};

const heights = { large: 56, medium: 48, small: 38 } as const;

/** Botão grande, arredondado e fácil de tocar. */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'large',
  icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
  accessibilityHint,
  testID,
}: Props) {
  const { bg, fg, border } = palette[variant];
  const inactive = disabled || loading;
  const iconNode = icon ? <Icon name={icon} size={size === 'small' ? 17 : 20} color={fg} /> : null;

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={() => {
        haptic('light');
        onPress?.();
      }}
      style={[
        styles.base,
        {
          backgroundColor: bg,
          height: heights[size],
          borderRadius: size === 'small' ? radii.pill : radii.lg,
          paddingHorizontal: size === 'small' ? spacing.md : spacing.xl,
          opacity: disabled ? 0.45 : 1,
          alignSelf: fullWidth ? 'stretch' : 'auto',
        },
        border ? { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: border } : null,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.content}>
          {iconPosition === 'left' ? iconNode : null}
          <AppText
            variant={size === 'small' ? 'subhead' : 'headline'}
            weight="semibold"
            color={fg}
            numberOfLines={1}>
            {title}
          </AppText>
          {iconPosition === 'right' ? iconNode : null}
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
