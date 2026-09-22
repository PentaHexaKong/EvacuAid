import '../../global.css';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ProfileProvider } from '@/features/profile/context';
import { RequestDraftProvider } from '@/features/requests/draft';
import * as SplashScreen from 'expo-splash-screen';
import { PreferencesProvider, usePreferences } from '@/features/preferences/context';
import { AuthProvider, useAuth } from '@/features/auth/context';
import { SetupScreen } from '@/screens/setup';
import { pageHeaderLayout } from '@/components/page-scroll-view';
import { StatusBar } from 'expo-status-bar';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { HeroUINativeProvider } from 'heroui-native/provider';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Uniwind } from 'uniwind';
import { i18n, localizationReady } from '@/localization';
import { colors, FontReadyContext, SystemReduceMotionContext } from '@/theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});
Uniwind.setTheme('light');

export const unstable_settings = { initialRouteName: 'auth/register', anchor: '(tabs)' };

function FirstRunGate() {
  const { ready, session, profile } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  useEffect(() => { if (ready) void SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  useEffect(() => {
    if (!ready) return;
    const authRoute = segments[0] === 'auth' || segments[0] === 'reset-password';
    if (!session && !authRoute) { router.replace('/auth/register'); return; }
    if (session && profile && !profile.preferences.onboardingCompleted && segments[0] !== 'setup') { router.replace('/setup'); return; }
    if (session && profile?.preferences.onboardingCompleted && (authRoute || segments[0] === 'setup')) router.replace('/(tabs)');
  }, [profile, ready, router, segments, session]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />;
  return <Navigation />;
}
function Navigation() {
  const { t } = useTranslation();
  return <RequestDraftProvider><Stack screenLayout={pageHeaderLayout} screenOptions={{ headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, headerTintColor: colors.ink, headerShadowVisible: false, headerTitle: '', headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: colors.canvas } }}>
    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    <Stack.Screen name="alert/[id]" options={{ title: t('alertDetailTitle') }} />
    <Stack.Screen name="contact/[id]" options={{ title: t('contactTitle') }} />
    <Stack.Screen name="destinations/index" options={{ title: t('destinationsTitle') }} />
    <Stack.Screen name="destinations/[id]" options={{ title: t('destinationTitle') }} />
    <Stack.Screen name="request/index" options={{ title: t('requestHelp') }} />
    <Stack.Screen name="request/review" options={{ title: t('reviewRequest') }} />
    {(['alerts', 'profile'] as const).map(name => <Stack.Screen key={name} name={name} dangerouslySingular options={{ headerShown: false, presentation: Platform.OS === 'ios' ? 'formSheet' : 'modal', sheetGrabberVisible: false, sheetAllowedDetents: [1], sheetInitialDetentIndex: 0, sheetExpandsWhenScrolledToEdge: true, gestureEnabled: true }} />)}
    <Stack.Screen name="settings" options={{ headerShown: false, animation: 'none' }} />
    <Stack.Screen name="setup" options={{ headerShown: false }} />
    <Stack.Screen name="auth/register" options={{ headerShown: false }} />
    <Stack.Screen name="auth/login" options={{ headerShown: false }} />
    <Stack.Screen name="auth/forgot-password" options={{ headerShown: false }} />
    <Stack.Screen name="auth/reset-password" options={{ headerShown: false }} />
    <Stack.Screen name="reset-password" options={{ headerShown: false }} />
    <Stack.Protected guard={__DEV__}><Stack.Screen name="preview" options={{ title: t('developerPreviews') }} />
    <Stack.Screen name="route-simulation" options={{ title: t('routeSimulation') }} />
    <Stack.Screen name="(map)" options={{ headerShown: false }} />
    <Stack.Screen name="(components)" options={{ headerShown: false }} /></Stack.Protected>
  </Stack></RequestDraftProvider>;
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
    <SystemReduceMotionContext.Provider value={reduceMotion}><FontReadyContext.Provider value={fontsLoaded}><I18nextProvider i18n={i18n}><HeroUINativeProvider config={{ animation: reduceMotion ? 'disable-all' : undefined, textProps: { allowFontScaling: true, maxFontSizeMultiplier: 0 }, textInputProps: { allowFontScaling: true, maxFontSizeMultiplier: 0 }, devInfo: { stylingPrinciples: false } }}><AuthProvider><PreferencesProvider><ProfileProvider><FirstRunGate /></ProfileProvider></PreferencesProvider></AuthProvider></HeroUINativeProvider></I18nextProvider></FontReadyContext.Provider></SystemReduceMotionContext.Provider>}
  </SafeAreaProvider></GestureHandlerRootView>;
}
