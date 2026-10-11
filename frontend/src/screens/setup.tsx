import { useContext, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Linking, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, G, Line, LinearGradient as SvgLinearGradient, Mask, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import IconBell from '@tabler/icons-react-native/IconBell';
import IconCircleCheck from '@tabler/icons-react-native/IconCircleCheck';
import IconMapPin from '@tabler/icons-react-native/IconMapPin';
import IconArrowLeft from '@tabler/icons-react-native/IconArrowLeft';
import IconChevronDown from '@tabler/icons-react-native/IconChevronDown';
import IconEar from '@tabler/icons-react-native/IconEar';
import IconEye from '@tabler/icons-react-native/IconEye';
import IconOld from '@tabler/icons-react-native/IconOld';
import IconUser from '@tabler/icons-react-native/IconUser';
import IconWheelchair from '@tabler/icons-react-native/IconWheelchair';
import { ActionButton, AppText, CheckOption, Enter, Page, Panel, StepList, SupportTile, Tap } from '@/components/ui';
import { LevelChip } from '@/components/content';
import { Bloom, type BloomStage } from '@/components/bloom';
import { LanguageMenu } from '@/components/native-controls';
import { Mascot } from '@/components/mascot';
import { brand, colors, corner, radius, SystemReduceMotionContext } from '@/theme';
import { duration, easeCss } from '@/theme/motion';
import { selectLanguage } from '@/localization';
import type { Language } from '@/localization/language';
import type { AlertViewModel } from '@/features/alerts/alerts';
import { PreferencesPreview, usePreferences } from '@/features/preferences/context';
import { defaults, type Preferences } from '@/features/preferences/storage';
import { ensureForeground, ensureNotifications, isPrecise, type PermissionResult } from '@/features/location/permissions';
import { prepareNotificationChannel } from '@/features/location/push-token';
import { ONBOARDING_NEEDS_KEY, useProfile, type AccessibilityType } from '@/features/profile/context';
import { useGuestSession } from '@/features/profile/session';
import { apiRequest } from '@/features/profile/api';

// React Native's iOS Switch composes alignSelf: 'flex-start', which pins it to the top of a centred row.
const SWITCH_CENTER = { alignSelf: 'center' } as const;
const OPTIONS = ['voiceEnabled', 'vibrationEnabled', 'largerText', 'strongerContrast', 'textEnabled'] as const;
type Option = typeof OPTIONS[number];
type Step = 'welcome' | 'help' | 'warning' | 'reach';
const BLOOM: Record<Step, BloomStage> = { welcome: 'hidden', help: 'rest', warning: 'hidden', reach: 'hidden' };
// ponytail: tiles are presets over the existing flags; mobility has no flag yet and is only saved to the profile.
const NEEDS: { type: AccessibilityType; key: string; Icon: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>; preset: Option[] }[] = [
  { type: 'VISUAL_IMPAIRMENT', key: 'needVisual', Icon: IconEye, preset: ['voiceEnabled', 'largerText', 'strongerContrast'] },
  { type: 'HEARING_IMPAIRMENT', key: 'needHearing', Icon: IconEar, preset: ['vibrationEnabled', 'textEnabled'] },
  { type: 'MOBILITY_LIMITATION', key: 'needMobility', Icon: IconWheelchair, preset: [] },
  { type: 'ELDERLY', key: 'needElderly', Icon: IconOld, preset: ['largerText', 'strongerContrast'] },
];

async function guarded(setBusy: (busy: boolean) => void, setError: (error: boolean) => void, work: () => Promise<void>) {
  setBusy(true);
  setError(false);
  try { await work(); } catch { setError(true); } finally { setBusy(false); }
}

export type ReachPermissions = { location?: Location.LocationObject; notifications?: boolean };

export function SetupScreen({ editing = false, start = 'welcome', onDone, onReach, beforePreferences, footer }: { editing?: boolean; start?: Step; onDone?: (target?: string) => void; onReach?: (permissions: ReachPermissions) => void; beforePreferences?: ReactNode; footer?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { preferences, save } = usePreferences();
  const profile = useProfile();
  const session = useGuestSession();
  const [step, setStep] = useState<Step>(start);
  const [draft, setDraft] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [target, setTarget] = useState<string | undefined>();
  const [needs, setNeeds] = useState<AccessibilityType[]>([]);
  const insets = useSafeAreaInsets();
  const finish = (skip = false, target?: string) => guarded(setBusy, setError, async () => {
    if (!skip && needs.length) {
      if (profile.ready) await profile.saveAccessibility(needs.map(type=>({type,severity:null})));
      else if (session.token && session.user) {
        await apiRequest(`/v1/users/${session.user.id}/accessibility`,session.token,
          {method:'PUT',body:JSON.stringify({items:needs.map(type=>({type,severity:null}))})});
        void profile.retry().catch(()=>{});
      }
      else await AsyncStorage.setItem(ONBOARDING_NEEDS_KEY, JSON.stringify(needs));
    }
    await save({ ...(skip ? preferences : draft), completed: true });
    onDone?.(target);
  });
  const chooseNeeds = (next: AccessibilityType[]) => {
    setNeeds(next);
    const enabled = new Set(NEEDS.filter(need => next.includes(need.type)).flatMap(need => need.preset));
    setDraft(current => ({ ...current, ...Object.fromEntries(OPTIONS.map(key => [key, enabled.has(key) || defaults[key]])) }));
  };
  const changeLanguage = (language: Language) => guarded(setBusy, setError, async () => {
    if (language === i18n.language) return;
    await save({ ...preferences, language });
    setDraft(current => ({ ...current, language }));
    await selectLanguage(language);
  });
  const change = (key: Option, value: boolean) => setDraft(current => ({ ...current, [key]: value }));
  const go = (next: Step) => { setStep(next); setError(false); };
  const errorText = error && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('setupSaveError')}</AppText>;

  if (editing) return <Page>
    <View style={{ gap: 12 }}>
      <AppText variant="title" accessibilityRole="header">{t('supportTitle')}</AppText>
      <AppText style={{ color: colors.muted }}>{t('supportBody')}</AppText>
    </View>
    {beforePreferences}
    <PreferenceSwitches draft={draft} busy={busy} onChange={change} />
    <PreferencesPreview preferences={draft}><Panel><AppText variant="section">{t('preferencePreview')}</AppText><AppText style={{ color: colors.muted }}>{t('preferencePreviewBody')}</AppText></Panel></PreferencesPreview>
    <View style={{ gap: 12 }}>
      <ActionButton label={t('savePreferences')} loading={busy} onPress={() => void finish()} />
      <ActionButton variant="secondary" label={t('cancel')} disabled={busy} onPress={() => onDone?.()} />
    </View>
    {errorText}
    {footer}
  </Page>;

  return <View style={{ flex: 1, backgroundColor: colors.canvas }}>
    <StatusBar style={step === 'welcome' ? 'light' : 'dark'} />
    {step === 'welcome' && <BrandBackdrop />}
    <Bloom stage={BLOOM[step]} />
    <Page transparent fill edgeInsets={insets}>
      {step === 'welcome' && <WelcomeStep busy={busy} onLanguage={language => void changeLanguage(language)} onStart={() => go('help')} onSkip={() => void finish(true)} />}
      {step === 'help' && <HelpStep draft={draft} needs={needs} busy={busy} onNeeds={chooseNeeds} onChange={change} onNext={() => go('warning')} onLater={() => void finish(true)} onBack={() => go('welcome')} />}
      {step === 'warning' && <WarningStep busy={busy} onFinish={() => { setTarget(undefined); go('reach'); }} onHelp={() => { setTarget('/buddy'); go('reach'); }} onBack={() => go('help')} />}
      {step === 'reach' && <ReachStep busy={busy} onReach={onReach} onFinish={() => void finish(false, target)} onBack={() => go('warning')} />}
      {errorText}
      {footer}
    </Page>
  </View>;
}

export function BrandBackdrop() {
  return <Animated.View entering={FadeIn.duration(duration.enter)} exiting={FadeOut.duration(duration.enter)} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    <LinearGradient colors={brand.stops as [string, string, string]} locations={[0, 0.42, 1]} start={{ x: 0.85, y: 0 }} end={{ x: 0.15, y: 1 }} style={StyleSheet.absoluteFill} />
    <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="xMidYMin slice">
      <Defs>
        <RadialGradient id="haze" cx="80" cy="90" r="260" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={brand.haze} stopOpacity={0.85} />
          <Stop offset="1" stopColor={brand.haze} stopOpacity={0} />
        </RadialGradient>
        <SvgLinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.55} />
          <Stop offset="0.3" stopColor="#FFFFFF" stopOpacity={1} />
          <Stop offset="0.62" stopColor="#FFFFFF" stopOpacity={0} />
        </SvgLinearGradient>
        <Mask id="map" maskUnits="userSpaceOnUse" x="0" y="0" width="390" height="844">
          <Rect width="390" height="844" fill="url(#fade)" />
        </Mask>
      </Defs>
      <Rect width="390" height="844" fill="url(#haze)" />
      {/* ponytail: fixed street grid whose main crossing (195,362) sits under the mascot's pin tip on a typical iPhone; every street overruns the canvas so no ends show */}
      <G mask="url(#map)" fill="none" stroke={colors.surface} strokeLinecap="butt">
        <G transform="rotate(-14 195 362)" strokeOpacity={0.13} strokeWidth={11}>
          <Line x1="-400" y1="96" x2="800" y2="96" />
          <Line x1="-400" y1="230" x2="800" y2="230" />
          <Line x1="-400" y1="362" x2="800" y2="362" />
          <Line x1="-400" y1="486" x2="800" y2="486" />
          <Line x1="-6" y1="-400" x2="48" y2="1000" />
          <Line x1="168" y1="-400" x2="222" y2="1000" />
          <Line x1="338" y1="-400" x2="392" y2="1000" />
        </G>
        <Path d="M -60 540 C 70 480, 130 390, 195 362 S 350 250, 460 190" strokeOpacity={0.2} strokeWidth={22} />
      </G>
    </Svg>
  </Animated.View>;
}

function WelcomeStep({ busy, onLanguage, onStart, onSkip }: { busy: boolean; onLanguage: (language: Language) => void; onStart: () => void; onSkip: () => void }) {
  const { t, i18n } = useTranslation();
  return <>
    <View style={[styles.brandRow, { justifyContent: 'flex-end' }]}>
      <LanguageMenu label={t('language')} value={i18n.language} disabled={busy} onChange={onLanguage} />
    </View>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.mascotStage}>
      <Mascot />
    </View>
    <View style={{ gap: 12 }}>
      <Enter index={1}><AppText variant="statement" accessibilityRole="header" style={{ color: colors.surface }}>{t('welcomeTitle')}</AppText></Enter>
      <Enter index={2}><AppText variant="lead" style={{ color: colors.surface }}>{t('welcomeBody')}</AppText></Enter>
    </View>
    <Enter index={3} style={{ gap: 12 }}>
      <ActionButton variant="light" label={t('getStarted')} disabled={busy} onPress={onStart} />
      <ActionButton variant="ghostLight" label={t('skipSetup')} loading={busy} onPress={onSkip} />
    </Enter>
  </>;
}

function StepHeader({ current, busy, onBack }: { current: number; busy: boolean; onBack: () => void }) {
  const { t } = useTranslation();
  const reduceMotion = useContext(SystemReduceMotionContext);
  const total = 3;
  return <View style={{ gap: 14 }}>
    <View style={styles.brandRow}>
      <Tap accessibilityLabel={t('back')} disabled={busy} onPress={onBack} style={styles.back}><IconArrowLeft size={24} color={colors.ink} /></Tap>
    </View>
    <View accessible accessibilityRole="progressbar" accessibilityLabel={t('setupStep', { current, total })} accessibilityValue={{ min: 0, max: total, now: current }} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3].map(index => <View key={index} style={styles.dash}>
          <Animated.View style={[styles.dashFill, { width: index <= current ? '100%' : '0%', transitionProperty: 'width', transitionDuration: reduceMotion ? 0 : duration.dash, transitionTimingFunction: easeCss.out }]} />
        </View>)}
      </View>
      <AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{t('setupStep', { current, total })}</AppText>
    </View>
  </View>;
}

function HelpStep({ draft, needs, busy, onNeeds, onChange, onNext, onLater, onBack }: { draft: Preferences; needs: AccessibilityType[]; busy: boolean; onNeeds: (needs: AccessibilityType[]) => void; onChange: (key: Option, value: boolean) => void; onNext: () => void; onLater: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const reduceMotion = useContext(SystemReduceMotionContext);
  const [details, setDetails] = useState(false);
  return <>
    <StepHeader current={1} busy={busy} onBack={onBack} />
    <View style={{ gap: 10 }}>
      <Enter index={0}><AppText variant="question" accessibilityRole="header">{t('supportTitle')}</AppText></Enter>
      <Enter index={1}><AppText variant="lead">{t('supportBody')}</AppText></Enter>
    </View>
    <View style={styles.tiles}>
      {NEEDS.map(({ type, key, Icon }, index) => <Enter key={type} index={index + 2} style={styles.tileHalf}>
        <SupportTile icon={<Icon size={22} color={colors.primary} />} label={t(key)} description={t(`${key}Description`)} checked={needs.includes(type)} disabled={busy}
          onToggle={checked => onNeeds(checked ? [...needs, type] : needs.filter(item => item !== type))} />
      </Enter>)}
      <Enter index={NEEDS.length + 2} style={{ flexBasis: '100%' }}>
        <SupportTile wide icon={<IconUser size={22} color={colors.primary} />} label={t('needStandard')} description={t('needStandardDescription')} checked={!needs.length} disabled={busy} onToggle={() => onNeeds([])} />
      </Enter>
    </View>
    <View style={{ gap: 10 }}>
      <Tap accessibilityLabel={t('adjustDetails')} accessibilityState={{ expanded: details }} onPress={() => setDetails(open => !open)} style={styles.disclosure}>
        <AppText variant="button" style={{ color: colors.primary, flex: 1 }}>{t('adjustDetails')}</AppText>
        <Animated.View style={{ transform: [{ rotate: details ? '180deg' : '0deg' }], transitionProperty: 'transform', transitionDuration: reduceMotion ? 0 : duration.state, transitionTimingFunction: easeCss.out }}>
          <IconChevronDown size={20} color={colors.primary} />
        </Animated.View>
      </Tap>
      {details && OPTIONS.map((key, index) => <Enter key={key} index={index}>
        <CheckOption label={t(key)} description={t(`${key}Description`)} checked={draft[key]} disabled={busy} onToggle={value => onChange(key, value)} />
      </Enter>)}
    </View>
    <View style={{ flex: 1, minHeight: 8 }} />
    <View style={{ gap: 12 }}>
      <ActionButton variant="gradient" label={t('nextStep')} disabled={busy} onPress={onNext} />
      <ActionButton variant="secondary" label={t('setUpLater')} loading={busy} onPress={onLater} />
      <AppText variant="small" style={{ color: colors.muted }}>{t('localPreferences')}</AppText>
    </View>
  </>;
}

function WarningStep({ busy, onFinish, onHelp, onBack }: { busy: boolean; onFinish: () => void; onHelp: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const alert: AlertViewModel = { id: 'preview', level: 'waspada', title: 'rainTitle', area: t('exampleArea'), issued: '17 Sep 2026 · 08:30 WIB', window: null, body: '', steps: ['rainStep1', 'rainStep2', 'rainStep3'], coordinate: { latitude: -6.2665, longitude: 106.809 } };
  return <>
    <StepHeader current={2} busy={busy} onBack={onBack} />
    <View style={{ gap: 10 }}>
      <Enter index={0}><AppText variant="question" accessibilityRole="header">{t('onboardWarningTitle')}</AppText></Enter>
      <Enter index={1}><AppText variant="lead">{t('onboardWarningBody')}</AppText></Enter>
    </View>
    <Enter index={2} style={styles.warning}>
      <View style={styles.chips}><LevelChip level={alert.level} /></View>
      <AppText variant="section">{t(alert.title)}</AppText>
      <AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{alert.area} · {alert.issued}</AppText>
      <View style={styles.rule} />
      <StepList steps={alert.steps.map(step => t(step))} />
    </Enter>
    <View style={{ flex: 1, minHeight: 12 }} />
    <Enter index={3} style={{ gap: 12 }}>
      <ActionButton variant="gradient" label={t('nextStep')} loading={busy} onPress={onFinish} />
      <ActionButton variant="secondary" label={t('requestHelp')} disabled={busy} onPress={onHelp} />
    </Enter>
  </>;
}

function ReachStep({ busy, onFinish, onBack, onReach }: { onReach?: (permissions: ReachPermissions) => void; busy: boolean; onFinish: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const [locationPermission, setLocationPermission] = useState<PermissionResult | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<PermissionResult | null>(null);
  const [fix, setFix] = useState<Location.LocationObject | null>(null);
  const [asking, setAsking] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const ask = async () => {
    if (asking) return;
    setAsking(true);
    try {
      const location = await ensureForeground().catch(() => 'denied' as const);
      if (!alive.current) return;
      setLocationPermission(location);
      await prepareNotificationChannel().catch(() => {});
      const notifications = await ensureNotifications().catch(() => 'denied' as const);
      if (!alive.current) return;
      setNotificationPermission(notifications);
      if (notifications === 'granted') onReach?.({ notifications: true });
      if (location === 'granted') {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const value = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 10000); })]);
          if (alive.current) { setFix(value); onReach?.({ location: value }); }
        } catch {} finally { clearTimeout(timer); }
      }
    } finally { if (alive.current) setAsking(false); }
  };
  const decided = locationPermission !== null && notificationPermission !== null;
  const settings = () => void Linking.openSettings();
  return <>
    <StepHeader current={3} busy={busy || asking} onBack={onBack} />
    <Enter index={0}><AppText variant="question" accessibilityRole="header">{t('reachTitle')}</AppText></Enter>
    <Enter index={1}><AppText variant="lead">{t('reachBody')}</AppText></Enter>
    <Enter index={2} style={{ gap: 10 }}>
      <PermissionRow title={t('reachLocationTitle')} reason={t('reachLocationReason')} Icon={IconMapPin} permission={locationPermission} />
      {fix && !isPrecise(fix.coords.accuracy) && <View style={{ gap: 4 }}><AppText variant="small" accessibilityRole="alert">{t('reachPreciseOff')}</AppText><Tap accessibilityLabel={t('openSettings')} style={{ minHeight: 44 }} onPress={settings}><AppText variant="button" style={{ color: colors.primary }}>{t('openSettings')}</AppText></Tap></View>}
      <PermissionRow title={t('reachNotificationsTitle')} reason={t('reachNotificationsReason')} Icon={IconBell} permission={notificationPermission} />
      {(locationPermission === 'blocked' || notificationPermission === 'blocked') && <Tap accessibilityLabel={t('openSettings')} style={{ minHeight: 44 }} onPress={settings}><AppText variant="button" style={{ color: colors.primary }}>{t('openSettings')}</AppText></Tap>}
    </Enter>
    <View style={{ flex: 1, minHeight: 12 }} />
    <Enter index={3} style={{ gap: 12 }}>
      <ActionButton variant="gradient" label={t(decided ? 'continueHome' : 'reachTurnOn')} loading={busy || asking} onPress={() => decided ? onFinish() : void ask()} />
      {!decided && <ActionButton variant="secondary" label={t('reachNotNow')} onPress={onFinish} />}
    </Enter>
  </>;
}

function PermissionRow({ title, reason, Icon, permission }: { title: string; reason: string; Icon: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>; permission: PermissionResult | null }) {
  const { t } = useTranslation();
  const status = permission === null ? '' : t(permission === 'granted' ? 'reachOn' : 'reachOff');
  return <View accessible accessibilityLabel={[title, reason, status].filter(Boolean).map(value => value.replace(/\.+$/, '')).join('. ')} style={[styles.switchRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
    <View style={{ width: 40, height: 40, backgroundColor: colors.accentSoft, ...corner(radius.sm), alignItems: 'center', justifyContent: 'center' }}><Icon size={22} strokeWidth={2} color={colors.primary} /></View>
    <View style={{ flex: 1, gap: 4 }}><AppText variant="button">{title}</AppText><AppText variant="small" style={{ color: colors.muted }}>{reason}</AppText></View>
    {permission && <View style={{ alignItems: 'center', gap: 4 }}>{permission === 'granted' && <IconCircleCheck size={22} color={colors.primary} />}<AppText variant="small" style={{ color: permission === 'granted' ? colors.primary : colors.muted }}>{status}</AppText></View>}
  </View>;
}

function PreferenceSwitches({ draft, busy, onChange }: { draft: Preferences; busy: boolean; onChange: (key: Option, value: boolean) => void }) {
  const { t } = useTranslation();
  return <View style={{ gap: 10 }}>{OPTIONS.map(key => <View key={key} style={[styles.switchRow, { borderColor: draft[key] ? colors.primary : colors.border, backgroundColor: draft[key] ? colors.selected : colors.surface }]}>
    <View style={{ flex: 1, gap: 4 }}><AppText variant="button">{t(key)}</AppText><AppText variant="small" style={{ color: colors.muted }}>{t(`${key}Description`)}</AppText></View>
    <Switch style={SWITCH_CENTER} hitSlop={8} accessibilityLabel={t(key)} accessibilityHint={t(`${key}Description`)} value={draft[key]} disabled={busy} trackColor={{ true: colors.primary }} onValueChange={value => onChange(key, value)} />
  </View>)}</View>;
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },
  mascotStage: { flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center' },
  back: { width: 44, height: 44, marginLeft: -10 },
  dash: { flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  dashFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: radius.pill, backgroundColor: colors.primary },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tileHalf: { flexGrow: 1, flexBasis: '46%', flexDirection: 'row' },
  disclosure: { minHeight: 44, justifyContent: 'flex-start' },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  warning: { gap: 10, padding: 16, ...corner(radius.lg), backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  switchRow: { paddingVertical: 14, paddingHorizontal: 16, minHeight: 64, ...corner(radius.md), borderWidth: 1.5, flexDirection: 'row', gap: 16, alignItems: 'center' },
});
