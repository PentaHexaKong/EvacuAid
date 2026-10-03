import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { ComponentType } from 'react';
import { Button, Host, Image as SwiftImage, Menu, Picker, Text as SwiftText, VStack } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, contentShape, font, foregroundStyle, frame, glassEffect, pickerStyle, shapes, tag } from '@expo/ui/swift-ui/modifiers';
import IconDots from '@tabler/icons-react-native/IconDots';
import { AppText } from '@/components/ui';
import { colors, radius } from '@/theme';

type Option<T extends string> = { value: T; label: string };

// iOS: the system segmented control (SwiftUI Picker). Elsewhere: a token-styled two-up switcher.
export function Segmented<T extends string>({ options, value, onChange }: { options: Option<T>[]; value: T; onChange: (value: T) => void }) {
  if (Platform.OS === 'ios') return <Host matchContents={{ vertical: true }} style={{ alignSelf: 'stretch' }}>
    <Picker modifiers={[pickerStyle('segmented')]} selection={value} onSelectionChange={selection => onChange(String(selection) as T)}>
      {options.map(option => <SwiftText key={option.value} modifiers={[tag(option.value)]}>{option.label}</SwiftText>)}
    </Picker>
  </Host>;
  return <View accessibilityRole="tablist" style={styles.track}>
    {options.map(option => {
      const selected = option.value === value;
      return <Pressable key={option.value} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => onChange(option.value)} style={[styles.segment, selected && styles.segmentOn]}>
        <AppText variant="button" style={{ color: selected ? colors.ink : colors.muted }}>{option.label}</AppText>
      </Pressable>;
    })}
  </View>;
}

export type MenuItem = { label: string; onPress: () => void; destructive?: boolean };

// A ⋯ button that opens the iOS pull-down menu; Android falls back to an alert list.
export function MoreMenu({ label, items }: { label: string; items: MenuItem[] }) {
  if (Platform.OS === 'ios') return <Host matchContents>
    <Menu modifiers={[accessibilityLabel(label)]} label={<SwiftImage systemName="ellipsis.circle" modifiers={[font({ size: 26, weight: 'regular' }), foregroundStyle(colors.ink)]} />}>
      {items.map(item => <Button key={item.label} label={item.label} role={item.destructive ? 'destructive' : 'default'} onPress={item.onPress} />)}
    </Menu>
  </Host>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={styles.dots} onPress={() => Alert.alert(label, undefined, [...items.map(item => ({ text: item.label, style: item.destructive ? 'destructive' as const : 'default' as const, onPress: item.onPress })), { text: '×', style: 'cancel' as const }])}>
    <IconDots size={20} color={colors.ink} />
  </Pressable>;
}

export type MapControl = { label: string; symbol: NonNullable<Parameters<typeof SwiftImage>[0]['systemName']>; icon: ComponentType<{ size?: number; color?: string }>; onPress: () => void };

// A vertical stack of map buttons. iOS: one Liquid Glass capsule, like Maps. Elsewhere: a token-styled surface pill.
export function MapControls({ controls }: { controls: MapControl[] }) {
  if (Platform.OS === 'ios') return <Host matchContents>
    <VStack spacing={0} modifiers={[glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' })]}>
      {controls.map(control => <Button key={control.symbol} onPress={control.onPress} modifiers={[buttonStyle('plain'), accessibilityLabel(control.label)]}>
        <SwiftImage systemName={control.symbol} modifiers={[font({ size: 19, weight: 'medium' }), foregroundStyle(colors.ink), frame({ width: 48, height: 48 }), contentShape(shapes.rectangle())]} />
      </Button>)}
    </VStack>
  </Host>;
  return <View style={styles.mapStack}>
    {controls.map(control => <Pressable key={control.symbol} accessibilityRole="button" accessibilityLabel={control.label} onPress={control.onPress} style={({ pressed }) => [styles.mapButton, pressed && { backgroundColor: colors.canvas }]}>
      <control.icon size={22} color={colors.ink} />
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  mapStack: { borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surface, boxShadow: '0 2px 8px rgba(18, 40, 75, 0.16)' },
  mapButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  track: { flexDirection: 'row', padding: 3, borderRadius: radius.md, backgroundColor: colors.chip },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md - 3 },
  segmentOn: { backgroundColor: colors.surface },
  dots: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surface },
});
