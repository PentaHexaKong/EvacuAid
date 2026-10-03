import { useContext, useState } from 'react';
import type { CSSTransitionProperties } from 'react-native-reanimated';
import { SystemReduceMotionContext } from '@/theme';
import { duration, easeCss } from '@/theme/motion';

export const motion: Record<'pressTransition' | 'checkTransition', CSSTransitionProperties> = {
  pressTransition: { transitionProperty: ['transform', 'backgroundColor', 'borderColor'], transitionDuration: duration.press, transitionTimingFunction: easeCss.out },
  checkTransition: { transitionProperty: ['opacity', 'transform'], transitionDuration: duration.enter, transitionTimingFunction: easeCss.out },
};

export function usePressScale(scale: number) {
  const reduceMotion = useContext(SystemReduceMotionContext);
  const [pressed, setPressed] = useState(false);
  return {
    pressed,
    handlers: { onPressIn: () => setPressed(true), onPressOut: () => setPressed(false), pressRetentionOffset: 16 },
    style: [motion.pressTransition, pressed && !reduceMotion && { transform: [{ scale }] }],
  };
}
