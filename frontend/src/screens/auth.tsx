import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, Field, Page } from '@/components/ui';
import { GUEST_TOKEN_KEY, useAuthSession } from '@/features/profile/session';
import { colors } from '@/theme';

export function AuthScreen() {
  const { t } = useTranslation();
  const session = useAuthSession();
  const insets = useSafeAreaInsets();
  const [register,setRegister] = useState(false);
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [name,setName] = useState('');
  const [hasGuest,setHasGuest] = useState(false);
  const [upgrade,setUpgrade] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => { void SecureStore.getItemAsync(GUEST_TOKEN_KEY).then(value=>setHasGuest(!!value)).catch(()=>{}); },[]);
  const submit = async () => {
    if (pending.current) return;
    if (!email.trim() || !email.includes('@') || password.length < (register ? 12 : 1) || password.length > 128) {
      setError(t('authInvalidInput')); return;
    }
    pending.current=true;setBusy(true);setError(null);
    try {
      if (register) await session.register(email,password,name,upgrade);
      else await session.login(email,password);
      setPassword('');
    } catch (cause) {
      const status = (cause as {status?:number}).status;
      setError(t(status===401 ? 'authInvalidCredentials' : status===409 ? 'authRegisterConflict' : status===429 ? 'authRateLimited' : 'authTryAgain'));
    } finally { pending.current=false;setBusy(false); }
  };
  // The form sits at the top so the submit button stays above the keyboard.
  return <Page keyboard fill edgeInsets={insets} contentStyle={{ paddingTop:insets.top+40,gap:20 }}>
    <View style={{ gap:8 }}><AppText variant="eyebrow" style={{color:colors.primary}}>EVACUAID</AppText>
      <AppText variant="title" accessibilityRole="header">{t(register ? 'authCreateAccount' : 'authWelcome')}</AppText>
      <AppText style={{color:colors.muted}}>{t('authDescription')}</AppText></View>
    {register && <Field accessibilityLabel={t('authName')} placeholder={t('authName')} value={name} onChangeText={setName} maxLength={60} editable={!busy} textContentType="name" />}
    <Field accessibilityLabel={t('authEmail')} placeholder={t('authEmail')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" autoComplete="email" maxLength={254} editable={!busy} />
    <Field accessibilityLabel={t('authPassword')} placeholder={t('authPassword')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType={register?'newPassword':'password'} autoComplete={register?'new-password':'current-password'} maxLength={128} editable={!busy} returnKeyType="go" onSubmitEditing={()=>void submit()} />
    {register && <AppText variant="small" style={{color:colors.muted}}>{t('authPasswordHint')}</AppText>}
    {register && hasGuest && <ActionButton variant="secondary" label={t(upgrade?'authUpgradeSelected':'authUpgradeGuest')} onPress={()=>setUpgrade(!upgrade)} disabled={busy} />}
    {(error || session.error) && <AppText accessibilityRole="alert" style={{color:colors.critical}}>{error ?? (session.errorKind==='network'?t('apiNetworkUnavailable'):t('authTryAgain'))}</AppText>}
    <ActionButton label={t(register?'authCreateAccount':'authSignIn')} onPress={()=>void submit()} loading={busy} />
    <ActionButton variant="secondary" label={t(register?'authHaveAccount':'authNeedAccount')} disabled={busy} onPress={()=>{setRegister(!register);setPassword('');setError(null);}} />
  </Page>;
}
