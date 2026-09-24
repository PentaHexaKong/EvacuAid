import { useState, type ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, Page, Panel } from '@/components/ui';
import { colors } from '@/theme';
import IconMap2 from '@tabler/icons-react-native/IconMap2';
import { selectLanguage } from '@/localization';
import { PreferencesPreview, usePreferences } from '@/features/preferences/context';

export function SetupScreen({ editing = false, onDone, beforePreferences, footer }: { editing?: boolean; onDone?: () => void; beforePreferences?: ReactNode; footer?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { preferences, save } = usePreferences();
  const [step, setStep] = useState(editing ? 'preferences' : 'welcome');
  const [draft, setDraft] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const finish = async (skip = false) => {
    setBusy(true); setError(false);
    try { await save({ ...(skip ? preferences : draft), completed: true }); onDone?.(); }
    catch { setError(true); } finally { setBusy(false); }
  };
  const changeLanguage = async () => {
    setBusy(true); setError(false);
    const language = i18n.language === 'id' ? 'en' : 'id';
    try { await save({ ...preferences, language }); setDraft(current => ({ ...current, language })); await selectLanguage(language); } catch { setError(true); } finally { setBusy(false); }
  };
  return <Page>
    <View style={{ gap: 12, paddingTop: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><AppText variant="eyebrow" style={{ color: colors.primary }}>EvacuAid</AppText>{step === 'welcome' && <Pressable accessibilityRole="button" accessibilityLabel={i18n.language === 'id' ? 'Language: English' : 'Bahasa: Indonesia'} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void changeLanguage()} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }}><AppText variant="button" style={{ color: colors.primary }}>{i18n.language === 'id' ? 'English' : 'Indonesia'}</AppText></Pressable>}</View>
      <AppText variant="title" accessibilityRole="header">{t(step === 'welcome' ? 'welcomeTitle' : 'supportTitle')}</AppText>
      <AppText style={{ color: colors.muted }}>{t(step === 'welcome' ? 'welcomeBody' : 'supportBody')}</AppText>
    </View>
    {step === 'welcome' ? <>
      <View accessible={false} style={{ padding: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1, borderColor: colors.border }}><View style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' }}><IconMap2 size={56} strokeWidth={1.5} color={colors.primary} /></View></View>
      <Panel><AppText variant="section">{t('welcomePreviewTitle')}</AppText><AppText>{t('welcomePreviewBody')}</AppText></Panel>
      <ActionButton label={t('getStarted')} disabled={busy} onPress={() => setStep('preferences')} />
      <ActionButton variant="secondary" label={t('skipSetup')} loading={busy} onPress={() => void finish(true)} />
    </> : <>
      {beforePreferences}
      <View style={{ gap: 12 }}>{(['largerText', 'strongerContrast', 'voiceEnabled', 'vibrationEnabled', 'textEnabled'] as const).map((key) => <View key={key} style={{ padding: 20, minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: draft[key] ? colors.primary : colors.border, backgroundColor: colors.surface, flexDirection: 'row', gap: 16, alignItems: 'center' }}>
        <View style={{ flex: 1, gap: 8 }}><AppText variant="button">{t(key)}</AppText><AppText variant="small">{t(`${key}Description`)}</AppText></View>
        <Switch hitSlop={8} accessibilityLabel={t(key)} accessibilityHint={t(`${key}Description`)} value={draft[key]} disabled={busy} trackColor={{ true: colors.primary }} onValueChange={value => setDraft(current => ({ ...current, [key]: value }))} />
      </View>)}</View>
      <PreferencesPreview preferences={draft}><Panel><AppText variant="section">{t('preferencePreview')}</AppText><AppText style={{ color: colors.muted }}>{t('preferencePreviewBody')}</AppText></Panel></PreferencesPreview>
      <AppText variant="small" style={{ color: colors.muted }}>{t('futureSupport')}</AppText>
      <ActionButton label={t(editing ? 'savePreferences' : 'continueHome')} loading={busy} onPress={() => void finish()} />
      <ActionButton variant="secondary" label={t(editing ? 'cancel' : 'setUpLater')} disabled={busy} onPress={() => editing ? onDone?.() : void finish(true)} />
      {!editing && <ActionButton variant="secondary" label={t('back')} disabled={busy} onPress={() => { setStep('welcome'); setError(false); }} />}
    </>}
    {error && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('setupSaveError')}</AppText>}
    <AppText variant="small" style={{ color: colors.muted }}>{t('localPreferences')}</AppText>
    {footer}
  </Page>;
}
