import { createContext, useContext } from 'react';
import { Platform, type TextStyle } from 'react-native';
import tokens from './tokens.json';

export const { colors, spacing, radius } = tokens;
export const FontReadyContext = createContext(false);
export const SystemReduceMotionContext = createContext(true);
export type TextVariant = 'body' | 'small' | 'button' | 'section' | 'title' | 'eyebrow';
const typeStyles: Record<TextVariant, TextStyle> = {
  body: { fontSize: 16, lineHeight: 24 }, small: { fontSize: 14, lineHeight: 20 },
  button: { fontSize: 16, lineHeight: 24 }, section: { fontSize: 20, lineHeight: 28 },
  title: { fontSize: 28, lineHeight: 36 }, eyebrow: { fontSize: 12, lineHeight: 18, letterSpacing: 1.2 },
};
export function useTypography(variant: TextVariant = 'body'): TextStyle {
  const loaded = useContext(FontReadyContext);
  const weight = variant === 'title' ? '700Bold' : ['section', 'button'].includes(variant) ? '600SemiBold' : variant === 'eyebrow' ? '500Medium' : '400Regular';
  return { ...typeStyles[variant], color: colors.ink, fontFamily: loaded ? `PlusJakartaSans_${weight}` : Platform.select({ ios: 'System', android: 'sans-serif' }), fontWeight: loaded ? undefined : variant === 'title' ? '700' : ['section', 'button'].includes(variant) ? '600' : '400' };
}
