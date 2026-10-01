import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutUp,
  LinearTransition,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';

/**
 * Animações curtas e discretas, no espírito do iOS.
 * Todas ficam abaixo de ~450 ms para não atrasar o jogo.
 */
export const enter = {
  fade: FadeIn.duration(260),
  up: FadeInDown.duration(360).easing(Easing.out(Easing.cubic)),
  down: FadeInUp.duration(360).easing(Easing.out(Easing.cubic)),
  pop: ZoomIn.springify().damping(14).stiffness(180),
  stagger: (index: number) =>
    FadeInDown.delay(80 * index)
      .duration(360)
      .easing(Easing.out(Easing.cubic)),
};

export const exit = {
  fade: FadeOut.duration(200),
  up: FadeOutUp.duration(220),
  pop: ZoomOut.duration(200),
};

export const layout = LinearTransition.springify().damping(18).stiffness(160);
