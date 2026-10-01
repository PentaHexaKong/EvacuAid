import { Image } from 'react-native';
import lockupInk from '../../assets/brand/logo-lockup-ink.png';
import lockupWhite from '../../assets/brand/logo-lockup-white.png';
import mark from '../../assets/brand/logo-mark.png';

const sources = {
  lockup: { ink: lockupInk, white: lockupWhite, ratio: 1200 / 295 },
  mark: { ink: mark, white: mark, ratio: 360 / 404 },
};

export function Logo({ variant = 'lockup', tone = 'ink', height = 28 }: { variant?: keyof typeof sources; tone?: 'ink' | 'white'; height?: number }) {
  const source = sources[variant];
  return <Image accessible accessibilityRole="image" accessibilityLabel="EvacuAid" source={source[tone]} resizeMode="contain" style={{ height, width: height * source.ratio }} />;
}
