import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

type HapticKind = 'light' | 'medium' | 'success' | 'warning' | 'error' | 'selection';

/** Feedback tátil discreto. Silencioso na web e em aparelhos sem suporte. */
export function haptic(kind: HapticKind = 'light'): void {
  if (Platform.OS === 'web') return;
  const run = async () => {
    switch (kind) {
      case 'light':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      case 'medium':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      case 'selection':
        return Haptics.selectionAsync();
      case 'success':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      case 'warning':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      case 'error':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };
  run().catch(() => undefined);
}
