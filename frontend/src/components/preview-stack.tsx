import { Stack } from 'expo-router';
import { colors, useTypography } from '@/theme';

export function PreviewStack({ name, title }: { name: string; title: string }) {
  const titleStyle = useTypography('button');
  return <Stack screenOptions={{ headerStyle: { backgroundColor: colors.canvas }, headerTintColor: colors.ink, headerShadowVisible: false, headerTitleStyle: titleStyle, contentStyle: { backgroundColor: colors.canvas } }}>
    <Stack.Screen name={name} options={{ title }} />
  </Stack>;
}
