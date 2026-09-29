import { useEffect, useRef, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Input } from 'heroui-native/input';
import { ActionButton, AppText, Page } from '@/components/ui';
import { ContentRow } from '@/components/content';
import { useProfile, type AccessibilityType } from '@/features/profile/context';
import { usePreferences } from '@/features/preferences/context';
import { useGuestSession } from '@/features/profile/session';
import { colors, useTypography } from '@/theme';

const accessibilityTypes: AccessibilityType[] = ['VISUAL_IMPAIRMENT', 'HEARING_IMPAIRMENT', 'MOBILITY_LIMITATION', 'ELDERLY', 'OTHER'];

export function ProfileScreen() {
  const { t } = useTranslation();
  const { profile, name, ready, error, retry, saveLocation, deleteLocation, saveProfile } = useProfile();
  const { resetOnboarding, error: preferencesError, retry: retryPreferences } = usePreferences();
  const session = useGuestSession();
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const label = name || t('profileFallback');
  const initials = label.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const observedAt = profile?.location_observed_at ? new Date(profile.location_observed_at) : null;
  const locationFresh = observedAt !== null && now - observedAt.getTime() < 15 * 60_000;

  const saveDeviceLocation = async () => {
    if (busy) return;
    setBusy(true);
    let position: Location.LocationObject;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('permission');
      position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    } catch (cause) {
      setBusy(false);
      Alert.alert(t('locationSaveErrorTitle'), cause instanceof Error && cause.message === 'permission' ? t('locationPermissionDenied') : t('locationRetrieveError'));
      return;
    }
    Alert.alert(t('locationConsentTitle'), t('locationConsentBody', {
      latitude: position.coords.latitude.toFixed(5), longitude: position.coords.longitude.toFixed(5),
    }), [
      { text: t('cancel'), style: 'cancel', onPress: () => setBusy(false) },
      { text: t('uploadLocation'), onPress: () => void (async () => {
        try {
          await saveLocation(position.coords.latitude, position.coords.longitude, position.coords.accuracy, new Date(position.timestamp).toISOString());
          Alert.alert(t('locationSavedTitle'), t('locationSavedBody'));
        } catch { Alert.alert(t('locationSaveErrorTitle'), t('locationUploadError')); }
        finally { setBusy(false); }
      })() },
    ], { cancelable: false });
  };

  const removeProfile = () => Alert.alert(t('deleteProfile'), t('deleteProfileBody'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('deleteProfile'), style: 'destructive', onPress: () => void (async () => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      try {
        await session.deleteGuest();
        await resetOnboarding();
      } catch { Alert.alert(t('deleteProfileError')); }
      finally { pending.current = false; setBusy(false); }
    })() },
  ]);

  if (!ready) return <Page>
    <AppText>{error ?? t('profileLoading')}</AppText>
    {error && <ActionButton label={t('retry')} onPress={() => void retry().catch(() => {})} />}
  </Page>;

  return <Page>
    <View style={{ alignItems: 'center', gap: 12 }}>
      <View accessible={false} style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }}><AppText variant="title" style={{ color: colors.primary }}>{initials}</AppText></View>
      <AppText variant="title" accessibilityRole="header">{label}</AppText>
      <AppText style={{ color: colors.muted }}>{t('savedToServer')}</AppText>
    </View>
    <View style={{ gap: 12 }}>
      <ContentRow title={t('editProfile')} detail={t('profileDetails')} onPress={() => router.push('/profile/name')} />
      <ContentRow title={t('supportSettings')} detail={t('supportTitle')} onPress={() => router.push('/profile/settings')} />
      <ContentRow title={t('language')} detail={t('languageChoices')} onPress={() => router.push('/profile/settings')} />
      <ContentRow title={t('buddyContacts')} detail={t('trustedContacts')} onPress={() => router.dismissTo('/buddy')} />
    </View>
    <View style={{ gap: 10 }}>
      <AppText variant="section" accessibilityRole="header">{t('savedLocation')}</AppText>
      <AppText style={{ color: colors.muted }}>{observedAt ? t(locationFresh ? 'locationCurrent' : 'locationStale', { time: observedAt.toLocaleString() }) : t('locationMissing')}</AppText>
      {profile?.location_accuracy_m != null && <AppText variant="small" style={{ color: colors.muted }}>{t('locationAccuracy', { meters: Math.round(profile.location_accuracy_m) })}</AppText>}
      <ActionButton label={t('saveLocation')} loading={busy} onPress={() => void saveDeviceLocation()} />
      {observedAt && <ActionButton variant="secondary" label={t('removeLocation')} disabled={busy} onPress={() => void deleteLocation().catch(() => Alert.alert(t('profileSaveError')))} />}
      {observedAt && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <AppText style={{ flex: 1 }}>{t('shareLocationWithBuddies')}</AppText>
        <Switch accessibilityLabel={t('shareLocationWithBuddies')} value={profile?.share_location_with_buddies ?? false} disabled={busy} onValueChange={value => void saveProfile({ share_location_with_buddies: value }).catch(() => Alert.alert(t('profileSaveError')))} />
      </View>}
      <AppText variant="small" style={{ color: colors.muted }}>{t('locationSharingNote')}</AppText>
    </View>
    {preferencesError && <View style={{ gap: 8 }}><AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('preferencesSyncError')}</AppText><ActionButton variant="secondary" label={t('retry')} onPress={() => void retryPreferences()} /></View>}
    <ActionButton variant="secondary" label={t('resetSetup')} disabled={busy} onPress={() => void resetOnboarding().then(() => router.replace('/')).catch(() => Alert.alert(t('profileSaveError')))} />
    <ActionButton variant="secondary" label={t('deleteProfile')} loading={busy} onPress={removeProfile} />
    <AppText variant="small" style={{ color: colors.muted }}>{t('guestSessionNote')}</AppText>
  </Page>;
}

export function EditNameScreen() {
  const { ready, error, retry } = useProfile();
  const { t } = useTranslation();
  return ready ? <ProfileForm /> : <Page>
    <AppText>{error ?? t('profileLoading')}</AppText>
    {error && <ActionButton label={t('retry')} onPress={() => void retry().catch(() => {})} />}
  </Page>;
}

function ProfileForm() {
  const { profile, accessibility, saveProfile } = useProfile();
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState(profile?.name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [needsAssistance, setNeedsAssistance] = useState(profile?.needs_assistance ?? false);
  const [selected, setSelected] = useState<AccessibilityType[]>(accessibility.map(item => item.type));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const typography = useTypography('body');
  const { preferences } = usePreferences();
  const save = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(false);
    try {
      await saveProfile({
        name: name.replace(/[\r\n]+/g, ' ').trim().slice(0, 60) || null,
        phone: phone.trim().slice(0, 32) || null,
        needs_assistance: needsAssistance,
        accessibility: selected.map(type => ({ type, severity: null })),
      });
      router.back();
    } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Page keyboard>
    <AppText variant="title" accessibilityRole="header">{t('editProfile')}</AppText>
    <AppText>{t('profileDetails')}</AppText>
    <Input accessibilityLabel={t('profileNameLabel')} value={name} onChangeText={setName} maxLength={60} editable={!busy} autoCapitalize="words" placeholder={t('profileNameLabel')} style={[typography, { minHeight: 52, height: 'auto', backgroundColor: colors.surface, padding: 16 }, preferences.largerText && { fontSize: 19.2, lineHeight: 28.8 }]} />
    <Input accessibilityLabel={t('phoneNumber')} value={phone} onChangeText={setPhone} maxLength={32} editable={!busy} keyboardType="phone-pad" placeholder={t('phoneNumber')} style={[typography, { minHeight: 52, height: 'auto', backgroundColor: colors.surface, padding: 16 }, preferences.largerText && { fontSize: 19.2, lineHeight: 28.8 }]} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><AppText style={{ flex: 1 }}>{t('needsAssistance')}</AppText><Switch accessibilityLabel={t('needsAssistance')} value={needsAssistance} disabled={busy} onValueChange={setNeedsAssistance} /></View>
    <AppText variant="section" accessibilityRole="header">{t('accessibilityNeeds')}</AppText>
    {accessibilityTypes.map(type => <View key={type} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <AppText style={{ flex: 1 }}>{t(`accessibility_${type}`)}</AppText>
      <Switch accessibilityLabel={t(`accessibility_${type}`)} value={selected.includes(type)} disabled={busy} onValueChange={checked => setSelected(current => checked ? [...current, type] : current.filter(item => item !== type))} />
    </View>)}
    {error && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('profileSaveError')}</AppText>}
    <ActionButton label={t('saveProfile')} loading={busy} onPress={() => void save()} />
    <ActionButton variant="secondary" label={t('cancel')} disabled={busy} onPress={() => router.back()} />
  </Page>;
}
