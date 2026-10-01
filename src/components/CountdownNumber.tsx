import { StyleSheet, View } from 'react-native';
import Animated, { ZoomIn, ZoomOut } from 'react-native-reanimated';

import { colors } from '@/theme';

import { AppText } from './AppText';

type Props = {
  seconds: number;
  size?: number;
  tone?: 'light' | 'purple';
};

/** Número grande da contagem regressiva (3, 2, 1), com animação a cada segundo. */
export function CountdownNumber({ seconds, size = 88, tone = 'purple' }: Props) {
  const color = tone === 'purple' ? colors.white : colors.primary;
  const ring = tone === 'purple' ? colors.onPrimarySurfaceStrong : colors.lilacStrong;
  const value = Math.max(0, seconds);
  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, borderColor: ring }]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${value}`}>
      <Animated.View key={value} entering={ZoomIn.duration(260)} exiting={ZoomOut.duration(150)}>
        <AppText
          variant="display"
          color={color}
          align="center"
          style={{ fontSize: size * 0.5, lineHeight: size * 0.6 }}>
          {value}
        </AppText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
