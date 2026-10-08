import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { useAccess } from '@/features/access/use-access';
import { Pressable, StyleSheet, View, type AccessibilityState } from 'react-native';
import { AppText } from '@/components/ui';
import { colors, corner, radius } from '@/theme';

// inset: where separators start. 16 for text-only rows; rows with a leading tile pass the text's x so icons stand in their own column.
export function Group({ children, inset = 16 }: { children: ReactNode; inset?: number }) {
  const rows = Children.toArray(children).filter(Boolean);
  return <View style={styles.group}>{rows.map((row, index) => <Fragment key={isValidElement(row) && row.key != null ? row.key : index}>{index > 0 && <View style={[styles.separator, { marginLeft: inset }]} />}{row}</Fragment>)}</View>;
}

export function Row({ leading, title, detail, trailing, onPress, accessibilityLabel, accessibilityState }: { leading?: ReactNode; title: ReactNode; detail?: ReactNode; trailing?: ReactNode; onPress?: () => void; accessibilityLabel?: string; accessibilityState?: AccessibilityState }) {
  const { largeTargets } = useAccess();
  const body = <>
    {leading}
    <View style={[styles.grow, { gap: 2 }]}>{typeof title === 'string' ? <AppText variant="button" lineBreakStrategyIOS="standard">{title}</AppText> : title}{typeof detail === 'string' ? <AppText variant="small" lineBreakStrategyIOS="standard" style={{ color: colors.muted }}>{detail}</AppText> : detail}</View>
    {trailing}
  </>;
  return onPress
    ? <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={accessibilityState} onPress={onPress} style={({ pressed }) => [styles.row, largeTargets && { minHeight: 76 }, pressed && { backgroundColor: colors.selected }]}>{body}</Pressable>
    : <View accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel} style={[styles.row, largeTargets && { minHeight: 76 }]}>{body}</View>;
}

const ELEVATION = '0 1px 2px rgba(11, 31, 82, 0.06), 0 2px 8px rgba(11, 31, 82, 0.05)';

const styles = StyleSheet.create({
  group: { ...corner(radius.lg), overflow: 'hidden', backgroundColor: colors.surface, boxShadow: ELEVATION },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 12, paddingHorizontal: 16 },
  grow: { flex: 1 },
});
