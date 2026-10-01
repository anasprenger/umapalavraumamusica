import { StyleSheet, View } from 'react-native';

import { colors, radii } from '@/theme';

type Props = {
  /** 0 a 1 */
  progress: number;
  tone?: 'light' | 'purple';
};

/** Barra fina de progresso (ex.: tempo restante da votação). */
export function ProgressBar({ progress, tone = 'purple' }: Props) {
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <View style={[styles.track, { backgroundColor: tone === 'purple' ? colors.onPrimarySurface : colors.lilac }]}>
      <View
        style={[
          styles.fill,
          {
            width: `${clamped * 100}%`,
            backgroundColor: tone === 'purple' ? colors.white : colors.primary,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    borderRadius: radii.pill,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
});
