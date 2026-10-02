import { useContext } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, ZoomIn, type CSSAnimationKeyframes } from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { Logo } from './logo';
import { brand, SystemReduceMotionContext } from '@/theme';
import { duration, ease, spring } from '@/theme/motion';
import { useHaptics } from '@/features/feedback/haptics';

const FLOAT: CSSAnimationKeyframes = {
  '0%': { transform: [{ translateY: 0 }, { rotate: '-2deg' }] },
  '50%': { transform: [{ translateY: -10 }, { rotate: '2deg' }] },
  '100%': { transform: [{ translateY: 0 }, { rotate: '-2deg' }] },
};
const BREATHE: CSSAnimationKeyframes = {
  '0%': { opacity: 1, transform: [{ scaleX: 1 }] },
  '50%': { opacity: 0.6, transform: [{ scaleX: 0.8 }] },
  '100%': { opacity: 1, transform: [{ scaleX: 1 }] },
};
const loop = { animationDuration: '3600ms', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' } as const;

export function Mascot({ height = 176 }: { height?: number }) {
  const reduceMotion = useContext(SystemReduceMotionContext);
  const haptics = useHaptics();
  const hop = useSharedValue(0);
  const squash = useSharedValue(1);
  const body = useAnimatedStyle(() => ({ transform: [{ translateY: hop.get() }, { scaleY: squash.get() }, { scaleX: 2 - squash.get() }] }));
  const shadow = useAnimatedStyle(() => ({ transform: [{ scaleX: 1 + hop.get() / 60 }], opacity: 1 + hop.get() / 45 }));
  return <Animated.View entering={reduceMotion ? FadeIn.duration(duration.state) : ZoomIn.springify().duration(spring.ui.duration * 2).dampingRatio(0.8)} style={styles.stage}>
    <Pressable accessible={false} hitSlop={12}
      onPressIn={() => { if (!reduceMotion) squash.set(withTiming(0.94, { duration: duration.press, easing: ease.out })); }}
      onPressOut={() => { if (!reduceMotion) squash.set(withSpring(1, { duration: 400, dampingRatio: 0.5 })); }}
      onPress={() => {
        haptics.tap();
        if (!reduceMotion) hop.set(withSequence(withTiming(-28, { duration: 180, easing: ease.out }), withSpring(0, { duration: 500, dampingRatio: 0.55 })));
      }}>
      <Animated.View style={[{ transformOrigin: 'bottom' }, body]}>
        <Animated.View style={reduceMotion ? null : { animationName: FLOAT, ...loop }}>
          <Logo variant="mark" height={height} />
        </Animated.View>
      </Animated.View>
    </Pressable>
    <Animated.View style={shadow}>
      <Animated.View style={reduceMotion ? null : { animationName: BREATHE, ...loop }}>
        <Svg width={120} height={24}>
          <Defs>
            <RadialGradient id="ground" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor={brand.shadow} stopOpacity={0.45} />
              <Stop offset="1" stopColor={brand.shadow} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={60} cy={12} rx={60} ry={12} fill="url(#ground)" />
        </Svg>
      </Animated.View>
    </Animated.View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', gap: 2 },
});
