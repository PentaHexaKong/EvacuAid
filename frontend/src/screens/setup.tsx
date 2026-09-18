import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, Page, Panel } from '@/components/ui';
import { colors } from '@/theme';
import { selectLanguage } from '@/localization';
import { usePreferences } from '@/features/preferences/context';

export function SetupScreen({ editing = false, onDone }: { editing?: boolean; onDone?: () => void }) {
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
    try { await selectLanguage(i18n.language === 'id' ? 'en' : 'id'); } catch { setError(true); } finally { setBusy(false); }
  };
  return <Page>
    <View style={{ gap: 12, paddingTop: 24 }}>
      <AppText variant="eyebrow" style={{ color: colors.primary }}>EvacuAid</AppText>
      <AppText variant="title" accessibilityRole="header">{t(step === 'welcome' ? 'welcomeTitle' : 'supportTitle')}</AppText>
      <AppText style={{ color: colors.muted }}>{t(step === 'welcome' ? 'welcomeBody' : 'supportBody')}</AppText>
    </View>
    {step === 'welcome' ? <>
      <Panel><AppText variant="section">{t('welcomePreviewTitle')}</AppText><AppText>{t('welcomePreviewBody')}</AppText></Panel>
      <ActionButton label={t('getStarted')} disabled={busy} onPress={() => setStep('preferences')} />
      <ActionButton variant="secondary" label={t('skipSetup')} loading={busy} onPress={() => void finish(true)} />
      <ActionButton variant="secondary" label={i18n.language === 'id' ? 'Language: English' : 'Bahasa: Indonesia'} disabled={busy} onPress={() => void changeLanguage()} />
    </> : <>
      <View style={{ gap: 12 }}>{(['largerText', 'strongerContrast'] as const).map((key) => <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked: draft[key], disabled: busy }} disabled={busy} onPress={() => setDraft((value) => ({ ...value, [key]: !value[key] }))} style={{ padding: 20, minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: draft[key] ? colors.primary : colors.border, backgroundColor: colors.surface, flexDirection: 'row', gap: 16, alignItems: 'center' }}>
        <View style={{ flex: 1, gap: 8 }}><AppText variant="button">{t(key)}</AppText><AppText variant="small">{t(`${key}Description`)}</AppText></View>
        <AppText accessible={false} style={{ color: colors.primary }}>{draft[key] ? '✓' : '○'}</AppText>
      </Pressable>)}</View>
      <AppText variant="small" style={{ color: colors.muted }}>{t('futureSupport')}</AppText>
      <ActionButton label={t(editing ? 'savePreferences' : 'continueHome')} loading={busy} onPress={() => void finish()} />
      <ActionButton variant="secondary" label={t(editing ? 'cancel' : 'setUpLater')} disabled={busy} onPress={() => editing ? onDone?.() : void finish(true)} />
      {!editing && <ActionButton variant="secondary" label={t('back')} disabled={busy} onPress={() => { setStep('welcome'); setError(false); }} />}
    </>}
    {error && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('setupSaveError')}</AppText>}
    <AppText variant="small" style={{ color: colors.muted }}>{t('localPreferences')}</AppText>
  </Page>;
}
