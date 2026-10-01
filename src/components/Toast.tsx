import { StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ToastMessage } from '@/hooks/useToast';
import { colors, maxContentWidth, radii, shadows, spacing } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

/** Aviso flutuante no topo da tela. */
export function Toast({ toast }: { toast: ToastMessage | null }) {
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <View pointerEvents="none" style={[styles.wrapper, { top: insets.top + spacing.xs }]}>
      <Animated.View
        key={toast.id}
        entering={FadeInUp.duration(220)}
        exiting={FadeOutUp.duration(200)}
        style={[styles.toast, shadows.medium, toast.tone === 'warning' ? styles.warning : null]}
        accessibilityLiveRegion="polite">
        <Icon
          name={toast.tone === 'warning' ? 'alert-circle' : 'information-circle'}
          size={20}
          color={toast.tone === 'warning' ? '#B7791F' : colors.primary}
        />
        <AppText variant="subhead" weight="medium" style={styles.text}>
          {toast.text}
        </AppText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    zIndex: 100,
  },
  toast: {
    width: '100%',
    maxWidth: maxContentWidth - spacing.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  warning: {
    backgroundColor: colors.warningSoft,
  },
  text: {
    flex: 1,
  },
});
