import { createContext } from 'react';
import { Platform, type TextStyle } from 'react-native';
import tokens from './tokens.json';

export const { colors, spacing, radius } = tokens;
export const SystemReduceMotionContext = createContext(true);
export type TextVariant = 'body' | 'small' | 'button' | 'section' | 'title' | 'eyebrow';
const typeStyles: Record<TextVariant, TextStyle> = {
  body: { fontSize: 16, lineHeight: 24 }, small: { fontSize: 14, lineHeight: 20 },
  button: { fontSize: 16, lineHeight: 24 }, section: { fontSize: 20, lineHeight: 28 },
  title: { fontSize: 28, lineHeight: 36 }, eyebrow: { fontSize: 12, lineHeight: 18, letterSpacing: 1.2 },
};
export function useTypography(variant: TextVariant = 'body'): TextStyle {
  return { ...typeStyles[variant], color: colors.ink, fontFamily: Platform.select({ android: 'Inter', default: 'System' }), fontWeight: variant === 'title' ? '700' : ['section', 'button'].includes(variant) ? '600' : variant === 'eyebrow' ? '500' : '400' };
}
