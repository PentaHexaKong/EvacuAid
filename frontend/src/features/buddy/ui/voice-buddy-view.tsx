import { Linking, Pressable, View } from 'react-native';
import IconPhone from '@tabler/icons-react-native/IconPhone';
import { ActionButton, AppText } from '@/components/ui';
import { SpeakButton } from '@/components/speak-button';
import { useAccess } from '@/features/access/use-access';
import { terminalStatuses } from '@/features/buddy/api';
import { BeaconWaiting } from './beacon-panel';
import { SessionRequesterActions } from './session-requester-actions';
import { ArrivalCard, HelperPrototype, SessionPrototype } from './session-link';
import type { BuddyActions } from '@/features/buddy/use-buddy-actions';
import { colors } from '@/theme';

export function VoiceBuddyView({ a, token }: { a: BuddyActions; token: string }) {
  const { c, state, session, voice, guidance } = a;
  const access = useAccess();
  const first = state.contacts.find(item => item.level === 'PRIMARY') ?? state.contacts[0];
  const hint = c(session?.status === 'COMPLETION_PENDING' && a.requester ? 'voiceBuddyHintArrived' : session ? 'voiceBuddyHintSession' : 'voiceBuddyHintIdle');
  return <View style={{ gap: 16 }}>
    <AppText variant="section" accessibilityRole="header">{c('voiceBuddyTitle')}</AppText>
    <AppText variant="title" accessibilityLiveRegion="polite">{a.voiceStatusText}</AppText>
    {access.listen && !access.soundFree && <SpeakButton listening={voice.listening} label={c(voice.listening ? 'voiceBuddyListening' : 'voiceBuddyMic')} detail="" hint={hint} onPress={a.toggleVoice} />}
    <AppText variant="small" style={{ color: colors.muted }}>{hint}</AppText>
    {(a.localSos || (session?.nearby && session.status === 'WAITING')) && <BeaconWaiting a={a} />}
    {session ? <>
      <SessionRequesterActions a={a} />
      {/* Saying "safe" works too; the button is for anyone who would rather tap. */}
      <ArrivalCard a={a} />
      <SessionPrototype a={a} token={token} />
      {terminalStatuses.has(session.status) ? <ActionButton label={c('close')} onPress={state.dismissSession} /> : (!access.listen || access.soundFree) && <ActionButton variant="secondary" label={c('interrupt')} loading={state.busy} onPress={() => a.confirm(c('interrupt'), () => { void a.transition('interrupt'); }, c('endBody'))} />}
      {guidance.instruction && <AppText variant="title">{guidance.instruction}</AppText>}
      {access.listen && !access.soundFree && <ActionButton label={c('readStatus')} onPress={a.readVoiceStatus} />}
    </> : <>
      <ActionButton label={first ? c('askBuddy', { name: (first.name ?? c('name')).split(/\s+/)[0] }) : c('searchNearby')} loading={state.busy} onPress={() => first ? a.askForHelp(first.buddyUserId) : a.askNearby()} />
      <Pressable accessibilityRole="link" accessibilityLabel={c('call112')} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }} onPress={() => { void Linking.openURL('tel:112'); }}>
        <IconPhone size={18} color={colors.primary} /><AppText variant="button" style={{ color: colors.primary }}>{c('call112')}</AppText>
      </Pressable>
      <HelperPrototype a={a} token={token} />
    </>}
  </View>;
}
