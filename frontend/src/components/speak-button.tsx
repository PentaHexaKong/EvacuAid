import { useContext, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import IconMicrophone from '@tabler/icons-react-native/IconMicrophone';
import { AppText } from '@/components/ui';
import { usePressScale } from '@/components/press';
import { colors, radius, SystemReduceMotionContext } from '@/theme';
import { ease } from '@/theme/motion';

// The voice-first Home's one big action. Listening is carried by the label and the Night Navy fill;
// the breathing mic only adds to that, and stays still with Reduce Motion.
export function SpeakButton({ listening, label, detail, hint, onPress }: { listening: boolean; label: string; detail: string; hint: string; onPress: () => void }) {
  const press = usePressScale(0.96);
  const reduceMotion = useContext(SystemReduceMotionContext);
  const breath = useSharedValue(1);
  useEffect(() => {
    if (listening && !reduceMotion) breath.value = withRepeat(withTiming(0.45, { duration: 900, easing: ease.out }), -1, true);
    else { cancelAnimation(breath); breath.value = withTiming(1, { duration: 150 }); }
  }, [listening, reduceMotion, breath]);
  const mic = useAnimatedStyle(() => ({ opacity: breath.value }));
  return <Pressable {...press.handlers} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ busy: listening }} onPress={onPress}>
    <Animated.View style={[styles.button, { backgroundColor: listening || press.pressed ? colors.ink : colors.primary }, press.style]}>
      <View style={styles.mic}><Animated.View style={mic}><IconMicrophone size={26} strokeWidth={2} color={colors.surface} /></Animated.View></View>
      <View style={styles.text}>
        <AppText style={styles.label}>{label}</AppText>
        {!!detail && <AppText style={styles.detail}>{detail}</AppText>}
      </View>
    </Animated.View>
  </Pressable>;
}

const styles = StyleSheet.create({
  // Pill like every other button; the mic disc sits 12pt inside it, so both curves share a centre.
  button: { minHeight: 76, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, paddingRight: 24 },
  mic: { width: 52, height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  text: { flex: 1, gap: 2 },
  label: { color: colors.surface, fontSize: 20, lineHeight: 24, fontWeight: '600' },
  detail: { color: 'rgba(255,255,255,0.86)', fontSize: 15, lineHeight: 20 },
});
