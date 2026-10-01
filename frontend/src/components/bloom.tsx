import { useContext, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { colors, SystemReduceMotionContext } from '@/theme';
import { duration, spring } from '@/theme/motion';

const SIZE = 520;
export type BloomStage = 'rest' | 'grown' | 'hidden';
const stages: Record<BloomStage, { scale: number; x: number; y: number; opacity: number }> = {
  rest: { scale: 0.62, x: 0, y: 0, opacity: 1 },
  grown: { scale: 1.05, x: -30, y: -60, opacity: 1 },
  hidden: { scale: 0.35, x: 0, y: 0, opacity: 0 },
};

export function Bloom({ stage }: { stage: BloomStage }) {
  const reduceMotion = useContext(SystemReduceMotionContext);
  const scale = useSharedValue(stages[stage].scale);
  const x = useSharedValue(stages[stage].x);
  const y = useSharedValue(stages[stage].y);
  const opacity = useSharedValue(stages[stage].opacity);
  useEffect(() => {
    const target = stages[stage];
    if (reduceMotion) {
      scale.set(target.scale);
      x.set(target.x);
      y.set(target.y);
      opacity.set(withTiming(target.opacity, { duration: duration.state }));
      return;
    }
    scale.set(withSpring(target.scale, spring.bloom));
    x.set(withSpring(target.x, spring.bloom));
    y.set(withSpring(target.y, spring.bloom));
    opacity.set(withTiming(target.opacity, { duration: target.opacity ? duration.enter : 600 }));
  }, [stage, reduceMotion, scale, x, y, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }] }));
  return <Animated.View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.bloom, style]}>
    <Svg width={SIZE} height={SIZE}>
      <Defs>
        <RadialGradient id="bloom" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={colors.primary} stopOpacity={0.55} />
          <Stop offset="0.3" stopColor={colors.accent} stopOpacity={0.55} />
          <Stop offset="0.52" stopColor={colors.sky} stopOpacity={0.5} />
          <Stop offset="0.7" stopColor={colors.air} stopOpacity={0.35} />
          <Stop offset="1" stopColor={colors.surface} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} fill="url(#bloom)" />
    </Svg>
  </Animated.View>;
}

const styles = StyleSheet.create({
  bloom: { position: 'absolute', right: -SIZE * 0.36, bottom: -SIZE * 0.38, width: SIZE, height: SIZE, transformOrigin: '70% 70%' },
});
