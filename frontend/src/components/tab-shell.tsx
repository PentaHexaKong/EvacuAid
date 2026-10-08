import { createContext, useContext, useRef, type ReactElement, type ReactNode } from 'react';
import { ScrollView, View, type ScrollViewProps } from 'react-native';
import { Stack } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import type { NativeStackNavigationOptions } from 'expo-router/native-stack';
import { colors, gutter } from '@/theme';

type SetOptions = (options: NativeStackNavigationOptions) => void;
export const TabBarContext = createContext<SetOptions | null>(null);

// The native bar's own left edge sits this far in; TabHeader pads the rest of the way to the page gutter.
const BAR_INSET = 16;
const SCROLLED_AFTER = 4;

// Defined once at module scope: an inline layout would remount the screen, and reset its scroll, every time the bar changes.
function tabLayout({ children, navigation }: { children: ReactElement; navigation: { setOptions: SetOptions } }) {
  return <TabBarContext.Provider value={navigation.setOptions}>{children}</TabBarContext.Provider>;
}

// Every tab with a navigation bar shares this stack, so the bar, its border and its scroll behavior cannot drift between tabs.
export function TabStack({ name }: { name: string }) {
  return <Stack screenLayout={tabLayout} screenOptions={{ headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, headerTintColor: colors.ink, headerShadowVisible: false, title: '', scrollEdgeEffects: { top: 'soft' }, contentStyle: { backgroundColor: colors.canvas } }}><Stack.Screen name={name} /></Stack>;
}

export function TabHeader({ children }: { children: ReactNode }) {
  return <Stack.Toolbar placement="left"><Stack.Toolbar.View hidesSharedBackground><View style={{ paddingLeft: gutter - BAR_INSET }}>{children}</View></Stack.Toolbar.View></Stack.Toolbar>;
}

// The bar is clear at the top of the page and turns into the frosted, bordered bar once content scrolls under it.
export function TabScrollView({ onScroll, ...props }: ScrollViewProps) {
  const setOptions = useContext(TabBarContext);
  const headerHeight = useHeaderHeight();
  const scrolled = useRef(false);
  return <ScrollView contentInsetAdjustmentBehavior="automatic" {...props} scrollEventThrottle={16} onScroll={event => {
    const next = event.nativeEvent.contentOffset.y + headerHeight > SCROLLED_AFTER;
    if (next !== scrolled.current) {
      scrolled.current = next;
      setOptions?.({ scrollEdgeEffects: { top: next ? 'hard' : 'soft' } });
    }
    onScroll?.(event);
  }} />;
}
