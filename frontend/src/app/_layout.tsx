import '../../global.css';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HeroUINativeProvider } from 'heroui-native/provider';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Uniwind } from 'uniwind';
import { i18n, localizationReady } from '@/localization';
import { colors, FontReadyContext, useTypography } from '@/theme';

Uniwind.setTheme('light');

function Navigation() {
  const { t } = useTranslation();
  const titleStyle = useTypography('button');
  return <Stack screenOptions={{ headerStyle: { backgroundColor: colors.canvas }, headerTintColor: colors.ink, headerShadowVisible: false, headerTitleStyle: titleStyle, contentStyle: { backgroundColor: colors.canvas }, headerBackTitle: t('back') }}>
    <Stack.Screen name="index" options={{ title: 'EvacuAid' }} />
    <Stack.Screen name="components" options={{ title: t('components') }} />
    <Stack.Screen name="buddy-map" options={{ title: t('map') }} />
  </Stack>;
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
    <FontReadyContext.Provider value={fontsLoaded}><I18nextProvider i18n={i18n}><HeroUINativeProvider config={{ animation: reduceMotion ? 'disable-all' : undefined, textProps: { allowFontScaling: true, maxFontSizeMultiplier: 0 }, textInputProps: { allowFontScaling: true, maxFontSizeMultiplier: 0 }, devInfo: { stylingPrinciples: false } }}><Navigation /></HeroUINativeProvider></I18nextProvider></FontReadyContext.Provider>}
  </SafeAreaProvider></GestureHandlerRootView>;
}
