import { createContext } from 'react';
import { Platform, type TextStyle } from 'react-native';
import tokens from './tokens.json';

export const { colors, spacing, radius, sky, brand, hazard } = tokens;
export type AlertLevel = keyof typeof sky;
// Rounding system (2026-10-02): xs 8 · sm 14 · md 20 · lg 24 · xl 32 · pill.
// Nested corners: inner radius = outer radius - inset, never below 12. Circles use radius.pill without corner().
// corner() adds iOS continuous ("squircle") curves so large radii read soft rather than clipped.
export const corner = (value: number) => ({ borderRadius: value, borderCurve: 'continuous' as const });
export const SystemReduceMotionContext = createContext(true);
export type TextVariant = 'body' | 'small' | 'button' | 'section' | 'title' | 'eyebrow' | 'statement' | 'question' | 'lead' | 'status' | 'figure';
// Ducat-style scale (2026-10-02): SF Pro, semibold as the heaviest weight, tighter display sizes, regular-weight secondary text.
const typeStyles: Record<TextVariant, TextStyle> = {
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  button: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  section: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  title: { fontSize: 26, lineHeight: 30, letterSpacing: -0.3, fontWeight: '600' },
  eyebrow: { fontSize: 13, lineHeight: 18, letterSpacing: 0.2, fontWeight: '500' },
  statement: { fontSize: 30, lineHeight: 34, letterSpacing: -0.5, fontWeight: '600' },
  question: { fontSize: 26, lineHeight: 30, letterSpacing: -0.3, fontWeight: '600' },
  lead: { fontSize: 16, lineHeight: 22, fontWeight: '400', color: tokens.colors.muted },
  status: { fontSize: 52, lineHeight: 56, letterSpacing: -1.2, fontWeight: '600' },
  figure: { fontSize: 34, lineHeight: 38, letterSpacing: -0.6, fontWeight: '600', fontVariant: ['tabular-nums'] },
};
export function useTypography(variant: TextVariant = 'body'): TextStyle {
  return { color: colors.ink, fontFamily: Platform.select({ android: 'Inter', default: 'System' }), ...typeStyles[variant] };
}
