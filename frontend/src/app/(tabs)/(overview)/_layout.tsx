import { Stack } from 'expo-router';
import { colors } from '@/theme';

export default function Layout() {
  return <Stack screenOptions={{ headerTransparent: true, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.ink, headerShadowVisible: false, headerTitle: '', contentStyle: { backgroundColor: colors.canvas } }}><Stack.Screen name="index" options={{ title: 'EvacuAid' }} /></Stack>;
}
