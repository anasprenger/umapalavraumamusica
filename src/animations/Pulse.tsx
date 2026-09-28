import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Escala máxima do pulso. */
  to?: number;
  duration?: number;
};

/** Pulso contínuo e suave, usado nas telas de espera (ex.: verificação). */
export function Pulse({ children, style, to = 1.08, duration = 700 }: Props) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(progress);
  }, [duration, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (to - 1) * progress.get() }],
    opacity: 0.85 + 0.15 * progress.get(),
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
