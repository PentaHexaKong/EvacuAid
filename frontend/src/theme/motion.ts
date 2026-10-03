import { cubicBezier, Easing } from 'react-native-reanimated';

export const ease = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  drawer: Easing.bezier(0.32, 0.72, 0, 1),
};
export const easeCss = {
  out: cubicBezier(0.23, 1, 0.32, 1),
  drawer: cubicBezier(0.32, 0.72, 0, 1),
};
export const spring = {
  ui: { duration: 350, dampingRatio: 1 },
  sheet: { duration: 400, dampingRatio: 0.85 },
  press: { duration: 160, dampingRatio: 1 },
  bloom: { duration: 1200, dampingRatio: 1 },
};
export const duration = { press: 120, state: 200, enter: 300, exit: 150, stagger: 65, dash: 500, camera: 400 };
