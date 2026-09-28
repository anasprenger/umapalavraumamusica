import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/animations';
import { haptic } from '@/services/haptics';
import { colors, radii } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

type Props = {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  tone?: 'light' | 'dark' | 'primary';
  size?: number;
  badge?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

const tones = {
  light: { bg: colors.onPrimarySurface, fg: colors.white },
  dark: { bg: colors.lilac, fg: colors.primaryDark },
  primary: { bg: colors.primary, fg: colors.white },
} as const;

/** Botão circular com ícone (voltar, menu, copiar...). */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  tone = 'dark',
  size = 40,
  badge,
  disabled,
  style,
}: Props) {
  const { bg, fg } = tones[tone];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={8}
      pressedScale={0.92}
      onPress={() => {
        haptic('light');
        onPress?.();
      }}
      style={[
        styles.base,
        { width: size, height: size, backgroundColor: bg, opacity: disabled ? 0.4 : 1 },
        style,
      ]}>
      <Icon name={icon} size={size * 0.5} color={fg} />
      {badge ? (
        <View style={styles.badge}>
          <AppText variant="caption" color={colors.white} weight="bold">
            {badge}
          </AppText>
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
