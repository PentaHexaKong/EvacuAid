import '../../global.css';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, View } from 'react-native';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import * as SplashScreen from 'expo-splash-screen';
import { PreferencesProvider, usePreferences } from '@/features/preferences/context';
import { SetupScreen } from '@/screens/setup';
import { StatusBar } from 'expo-status-bar';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { HeroUINativeProvider } from 'heroui-native/provider';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Uniwind } from 'uniwind';
import { i18n, localizationReady } from '@/localization';
import { colors, FontReadyContext } from '@/theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});
Uniwind.setTheme('light');

function FirstRunGate() {
  const { ready, preferences } = usePreferences();
  useEffect(() => { if (ready) void SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />;
  return preferences.completed ? <Navigation /> : <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}><SetupScreen /></SafeAreaView>;
}
function Navigation() {
  const { t } = useTranslation();
  return <NativeTabs tintColor={colors.primary} disableTransparentOnScrollEdge minimizeBehavior="never">
    <NativeTabs.Trigger name="(overview)">
      <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      <NativeTabs.Trigger.Label>{t('overview')}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="(map)">
      <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} md="map" />
      <NativeTabs.Trigger.Label>{t('map')}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="(components)">
      <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} md="dashboard" />
      <NativeTabs.Trigger.Label>{t('components')}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
  </NativeTabs>;
}
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold });
  const [ready, setReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let mounted = true;
    localizationReady.then(() => { if (mounted) setReady(true); });
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><StatusBar style="dark" />
    {(!ready || (!fontsLoaded && !fontError)) ? <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View> :
    <FontReadyContext.Provider value={fontsLoaded}><I18nextProvider i18n={i18n}><HeroUINativeProvider config={{ animation: reduceMotion ? 'disable-all' : undefined, textProps: { allowFontScaling: true, maxFontSizeMultiplier: 0 }, textInputProps: { allowFontScaling: true, maxFontSizeMultiplier: 0 }, devInfo: { stylingPrinciples: false } }}><PreferencesProvider><FirstRunGate /></PreferencesProvider></HeroUINativeProvider></I18nextProvider></FontReadyContext.Provider>}
  </SafeAreaProvider></GestureHandlerRootView>;
}
