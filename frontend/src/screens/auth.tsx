import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Google from 'expo-auth-session/providers/google';
import { IconArrowLeft, IconBrandGoogle, IconCheck, IconEye, IconEyeOff } from '@tabler/icons-react-native';
import { AppText } from '@/components/ui';
import { ApiError } from '@/features/auth/client';
import { useAuth } from '@/features/auth/context';
import { colors, radius, useTypography } from '@/theme';

type AuthError = 'name' | 'email' | 'password' | 'credentials' | 'conflict' | 'google' | 'googleUnavailable' | 'googleCancelled' | 'generic' | null;

const emailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

function errorKey(error: unknown): AuthError {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'credentials';
    if (error.status === 409) return 'conflict';
  }
  return 'generic';
}

function AuthPage({ eyebrow, title, body, children }: { eyebrow: string; title: string; body: string; children: ReactNode }) {
  const router = useRouter();
  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : undefined} style={styles.back}><IconArrowLeft size={20} color={colors.ink} /></Pressable>
      <View style={styles.heading}><AppText variant="eyebrow" style={{ color: colors.primary }}>{eyebrow}</AppText><AppText variant="title" accessibilityRole="header" style={styles.title}>{title}</AppText><AppText style={styles.body}>{body}</AppText></View>
      {children}
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}

function Field({ label, value, onChangeText, secure = false, keyboard = 'default', hint, error }: { label: string; value: string; onChangeText: (value: string) => void; secure?: boolean; keyboard?: 'default' | 'email-address'; hint?: string; error?: string | null }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(secure);
  const typography = useTypography('body');
  return <View style={styles.field}><AppText variant="small" style={styles.label}>{label}</AppText><View style={[styles.inputShell, error && styles.inputError]}><TextInput value={value} onChangeText={onChangeText} style={[typography, styles.input]} autoCapitalize="none" autoCorrect={false} keyboardType={keyboard} secureTextEntry={secure && hidden} accessibilityLabel={label} />
    {secure && <Pressable accessibilityRole="button" accessibilityLabel={hidden ? t('authShowPassword') : t('authHidePassword')} onPress={() => setHidden(!hidden)} hitSlop={10} style={styles.eye}>{hidden ? <IconEye size={20} color={colors.muted} /> : <IconEyeOff size={20} color={colors.muted} />}</Pressable>}
  </View>{error ? <AppText accessibilityRole="alert" variant="small" style={styles.error}>{error}</AppText> : hint ? <AppText variant="small" style={styles.hint}>{hint}</AppText> : null}</View>;
}

function Divider() {
  const { t } = useTranslation();
  return <View style={styles.divider}><View style={styles.dividerLine} /><AppText variant="small" style={styles.dividerText}>{t('authDivider')}</AppText><View style={styles.dividerLine} /></View>;
}

function PrimaryButton({ label, onPress, loading = false }: { label: string; onPress: () => void; loading?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: loading, busy: loading }} disabled={loading} onPress={onPress} style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed, loading && styles.disabled]}>{loading ? <ActivityIndicator color={colors.surface} /> : <AppText variant="button" style={styles.primaryText}>{label}</AppText>}</Pressable>;
}

function GoogleButton({ rememberMe, disabled, onError }: { rememberMe: boolean; disabled?: boolean; onError: (error: AuthError) => void }) {
  const { t } = useTranslation();
  const { loginGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const handledResponse = useRef<typeof response>(null);
  const configured = Boolean(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || 'missing-client-id',
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || 'missing-client-id',
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || 'missing-client-id',
  });
  useEffect(() => {
    if (!response) return;
    if (handledResponse.current === response) return;
    handledResponse.current = response;
    if (response.type === 'dismiss' || response.type === 'cancel') { onError('googleCancelled'); return; }
    if (response.type !== 'success') { onError('google'); return; }
    const idToken = response.params.id_token;
    if (!idToken) { onError('google'); return; }
    void (async () => {
      setBusy(true);
      try { await loginGoogle(idToken, rememberMe); }
      catch (error) { onError(errorKey(error)); }
      finally { setBusy(false); }
    })();
  }, [loginGoogle, onError, rememberMe, response]);
  const press = async () => {
    if (!configured || !request) { onError('googleUnavailable'); return; }
    onError(null);
    await promptAsync();
  };
  return <Pressable accessibilityRole="button" accessibilityLabel={t('authGoogle')} accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={() => void press()} style={({ pressed }) => [styles.google, pressed && styles.googlePressed, (disabled || busy) && styles.disabled]}>{busy ? <ActivityIndicator color={colors.primary} /> : <><IconBrandGoogle size={18} color={colors.primary} /><AppText variant="button" style={styles.googleText}>{t('authGoogle')}</AppText></>}</Pressable>;
}

function FormError({ error }: { error: AuthError }) {
  const { t } = useTranslation();
  if (!error || ['name', 'email', 'password'].includes(error)) return null;
  const key = error === 'credentials' ? 'authCredentialsInvalid'
    : error === 'conflict' ? 'authEmailPasswordConflict'
      : error === 'googleUnavailable' ? 'authGoogleUnavailable'
        : error === 'googleCancelled' ? 'authGoogleCancelled'
          : error === 'google' ? 'authGoogleFailed' : 'authRequestFailed';
  return <AppText accessibilityRole="alert" style={styles.error}>{t(key)}</AppText>;
}

function AccountLink({ before, action, href }: { before: string; action: string; href: '/auth/login' | '/auth/register' }) {
  const router = useRouter();
  return <View style={styles.accountLink}><AppText variant="small" style={styles.hint}>{before}</AppText><Pressable accessibilityRole="link" onPress={() => router.replace(href)} hitSlop={8}><AppText variant="small" style={styles.link}>{action}</AppText></Pressable></View>;
}

export function RegisterScreen() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<AuthError>(null);
  const submit = async () => {
    if (!name.trim()) { setError('name'); return; }
    if (!emailValid(email)) { setError('email'); return; }
    if (password.length < 12) { setError('password'); return; }
    setBusy(true); setError(null);
    try { await register({ name: name.trim(), email: email.trim(), password, rememberMe: true }); }
    catch (next) { setError(errorKey(next)); }
    finally { setBusy(false); }
  };
  return <AuthPage eyebrow={t('authCreateEyebrow')} title={t('authCreateTitle')} body={t('authCreateBody')}><View style={styles.form}>
    <GoogleButton rememberMe onError={setError} disabled={busy} /><Divider />
    <Field label={t('authName')} value={name} onChangeText={setName} error={error === 'name' ? t('authNameRequired') : null} />
    <Field label={t('authEmail')} value={email} onChangeText={setEmail} keyboard="email-address" error={error === 'email' ? t('authInvalidEmail') : null} />
    <Field label={t('authPassword')} value={password} onChangeText={setPassword} secure hint={t('authPasswordHint')} error={error === 'password' ? t('authPasswordRule') : null} />
    <FormError error={error} /><PrimaryButton label={t('authRegister')} onPress={() => void submit()} loading={busy} /><AccountLink before={t('authHaveAccount')} action={t('authSignInLink')} href="/auth/login" />
  </View></AuthPage>;
}

export function LoginScreen() {
  const { t } = useTranslation(); const router = useRouter(); const { login } = useAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [rememberMe, setRememberMe] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<AuthError>(null);
  const submit = async () => {
    if (!emailValid(email)) { setError('email'); return; }
    if (!password) { setError('password'); return; }
    setBusy(true); setError(null);
    try { await login({ email: email.trim(), password, rememberMe }); }
    catch (next) { setError(errorKey(next)); }
    finally { setBusy(false); }
  };
  return <AuthPage eyebrow={t('authLoginEyebrow')} title={t('authLoginTitle')} body={t('authLoginBody')}><View style={styles.form}>
    <Field label={t('authEmail')} value={email} onChangeText={setEmail} keyboard="email-address" error={error === 'email' ? t('authInvalidEmail') : null} />
    <Field label={t('authPassword')} value={password} onChangeText={setPassword} secure error={error === 'password' ? t('authPasswordRule') : null} />
    <View style={styles.loginTools}><Pressable accessibilityRole="checkbox" accessibilityLabel={t('authRemember')} accessibilityState={{ checked: rememberMe }} onPress={() => setRememberMe(!rememberMe)} style={styles.remember}><View style={[styles.check, rememberMe && styles.checkOn]}>{rememberMe && <IconCheck size={14} color={colors.surface} />}</View><AppText variant="small">{t('authRemember')}</AppText></Pressable><Pressable accessibilityRole="link" onPress={() => router.push('/auth/forgot-password')}><AppText variant="small" style={styles.link}>{t('authForgot')}</AppText></Pressable></View>
    <FormError error={error} /><PrimaryButton label={t('authLogin')} onPress={() => void submit()} loading={busy} /><Divider /><GoogleButton rememberMe={rememberMe} onError={setError} disabled={busy} /><AccountLink before={t('authNoAccount')} action={t('authCreateLink')} href="/auth/register" />
  </View></AuthPage>;
}

export function ForgotPasswordScreen() {
  const { t } = useTranslation(); const router = useRouter(); const { requestReset } = useAuth();
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false); const [error, setError] = useState<AuthError>(null);
  const submit = async () => {
    if (!emailValid(email)) { setError('email'); return; }
    setBusy(true); setError(null);
    try { await requestReset(email.trim()); setSent(true); }
    catch (next) { setError(errorKey(next)); }
    finally { setBusy(false); }
  };
  if (sent) return <AuthPage eyebrow={t('authForgot')} title={t('authResetSentTitle')} body={t('authResetSentBody')}><View style={styles.form}><PrimaryButton label={t('authBackToLogin')} onPress={() => router.replace('/auth/login')} /></View></AuthPage>;
  return <AuthPage eyebrow={t('authForgot')} title={t('authResetTitle')} body={t('authResetBody')}><View style={styles.form}><Field label={t('authEmail')} value={email} onChangeText={setEmail} keyboard="email-address" error={error === 'email' ? t('authInvalidEmail') : null} /><FormError error={error} /><PrimaryButton label={t('authSendReset')} onPress={() => void submit()} loading={busy} /><AccountLink before="" action={t('authBackToLogin')} href="/auth/login" /></View></AuthPage>;
}

export function ResetPasswordScreen() {
  const { t } = useTranslation(); const router = useRouter(); const { resetPassword } = useAuth(); const { token } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<AuthError>(null); const [done, setDone] = useState(false);
  const submit = async () => {
    if (!token) { setError('generic'); return; }
    if (password.length < 12) { setError('password'); return; }
    if (password !== confirm) { setError('credentials'); return; }
    setBusy(true); setError(null);
    try { await resetPassword(token, password); setDone(true); }
    catch (next) { setError(errorKey(next)); }
    finally { setBusy(false); }
  };
  if (done) return <AuthPage eyebrow={t('authResetTitle')} title={t('authPasswordUpdated')} body={t('authPasswordResetSuccess')}><View style={styles.form}><PrimaryButton label={t('authBackToLogin')} onPress={() => router.replace('/auth/login')} /></View></AuthPage>;
  return <AuthPage eyebrow={t('authResetTitle')} title={t('authResetPasswordTitle')} body={t('authResetPasswordBody')}><View style={styles.form}>
    {!token && <AppText accessibilityRole="alert" style={styles.error}>{t('authResetTokenMissing')}</AppText>}
    <Field label={t('authNewPassword')} value={password} onChangeText={setPassword} secure error={error === 'password' ? t('authPasswordRule') : null} />
    <Field label={t('authConfirmPassword')} value={confirm} onChangeText={setConfirm} secure error={error === 'credentials' ? t('authPasswordsMismatch') : null} />
    {error === 'generic' && <AppText accessibilityRole="alert" style={styles.error}>{t('authRequestFailed')}</AppText>}<PrimaryButton label={t('authSetPassword')} onPress={() => void submit()} loading={busy} />
  </View></AuthPage>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas }, flex: { flex: 1 }, scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32, gap: 28 }, back: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start', marginTop: 4 }, heading: { gap: 8 }, title: { fontSize: 30, lineHeight: 36, letterSpacing: -0.5 }, body: { color: colors.muted, maxWidth: 330 }, form: { gap: 14 }, field: { gap: 7 }, label: { color: colors.ink, fontWeight: '600' }, inputShell: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.input, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center' }, inputError: { borderColor: colors.critical }, input: { flex: 1, color: colors.ink, paddingHorizontal: 16, paddingVertical: 12, minHeight: 50 }, eye: { padding: 14 }, hint: { color: colors.muted }, error: { color: colors.critical }, primary: { minHeight: 52, borderRadius: radius.input, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.primary, paddingHorizontal: 20 }, primaryPressed: { backgroundColor: colors.ink }, primaryText: { color: colors.surface }, google: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.input, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20 }, googlePressed: { backgroundColor: colors.canvas }, googleText: { color: colors.ink }, disabled: { opacity: 0.55 }, divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 2 }, dividerLine: { flex: 1, height: 1, backgroundColor: colors.border }, dividerText: { color: colors.muted }, accountLink: { flexDirection: 'row', justifyContent: 'center', gap: 4, paddingVertical: 6 }, link: { color: colors.primary, fontWeight: '700' }, loginTools: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, remember: { flexDirection: 'row', alignItems: 'center', gap: 8 }, check: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface }, checkOn: { borderColor: colors.primary, backgroundColor: colors.primary },
});
