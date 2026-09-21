import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { colors } from '@/theme';

export function PreviewStack({ name, title, children }: { name: string; title: string; children?: ReactNode }) {
  return <Stack screenOptions={{ headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, headerTintColor: colors.ink, headerShadowVisible: false, headerLargeTitle: false, headerTitle: '', headerLargeTitleShadowVisible: false, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: colors.canvas } }}>
    <Stack.Screen name={name} options={{ title }} />
    {children}
  </Stack>;
}
