import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import * as Location from 'expo-location';
import { ensureForeground } from '@/features/location/permissions';
import { alertAreaRunning, askAlwaysAndStart, stopAlertArea } from '@/features/location/alert-area';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { HStack, Host, Image as SwiftImage, Menu, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { accessibilityLabel, font, foregroundStyle, tag } from '@expo/ui/swift-ui/modifiers';
import IconAccessible from '@tabler/icons-react-native/IconAccessible';
import IconArrowUpRight from '@tabler/icons-react-native/IconArrowUpRight';
import IconChevronRight from '@tabler/icons-react-native/IconChevronRight';
import IconContrast from '@tabler/icons-react-native/IconContrast';
import IconDatabase from '@tabler/icons-react-native/IconDatabase';
import IconDeviceMobileVibration from '@tabler/icons-react-native/IconDeviceMobileVibration';
import IconIdBadge from '@tabler/icons-react-native/IconIdBadge';
import IconLanguage from '@tabler/icons-react-native/IconLanguage';
import IconMapPin from '@tabler/icons-react-native/IconMapPin';
import IconMapPinOff from '@tabler/icons-react-native/IconMapPinOff';
import IconRefresh from '@tabler/icons-react-native/IconRefresh';
import IconSelector from '@tabler/icons-react-native/IconSelector';
import IconTextCaption from '@tabler/icons-react-native/IconTextCaption';
import IconTextSize from '@tabler/icons-react-native/IconTextSize';
import IconLogout from '@tabler/icons-react-native/IconLogout';
import IconUser from '@tabler/icons-react-native/IconUser';
import IconUsers from '@tabler/icons-react-native/IconUsers';
import IconVolume from '@tabler/icons-react-native/IconVolume';
import IconWaveSine from '@tabler/icons-react-native/IconWaveSine';
import { ActionButton, AppText, Field, Page } from '@/components/ui';
import { useProfile, type AccessibilityType } from '@/features/profile/context';
import { usePreferences } from '@/features/preferences/context';
import type { Preferences } from '@/features/preferences/storage';
import { useGuestSession } from '@/features/profile/session';
import { relativeTime } from '@/features/hazards/time';
import { selectLanguage } from '@/localization';
import { LANGUAGES, languageName, type Language } from '@/localization/language';
import { colors, corner, radius } from '@/theme';

const GUTTER = 18;
// React Native's iOS Switch composes alignSelf: 'flex-start', which pins it to the top of a centred row.
const SWITCH_CENTER = { alignSelf: 'center' } as const;
const accessibilityTypes: AccessibilityType[] = ['VISUAL_IMPAIRMENT', 'HEARING_IMPAIRMENT', 'MOBILITY_LIMITATION', 'ELDERLY', 'OTHER'];
type Icon = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
type Toggle = keyof Pick<Preferences, 'largerText' | 'strongerContrast' | 'voiceEnabled' | 'vibrationEnabled' | 'textEnabled'>;
const TOGGLES: { key: Toggle; Icon: Icon }[] = [
  { key: 'largerText', Icon: IconTextSize },
  { key: 'strongerContrast', Icon: IconContrast },
  { key: 'voiceEnabled', Icon: IconVolume },
  { key: 'vibrationEnabled', Icon: IconDeviceMobileVibration },
  { key: 'textEnabled', Icon: IconTextCaption },
];

// Ducat-style settings sheet: ink labels on the left, the muted value on the right, rows grouped by short dividers.
export function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const { profile, name, accessibility, ready, error, retry, saveLocation, deleteLocation, saveProfile } = useProfile();
  const { preferences, save, resetOnboarding, error: preferencesError, retry: retryPreferences } = usePreferences();
  const session = useGuestSession();
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [areaRunning, setAreaRunning] = useState(false);
  useEffect(() => { void alertAreaRunning().then(setAreaRunning).catch(() => {}); }, []);
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
      const permission = await ensureForeground();
      if (permission !== 'granted') throw new Error(permission === 'blocked' ? 'blocked' : 'permission');
      position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    } catch (cause) {
      setBusy(false);
      Alert.alert(t('locationSaveErrorTitle'), cause instanceof Error && ['permission', 'blocked'].includes(cause.message) ? t('locationPermissionDenied') : t('locationRetrieveError'), cause instanceof Error && cause.message === 'blocked' ? [{ text: t('cancel'), style: 'cancel' }, { text: t('openSettings'), onPress: () => void Linking.openSettings() }] : undefined);
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

  const toggleArea = async (value: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (value) {
        if (!session.token || !profile) throw new Error('Profile is not ready');
        const permission = await askAlwaysAndStart(session.token, profile.id);
        if (permission !== 'granted') Alert.alert(t('locationSaveErrorTitle'), t('locationPermissionDenied'), permission === 'blocked' ? [{ text: t('cancel'), style: 'cancel' }, { text: t('openSettings'), onPress: () => void Linking.openSettings() }] : undefined);
      } else {
        await stopAlertArea();
        setAreaRunning(false);
        await deleteLocation();
      }
      setAreaRunning(await alertAreaRunning());
    } catch { Alert.alert(t('locationSaveErrorTitle'), t('profileSaveError')); }
    finally { setBusy(false); }
  };

  const confirmSignOut = () => Alert.alert(t('authSignOut'), t('authSignOutBody'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('authSignOut'), style: 'destructive', onPress: () => void (async () => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      try {
        await stopAlertArea();
        await session.signOut();
      } catch {
        Alert.alert(t('authTryAgain'));
      }
      finally { pending.current = false; setBusy(false); }
    })() },
  ]);

  const toggle = (key: Toggle, value: boolean) => void save({ ...preferences, [key]: value }).catch(() => Alert.alert(t('profileSaveError')));
  const changeLanguage = async (language: Language) => {
    try { await save({ ...preferences, language }); await selectLanguage(language); } catch { Alert.alert(t('languageError')); }
  };
  // iOS uses the native menu on the row; elsewhere a tap switches between the two languages.
  const pickLanguage = () => void changeLanguage(i18n.language === 'id' ? 'en' : 'id');

  if (!ready) return <Page>
    <AppText>{error ?? t('profileLoading')}</AppText>
    {error && <ActionButton label={t('retry')} onPress={() => void retry().catch(() => {})} />}
  </Page>;

  const ago = observedAt ? relativeTime(observedAt.toISOString(), now) : null;
  const agoText = ago ? t(ago.key, { count: ago.count }) : '';
  return <Page contentStyle={styles.page}>
    <View style={{ gap: 4 }}>
      <View style={styles.eyebrow}><IconUser size={16} color={colors.muted} /><AppText variant="small" style={{ color: colors.muted }}>{t('accountInfo')}</AppText></View>
      <AppText variant="title" accessibilityRole="header">{name || t('profileFallback')}</AppText>
      {session.account?.email && <AppText style={{ color: colors.muted }}>{session.account.email}</AppText>}
      {profile?.phone ? <AppText style={{ color: colors.muted }}>{profile.phone}</AppText> : null}
    </View>
    <View style={[styles.status, { marginTop: 20 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.eyebrow}>
          <View style={[styles.dot, { backgroundColor: !observedAt ? colors.borderStrong : locationFresh ? colors.primary : colors.caution }]} />
          <AppText variant="button" style={{ flexShrink: 1 }}>{t(!observedAt ? 'locationNone' : locationFresh ? 'locationShared' : 'locationStaleTitle')}</AppText>
        </View>
        <AppText variant="small" style={{ color: colors.muted }}>{!observedAt ? t('locationWhy') : t(locationFresh ? 'locationUpdated' : 'locationSavedAt', { time: agoText })}</AppText>
      </View>
      <ActionButton compact label={t(observedAt ? 'updateLocation' : 'saveLocation')} loading={busy} onPress={() => void saveDeviceLocation()} />
    </View>
    <View style={styles.dashed}><View style={styles.dashedLine} /></View>
    <View>
      {TOGGLES.map(({ key, Icon }, index) => <SettingsRow key={key} first={index === 0} Icon={Icon} label={t(key)} toggle={{ value: preferences[key], onChange: value => toggle(key, value) }} />)}
      <SettingsRow Icon={IconWaveSine} label={t('reduceMotion')} value={t('followsIphone')} accessory="external" onPress={() => void Linking.openSettings()} />
    </View>
    <View style={styles.groupDivider} />
    <View>
      <SettingsRow first Icon={IconLanguage} label={t('language')} value={languageName(i18n.language)} accessory="picker" onPress={pickLanguage} menu={{ selection: i18n.language, options: LANGUAGES, onSelect: value => void changeLanguage(value as Language) }} />
      <SettingsRow Icon={IconAccessible} label={t('supportNeeds')} value={accessibility.length ? t('needsSelected', { count: accessibility.length }) : t('needsNone')} onPress={() => router.push('/profile/name')} />
      <SettingsRow Icon={IconIdBadge} label={t('rowProfileDetails')} value={t('valueEdit')} onPress={() => router.push('/profile/name')} />
      <SettingsRow Icon={IconUsers} label={t('rowBuddy')} value={t('valueManage')} onPress={() => router.dismissTo('/buddy')} />
      <SettingsRow Icon={IconMapPin} label={t('alertAreaTitle')} hint={t('alertAreaDetail')} toggle={{ value: areaRunning, disabled: busy, hitSlop: 8, onChange: value => void toggleArea(value) }} />
      <AppText variant="small" style={{ color: colors.muted }}>{t('alertAreaDetail')}</AppText>
      {observedAt && <SettingsRow Icon={IconMapPin} label={t('rowShareDistance')} hint={t('shareLocationWithBuddies')} toggle={{ value: profile?.share_location_with_buddies ?? false, disabled: busy, onChange: value => void saveProfile({ share_location_with_buddies: value }).catch(() => Alert.alert(t('profileSaveError'))) }} />}
      {observedAt && <SettingsRow Icon={IconMapPinOff} label={t('removeLocation')} onPress={() => void deleteLocation().catch(() => Alert.alert(t('profileSaveError')))} />}
      <SettingsRow Icon={IconRefresh} label={t('resetSetup')} value={t('valueStart')} onPress={() => void resetOnboarding().then(() => router.replace('/')).catch(() => Alert.alert(t('profileSaveError')))} />
    </View>
    <View style={styles.groupDivider} />
    <View>
      <SettingsRow first Icon={IconDatabase} label={t('dataSources')} onPress={() => Alert.alert(t('dataSources'), t('dataSourcesBody'))} />
      <SettingsRow Icon={IconLogout} label={t('authSignOut')} destructive onPress={confirmSignOut} />
    </View>
    {preferencesError && <View style={{ gap: 8, marginTop: 16 }}><AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('preferencesSyncError')}</AppText><ActionButton variant="secondary" label={t('retry')} onPress={() => void retryPreferences()} /></View>}
    <View style={{ gap: 4, marginTop: 28 }}>
      <AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{t('appVersion', { version: Constants.expoConfig?.version ?? '' })}</AppText>
      <AppText variant="small" style={{ color: colors.muted }}>{t('authAccountNote')}</AppText>
    </View>
  </Page>;
}

type RowMenu = { selection: string; options: { value: string; label: string }[]; onSelect: (value: string) => void };

function SettingsRow({ Icon, label, value, hint, accessory = 'chevron', toggle, menu, destructive = false, first = false, onPress }: { Icon: Icon; label: string; value?: string; hint?: string; accessory?: 'chevron' | 'picker' | 'external'; toggle?: { value: boolean; disabled?: boolean; hitSlop?: number; onChange: (value: boolean) => void }; menu?: RowMenu; destructive?: boolean; first?: boolean; onPress?: () => void }) {
  const { preferences } = usePreferences();
  const nativeMenu = menu && Platform.OS === 'ios';
  const labelColor = destructive ? colors.critical : colors.ink;
  const Accessory = accessory === 'picker' ? IconSelector : accessory === 'external' ? IconArrowUpRight : IconChevronRight;
  const content = <>
    <View style={[styles.tile, { backgroundColor: destructive ? colors.critical : colors.borderStrong }]}><Icon size={12} strokeWidth={2.6} color={colors.surface} /></View>
    <AppText accessibilityElementsHidden={nativeMenu} importantForAccessibility={nativeMenu ? 'no' : 'auto'} style={[styles.label, { color: labelColor }]}>{label}</AppText>
    {toggle
      ? <Switch style={SWITCH_CENTER} hitSlop={toggle.hitSlop} accessibilityLabel={label} accessibilityHint={hint} value={toggle.value} disabled={toggle.disabled} trackColor={{ true: colors.primary }} onValueChange={toggle.onChange} />
      : nativeMenu
        ? <ValueMenu label={label} value={value ?? ''} menu={menu} size={preferences.largerText ? 26 : 22} destructive={destructive} />
        : <View style={styles.value}>
          {value ? <AppText style={[styles.valueText, destructive && { color: colors.critical }]}>{value}</AppText> : null}
          <Accessory size={20} strokeWidth={2.5} color={destructive ? colors.critical : colors.ink} />
        </View>}
  </>;
  const rowStyle = [styles.row, !first && styles.rowRule];
  if (toggle || nativeMenu) return <View style={rowStyle}>{content}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} onPress={onPress} style={({ pressed }) => [rowStyle, pressed && { opacity: 0.55 }]}>{content}</Pressable>;
}

// iOS pull-down menu (SwiftUI Menu + Picker): the value and ⌃⌄ are the trigger, options get the system checkmark.
function ValueMenu({ label, value, menu, size, destructive }: { label: string; value: string; menu: RowMenu; size: number; destructive: boolean }) {
  const { preferences } = usePreferences();
  const valueColor = destructive ? colors.critical : preferences.strongerContrast ? colors.ink : colors.muted;
  return <Host matchContents>
    <Menu modifiers={[accessibilityLabel(`${label}, ${value}`)]} label={<HStack spacing={6}>
      <SwiftText modifiers={[font({ size, weight: 'regular' }), foregroundStyle(valueColor)]}>{value}</SwiftText>
      <SwiftImage systemName="chevron.up.chevron.down" modifiers={[font({ size: Math.round(size * 0.7), weight: 'semibold' }), foregroundStyle(valueColor)]} />
    </HStack>}>
      <Picker selection={menu.selection} onSelectionChange={selection => menu.onSelect(String(selection))}>
        {menu.options.map(option => <SwiftText key={option.value} modifiers={[tag(option.value)]}>{option.label}</SwiftText>)}
      </Picker>
    </Menu>
  </Host>;
}

const styles = StyleSheet.create({
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  page: { paddingHorizontal: GUTTER, gap: 0 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, ...corner(radius.lg), backgroundColor: colors.accentSoft },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  // Ducat runs the dashed rule edge to edge, breaking out of the page gutter.
  // iOS only dashes a border when every side is dashed: draw a dashed box and clip all but its top edge.
  dashed: { marginHorizontal: -GUTTER, marginTop: 20, marginBottom: 6, height: 1.5, overflow: 'hidden' },
  dashedLine: { height: 6, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong },
  groupDivider: { width: 70, height: 1, marginVertical: 14, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 61, paddingVertical: 12 },
  tile: { width: 16, height: 16, borderRadius: 4.5, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: 22, lineHeight: 28, fontWeight: '600' },
  valueText: { fontSize: 22, lineHeight: 28, fontWeight: '400', color: colors.muted },
  rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  value: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});

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
  const [selected, setSelected] = useState<AccessibilityType[]>(() => accessibility.map(item => item.type));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
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
    <Field accessibilityLabel={t('profileNameLabel')} value={name} onChangeText={setName} maxLength={60} editable={!busy} autoCapitalize="words" placeholder={t('profileNameLabel')} />
    <Field accessibilityLabel={t('phoneNumber')} value={phone} onChangeText={setPhone} maxLength={32} editable={!busy} keyboardType="phone-pad" placeholder={t('phoneNumber')} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><AppText style={{ flex: 1 }}>{t('needsAssistance')}</AppText><Switch style={SWITCH_CENTER} accessibilityLabel={t('needsAssistance')} value={needsAssistance} disabled={busy} onValueChange={setNeedsAssistance} /></View>
    <AppText variant="section" accessibilityRole="header">{t('accessibilityNeeds')}</AppText>
    {accessibilityTypes.map(type => <View key={type} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <AppText style={{ flex: 1 }}>{t(`accessibility_${type}`)}</AppText>
      <Switch style={SWITCH_CENTER} accessibilityLabel={t(`accessibility_${type}`)} value={selected.includes(type)} disabled={busy} onValueChange={checked => setSelected(current => checked ? [...current, type] : current.filter(item => item !== type))} />
    </View>)}
    {error && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('profileSaveError')}</AppText>}
    <ActionButton label={t('saveProfile')} loading={busy} onPress={() => void save()} />
    <ActionButton variant="secondary" label={t('cancel')} disabled={busy} onPress={() => router.back()} />
  </Page>;
}
