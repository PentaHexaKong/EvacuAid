import { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import '@/features/location/alert-area';
import { registerPushToken } from '@/features/location/push-token';
import { ProfileProvider, useProfile } from '@/features/profile/context';
import * as SplashScreen from 'expo-splash-screen';
import { PreferencesProvider, usePreferences } from '@/features/preferences/context';
import { SetupScreen, type ReachPermissions } from '@/screens/setup';
import { pageHeaderLayout } from '@/components/page-scroll-view';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { i18n, localizationReady } from '@/localization';
import { colors, SystemReduceMotionContext } from '@/theme';
import { GuestSessionProvider, useGuestSession } from '@/features/profile/session';
import { AlertGate, markAlertPresented } from '@/features/alerts/alert-gate';
import { AuthScreen } from '@/screens/auth';
import { ActionButton, AppText, Page } from '@/components/ui';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = { initialRouteName: '(tabs)', anchor: '(tabs)' };

function FirstRunGate() {
  const { ready, preferences } = usePreferences();
  const session = useGuestSession();
  const profile = useProfile();
  const [reach, setReach] = useState<ReachPermissions>({});
  const router = useRouter();
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [buddyTarget, setBuddyTarget] = useState<string | null>(null);
  // Someone who just came through the entry screen has seen the welcome; setup starts at the first real question.
  const [entered, setEntered] = useState(false);
  if (session.status === 'signed-out' && !entered) setEntered(true);
  useEffect(() => {
    if (session.status === 'idle') void session.ensureGuest().catch(() => {});
  }, [reach, session.status, session.ensureGuest]);
  useEffect(() => {
    if (!reach.notifications || !session.token) return;
    setReach(value => ({ ...value, notifications: false }));
    void registerPushToken(session.token).catch(() => {});
  }, [reach.notifications, session.token]);
  useEffect(() => {
    if (!reach.location || !profile.ready) return;
    const fix = reach.location;
    setReach(value => ({ ...value, location: undefined }));
    void profile.saveLocation(fix.coords.latitude, fix.coords.longitude, fix.coords.accuracy, new Date(fix.timestamp).toISOString()).catch(() => {});
  }, [reach.location, profile.ready, profile.saveLocation]);
  useEffect(() => {
    const notification = (value: Notifications.NotificationResponse | null) => {
      const data = value?.notification.request.content.data;
      const id = data?.requestId;
      if (typeof data?.alertId === 'string') { markAlertPresented(data.alertId); setBuddyTarget(`/emergency/${encodeURIComponent(data.alertId)}`); }
      else if (typeof id === 'string') setBuddyTarget(`/buddy?requestId=${encodeURIComponent(id)}`);
      else if (typeof data?.inboxId === 'string' || typeof data?.invitationId === 'string') setBuddyTarget('/buddy');
    };
    const link = (url: string) => {
      const parsed = Linking.parse(url);
      const code = parsed.queryParams?.code;
      if ((parsed.path === 'buddy-invite' || parsed.hostname === 'buddy-invite') && typeof code === 'string') setBuddyTarget(`/buddy-invite?code=${encodeURIComponent(code)}`);
    };
    const response = Notifications.addNotificationResponseReceivedListener(notification);
    const links = Linking.addEventListener('url', value => link(value.url));
    void Notifications.getLastNotificationResponseAsync().then(notification).catch(() => {});
    void Linking.getInitialURL().then(url => { if (url) link(url); }).catch(() => {});
    return () => { response.remove(); links.remove(); };
  }, []);
  useEffect(() => {
    if (preferences.completed && session.status === 'idle') void session.ensureGuest().catch(() => {});
  }, [preferences.completed, session.status, session.ensureGuest]);
  useEffect(() => {
    if (preferences.completed && session.status === 'ready' && (buddyTarget || returnTo)) {
      router.replace((buddyTarget || returnTo) as '/');
      void Promise.resolve().then(() => { setBuddyTarget(null); setReturnTo(null); });
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    }
  }, [preferences.completed, buddyTarget, returnTo, session.status, router]);
  useEffect(() => { if (ready) void SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />;
  if (session.status === 'signed-out') return <AuthScreen />;
  if (session.status !== 'ready') {
    if (session.status === 'error') return <GuestSessionError />;
    return <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
  }
  return preferences.completed ? <Navigation /> : <SetupScreen start={entered ? 'help' : 'welcome'} onReach={permissions => setReach(value => ({ ...value, ...permissions }))} onDone={target => setReturnTo(target ?? '/')} />;
}

function GuestSessionError() {
  const { t } = useTranslation();
  const session = useGuestSession();
  return <Page>
    <AppText variant="title" accessibilityRole="header">{t('sessionUnavailable')}</AppText>
    <AppText accessibilityRole="alert">{session.errorKind === 'network' ? t('apiNetworkUnavailable') : session.error}</AppText>
    <ActionButton label={t('retry')} loading={session.status === 'loading'} onPress={() => void session.ensureGuest().catch(() => {})} />

  </Page>;
}
function Navigation() {
  const { t } = useTranslation();
  return <><AlertGate /><Stack screenLayout={pageHeaderLayout} screenOptions={{ headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, headerTintColor: colors.ink, headerShadowVisible: false, headerTitle: '', headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: colors.canvas } }}>
    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    <Stack.Screen name="evacuate" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }} />
    <Stack.Screen name="emergency/[id]" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false, animation: 'slide_from_bottom' }} />
    <Stack.Screen name="help-request/[id]" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false, animation: 'slide_from_bottom' }} />
    <Stack.Screen name="alert/[id]" options={{ title: t('alertDetailTitle') }} />
    <Stack.Screen name="hazard/[id]" options={{ title: t('hazardDetailTitle') }} />
    <Stack.Screen name="destinations/index" options={{ headerShown: false }} />
    <Stack.Screen name="destinations/[id]" options={{ headerShown: false }} />
    {(['alerts', 'profile'] as const).map(name => <Stack.Screen key={name} name={name} dangerouslySingular options={{ headerShown: false, presentation: Platform.OS === 'ios' ? 'formSheet' : 'modal', sheetGrabberVisible: true, sheetAllowedDetents: [1], sheetInitialDetentIndex: 0, sheetExpandsWhenScrolledToEdge: true, gestureEnabled: true }} />)}
    <Stack.Screen name="buddy-add" options={{ headerShown: false, presentation: Platform.OS === 'ios' ? 'formSheet' : 'modal', sheetGrabberVisible: true, sheetAllowedDetents: 'fitToContents', gestureEnabled: true, contentStyle: { backgroundColor: colors.surface } }} />
    <Stack.Screen name="settings" options={{ headerShown: false, animation: 'none' }} />
    <Stack.Protected guard={__DEV__}><Stack.Screen name="preview" options={{ title: t('developerPreviews') }} />
    <Stack.Screen name="(map)" options={{ headerShown: false }} />
    <Stack.Screen name="(components)" options={{ headerShown: false }} /></Stack.Protected>
  </Stack></>;
}
export default function RootLayout() {
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
    {!ready ? <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View> :
    <SystemReduceMotionContext.Provider value={reduceMotion}><I18nextProvider i18n={i18n}><GuestSessionProvider><PreferencesProvider><ProfileProvider><FirstRunGate /></ProfileProvider></PreferencesProvider></GuestSessionProvider></I18nextProvider></SystemReduceMotionContext.Provider>}
  </SafeAreaProvider></GestureHandlerRootView>;
}
