import { createContext } from 'react';
import { Platform, type TextStyle } from 'react-native';
import tokens from './tokens.json';

export const { colors, spacing, radius, sky } = tokens;
export type AlertLevel = keyof typeof sky;
export const SystemReduceMotionContext = createContext(true);
export type TextVariant = 'body' | 'small' | 'button' | 'section' | 'title' | 'eyebrow' | 'statement' | 'question' | 'lead' | 'status' | 'figure';
const typeStyles: Record<TextVariant, TextStyle> = {
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  small: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  button: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  section: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  title: { fontSize: 28, lineHeight: 36, fontWeight: '700' },
  eyebrow: { fontSize: 12, lineHeight: 18, letterSpacing: 1.2, fontWeight: '500' },
  statement: { fontSize: 34, lineHeight: 40, letterSpacing: -0.7, fontWeight: '700' },
  question: { fontSize: 30, lineHeight: 36, letterSpacing: -0.5, fontWeight: '600' },
  lead: { fontSize: 18, lineHeight: 26, fontWeight: '500', color: tokens.colors.muted },
  status: { fontSize: 60, lineHeight: 64, letterSpacing: -1.8, fontWeight: '700' },
  figure: { fontSize: 40, lineHeight: 44, letterSpacing: -1, fontWeight: '800', fontVariant: ['tabular-nums'] },
};
export function useTypography(variant: TextVariant = 'body'): TextStyle {
  return { color: colors.ink, fontFamily: Platform.select({ android: 'Inter', default: 'System' }), ...typeStyles[variant] };
}
