import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { useTranslation } from 'react-i18next';
import IconArrowLeft from '@tabler/icons-react-native/IconArrowLeft';
import { ActionButton, AppText, Enter, Field, Page, Tap } from '@/components/ui';
import { LanguageMenu } from '@/components/native-controls';
import { Mascot } from '@/components/mascot';
import { BrandBackdrop } from '@/screens/setup';
import { GUEST_TOKEN_KEY, useAuthSession } from '@/features/profile/session';
import { usePreferences } from '@/features/preferences/context';
import { selectLanguage } from '@/localization';
import type { Language } from '@/localization/language';
import { colors } from '@/theme';

type Mode = 'choose' | 'signin' | 'register';

export function AuthScreen() {
  const [mode,setMode] = useState<Mode>('choose');
  const [hasGuest,setHasGuest] = useState(false);
  useEffect(() => { void SecureStore.getItemAsync(GUEST_TOKEN_KEY).then(value=>setHasGuest(!!value)).catch(()=>{}); },[]);
  return mode === 'choose'
    ? <ChooseEntry hasGuest={hasGuest} onAccount={setMode} />
    : <AccountForm key={mode} register={mode === 'register'} hasGuest={hasGuest} onMode={setMode} />;
}

// The first screen: an account, or straight in as a guest. It shares the setup welcome's sky so the two read as one flow.
function ChooseEntry({ hasGuest, onAccount }: { hasGuest: boolean; onAccount: (mode: Mode) => void }) {
  const { t, i18n } = useTranslation();
  const session = useAuthSession();
  const { preferences, save } = usePreferences();
  const insets = useSafeAreaInsets();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const pending = useRef(false);
  const changeLanguage = async (language: Language) => {
    if (language === i18n.language) return;
    await save({ ...preferences, language }).catch(() => {});
    await selectLanguage(language);
  };
  const guest = async () => {
    if (pending.current) return;
    pending.current=true;setBusy(true);setError(null);
    try { await session.continueAsGuest(); }
    catch (cause) {
      const { status, kind } = cause as { status?: number; kind?: string };
      setError(t(status===404 ? 'authGuestUnavailable' : kind==='network' ? 'apiNetworkUnavailable' : 'authTryAgain'));
    } finally { pending.current=false;setBusy(false); }
  };
  return <View style={{ flex: 1, backgroundColor: colors.canvas }}>
    <StatusBar style="light" />
    <BrandBackdrop />
    <Page transparent fill edgeInsets={insets}>
      <View style={[styles.row, { justifyContent: 'flex-end' }]}>
        <LanguageMenu label={t('language')} value={i18n.language} disabled={busy} onChange={language => void changeLanguage(language)} />
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.mascotStage}>
        <Mascot />
      </View>
      <View style={{ gap: 12 }}>
        <Enter index={1}><AppText variant="statement" accessibilityRole="header" style={{ color: colors.surface }}>{t('welcomeTitle')}</AppText></Enter>
        <Enter index={2}><AppText variant="lead" style={{ color: colors.surface }}>{t('entryBody')}</AppText></Enter>
      </View>
      <Enter index={3} style={{ gap: 12 }}>
        <ActionButton variant="light" label={t('authSignIn')} disabled={busy} onPress={() => onAccount('signin')} />
        <ActionButton variant="ghostLight" label={t('entryGuest')} detail={t(hasGuest ? 'entryGuestResume' : 'entryGuestDetail')} loading={busy} onPress={() => void guest()} />
        {error && <AppText accessibilityRole="alert" style={styles.error}>{error}</AppText>}
        <Tap disabled={busy} onPress={() => onAccount('register')} style={styles.textButton}>
          <AppText variant="button" style={{ color: colors.surface, textAlign: 'center' }}>{t('authNeedAccount')}</AppText>
        </Tap>
      </Enter>
    </Page>
  </View>;
}

function AccountForm({ register, hasGuest, onMode }: { register: boolean; hasGuest: boolean; onMode: (mode: Mode) => void }) {
  const { t } = useTranslation();
  const session = useAuthSession();
  const insets = useSafeAreaInsets();
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [name,setName] = useState('');
  // Someone who left guest mode to make an account expects to keep that profile.
  const [upgrade,setUpgrade] = useState(hasGuest);
  const [error,setError] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  const pending = useRef(false);
  const submit = async () => {
    if (pending.current) return;
    if (!email.trim() || !email.includes('@') || password.length < (register ? 12 : 1) || password.length > 128) {
      setError(t('authInvalidInput')); return;
    }
    pending.current=true;setBusy(true);setError(null);
    try {
      if (register) await session.register(email,password,name,upgrade && hasGuest);
      else await session.login(email,password);
      setPassword('');
    } catch (cause) {
      const status = (cause as {status?:number}).status;
      setError(t(status===401 ? 'authInvalidCredentials' : status===409 ? 'authRegisterConflict' : status===429 ? 'authRateLimited' : 'authTryAgain'));
    } finally { pending.current=false;setBusy(false); }
  };
  // The form sits at the top so the submit button stays above the keyboard.
  return <Page keyboard fill edgeInsets={insets} contentStyle={{ gap:20 }}>
    <StatusBar style="dark" />
    <View style={styles.row}>
      <Tap accessibilityLabel={t('back')} disabled={busy} onPress={() => onMode('choose')} style={styles.back}><IconArrowLeft size={24} color={colors.ink} /></Tap>
    </View>
    <Enter style={{ gap:8 }}>
      <AppText variant="title" accessibilityRole="header">{t(register ? 'authCreateAccount' : 'authWelcome')}</AppText>
      <AppText style={{color:colors.muted}}>{t(register ? 'authRegisterDescription' : 'authDescription')}</AppText>
    </Enter>
    <Enter index={1} style={{ gap:12 }}>
      {register && <Field accessibilityLabel={t('authName')} placeholder={t('authName')} value={name} onChangeText={setName} maxLength={60} editable={!busy} textContentType="name" />}
      <Field accessibilityLabel={t('authEmail')} placeholder={t('authEmail')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" autoComplete="email" maxLength={254} editable={!busy} />
      <Field accessibilityLabel={t('authPassword')} placeholder={t('authPassword')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType={register?'newPassword':'password'} autoComplete={register?'new-password':'current-password'} maxLength={128} editable={!busy} returnKeyType="go" onSubmitEditing={()=>void submit()} />
      {register && <AppText variant="small" style={{color:colors.muted}}>{t('authPasswordHint')}</AppText>}
    </Enter>
    {register && hasGuest && <ActionButton variant="secondary" label={t(upgrade?'authUpgradeSelected':'authUpgradeGuest')} onPress={()=>setUpgrade(!upgrade)} disabled={busy} />}
    {(error || session.error) && <AppText accessibilityRole="alert" style={{color:colors.critical}}>{error ?? (session.errorKind==='network'?t('apiNetworkUnavailable'):t('authTryAgain'))}</AppText>}
    <Enter index={2} style={{ gap:12 }}>
      <ActionButton label={t(register?'authCreateAccount':'authSignIn')} onPress={()=>void submit()} loading={busy} />
      <ActionButton variant="secondary" label={t(register?'authHaveAccount':'authNeedAccount')} disabled={busy} onPress={()=>onMode(register ? 'signin' : 'register')} />
    </Enter>
  </Page>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  back: { width: 44, height: 44, marginLeft: -10 },
  mascotStage: { flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center' },
  textButton: { minHeight: 48, justifyContent: 'center' },
  error: { color: colors.surface, textAlign: 'center' },
});
