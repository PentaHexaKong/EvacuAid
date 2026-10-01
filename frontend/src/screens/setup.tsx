import { useContext, useState, type ReactNode } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, CheckOption, Enter, Page, Panel, StepList, Tap } from '@/components/ui';
import { ExampleChip, LevelChip } from '@/components/content';
import { Bloom, type BloomStage } from '@/components/bloom';
import { Logo } from '@/components/logo';
import { colors, SystemReduceMotionContext } from '@/theme';
import { duration, easeCss } from '@/theme/motion';
import { selectLanguage } from '@/localization';
import { sampleAlerts } from '@/features/content/samples';
import { PreferencesPreview, usePreferences } from '@/features/preferences/context';
import type { Preferences } from '@/features/preferences/storage';

const OPTIONS = ['voiceEnabled', 'vibrationEnabled', 'largerText', 'strongerContrast', 'textEnabled'] as const;
type Option = typeof OPTIONS[number];
type Step = 'welcome' | 'help' | 'warning';
const STEPS: Step[] = ['welcome', 'help', 'warning'];
const BLOOM: Record<Step, BloomStage> = { welcome: 'rest', help: 'grown', warning: 'hidden' };

async function guarded(setBusy: (busy: boolean) => void, setError: (error: boolean) => void, work: () => Promise<void>) {
  setBusy(true);
  setError(false);
  try { await work(); } catch { setError(true); } finally { setBusy(false); }
}

export function SetupScreen({ editing = false, onDone, beforePreferences, footer }: { editing?: boolean; onDone?: (target?: string) => void; beforePreferences?: ReactNode; footer?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { preferences, save } = usePreferences();
  const [step, setStep] = useState<Step>('welcome');
  const [draft, setDraft] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const finish = (skip = false, target?: string) => guarded(setBusy, setError, async () => { await save({ ...(skip ? preferences : draft), completed: true }); onDone?.(target); });
  const changeLanguage = () => guarded(setBusy, setError, async () => {
    const language = i18n.language === 'id' ? 'en' : 'id';
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

  return <View style={{ flex: 1, backgroundColor: colors.surface }}>
    <Bloom stage={BLOOM[step]} />
    <Page transparent fill>
      <OnboardingBrand step={step} busy={busy} onLanguage={() => void changeLanguage()} />
      {step === 'welcome' && <WelcomeStep busy={busy} onStart={() => go('help')} onSkip={() => void finish(true)} />}
      {step === 'help' && <HelpStep draft={draft} busy={busy} onChange={change} onNext={() => go('warning')} onLater={() => void finish(true)} onBack={() => go('welcome')} />}
      {step === 'warning' && <WarningStep busy={busy} onFinish={() => void finish()} onHelp={() => void finish(false, '/buddy')} onBack={() => go('help')} />}
      {errorText}
      {footer}
    </Page>
  </View>;
}

function OnboardingBrand({ step, busy, onLanguage }: { step: Step; busy: boolean; onLanguage: () => void }) {
  const { t, i18n } = useTranslation();
  const reduceMotion = useContext(SystemReduceMotionContext);
  const indonesian = i18n.language === 'id';
  const current = STEPS.indexOf(step);
  return <View style={{ gap: 16, paddingTop: 12 }}>
    <View style={styles.brandRow}>
      <Logo height={24} />
      {step === 'welcome' && <Tap accessibilityLabel={indonesian ? 'Language: English' : 'Bahasa: Indonesia'} accessibilityState={{ disabled: busy }} disabled={busy} onPress={onLanguage} style={{ minHeight: 44, paddingHorizontal: 12 }}><AppText variant="button" style={{ color: colors.primary }}>{indonesian ? 'English' : 'Indonesia'}</AppText></Tap>}
    </View>
    <View accessible accessibilityRole="progressbar" accessibilityLabel={t('setupStep', { current: current + 1, total: STEPS.length })} accessibilityValue={{ min: 0, max: STEPS.length, now: current + 1 }} style={{ flexDirection: 'row', gap: 6 }}>
      {STEPS.map((item, index) => <View key={item} style={styles.dash}>
        <Animated.View style={[styles.dashFill, { width: index <= current ? '100%' : '0%', transitionProperty: 'width', transitionDuration: reduceMotion ? 0 : duration.dash, transitionTimingFunction: easeCss.out }]} />
      </View>)}
    </View>
  </View>;
}

function WelcomeStep({ busy, onStart, onSkip }: { busy: boolean; onStart: () => void; onSkip: () => void }) {
  const { t } = useTranslation();
  return <>
    <Enter index={0}><AppText variant="statement" accessibilityRole="header">{t('welcomeTitle')}</AppText></Enter>
    <Enter index={1}><AppText variant="lead">{t('welcomeBody')}</AppText></Enter>
    <View style={{ flex: 1, minHeight: 24 }} />
    <Enter index={2} style={{ gap: 12 }}>
      <ActionButton variant="gradient" label={t('getStarted')} disabled={busy} onPress={onStart} />
      <ActionButton variant="secondary" label={t('skipSetup')} loading={busy} onPress={onSkip} />
    </Enter>
  </>;
}

function HelpStep({ draft, busy, onChange, onNext, onLater, onBack }: { draft: Preferences; busy: boolean; onChange: (key: Option, value: boolean) => void; onNext: () => void; onLater: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  return <>
    <Enter index={0}><AppText variant="question" accessibilityRole="header">{t('supportTitle')}</AppText></Enter>
    <Enter index={1}><AppText variant="lead">{t('supportBody')}</AppText></Enter>
    <View style={{ gap: 10 }}>{OPTIONS.map((key, index) => <Enter key={key} index={index + 2}>
      <CheckOption label={t(key)} description={t(`${key}Description`)} checked={draft[key]} disabled={busy} onToggle={value => onChange(key, value)} />
    </Enter>)}</View>
    <Enter index={OPTIONS.length + 2} style={{ gap: 12 }}>
      <ActionButton variant="gradient" label={t('nextStep')} disabled={busy} onPress={onNext} />
      <ActionButton variant="secondary" label={t('setUpLater')} loading={busy} onPress={onLater} />
      <ActionButton variant="secondary" label={t('back')} disabled={busy} onPress={onBack} />
    </Enter>
    <AppText variant="small" style={{ color: colors.muted }}>{t('localPreferences')}</AppText>
  </>;
}

function WarningStep({ busy, onFinish, onHelp, onBack }: { busy: boolean; onFinish: () => void; onHelp: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const alert = sampleAlerts[0];
  return <>
    <Enter index={0}><AppText variant="question" accessibilityRole="header">{t('onboardWarningTitle')}</AppText></Enter>
    <Enter index={1}><AppText variant="lead">{t('onboardWarningBody')}</AppText></Enter>
    <Enter index={2} style={styles.warning}>
      <View style={styles.chips}><LevelChip level={alert.level} /><ExampleChip /></View>
      <AppText variant="section">{t(alert.title)}</AppText>
      <AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{t(alert.area)} · {alert.issued}</AppText>
    </Enter>
    <Enter index={3}><StepList steps={alert.steps.map(step => t(step))} /></Enter>
    <View style={{ flex: 1, minHeight: 12 }} />
    <Enter index={4} style={{ gap: 12 }}>
      <ActionButton variant="gradient" label={t('continueHome')} loading={busy} onPress={onFinish} />
      <ActionButton variant="secondary" label={t('requestHelp')} disabled={busy} onPress={onHelp} />
      <ActionButton variant="secondary" label={t('back')} disabled={busy} onPress={onBack} />
    </Enter>
  </>;
}

function PreferenceSwitches({ draft, busy, onChange }: { draft: Preferences; busy: boolean; onChange: (key: Option, value: boolean) => void }) {
  const { t } = useTranslation();
  return <View style={{ gap: 10 }}>{OPTIONS.map(key => <View key={key} style={[styles.switchRow, { borderColor: draft[key] ? colors.primary : colors.border, backgroundColor: draft[key] ? colors.selected : colors.surface }]}>
    <View style={{ flex: 1, gap: 4 }}><AppText variant="button">{t(key)}</AppText><AppText variant="small" style={{ color: colors.muted }}>{t(`${key}Description`)}</AppText></View>
    <Switch hitSlop={8} accessibilityLabel={t(key)} accessibilityHint={t(`${key}Description`)} value={draft[key]} disabled={busy} trackColor={{ true: colors.primary }} onValueChange={value => onChange(key, value)} />
  </View>)}</View>;
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', minHeight: 44 },
  dash: { width: 22, height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  dashFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: colors.primary },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  warning: { gap: 10, padding: 16, borderRadius: 16, backgroundColor: colors.canvas, borderWidth: 1.5, borderColor: colors.border },
  switchRow: { paddingVertical: 14, paddingHorizontal: 16, minHeight: 64, borderRadius: 14, borderWidth: 1.5, flexDirection: 'row', gap: 16, alignItems: 'center' },
});
