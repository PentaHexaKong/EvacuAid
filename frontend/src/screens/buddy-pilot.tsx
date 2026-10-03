import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { ActionButton, AppText, Page } from '@/components/ui';
import { MoreMenu, Segmented } from '@/components/native-controls';
import { useGuestSession } from '@/features/profile/session';
import { buddyRequest } from '@/features/buddy-pilot/api';
import { useBuddyPilot } from '@/features/buddy-pilot/use-buddy-pilot';
import { useBuddyActions } from '@/features/buddy-pilot/use-buddy-actions';
import { useBuddyCopy } from '@/features/buddy-pilot/copy';
import { useInboxNotifications } from '@/features/buddy-pilot/native';
import { BuddiesView } from '@/features/buddy-pilot/ui/buddies-view';
import { NearbyView } from '@/features/buddy-pilot/ui/nearby-view';
import { SessionView } from '@/features/buddy-pilot/ui/session-view';
import { Card } from '@/features/buddy-pilot/ui/parts';
import { colors } from '@/theme';

export function BuddyPilotScreen() {
  const { token, user } = useGuestSession();
  const state = useBuddyPilot(token);
  const { c } = useBuddyCopy();
  if (!token || !user) return <Page><AppText accessibilityRole="alert">{c('requestFailed')}</AppText></Page>;
  if (state.loading) return <Page><ActivityIndicator accessibilityLabel={c('checking')} /></Page>;
  return <BuddyContent key={user.id} token={token} userId={user.id} state={state} />;
}

type Tab = 'buddies' | 'nearby';

function BuddyContent({ token, userId, state }: { token: string; userId: string; state: ReturnType<typeof useBuddyPilot> }) {
  const a = useBuddyActions({ token, userId, state });
  const { c, session, requester, attempt, issue, voice, native, catchNative, setLocalError } = a;
  const [chosenTab, setTab] = useState<Tab>('buddies');
  useInboxNotifications(state.inbox, a.event);
  // A pending GPS offer always surfaces on Nearby; a session the user is part of takes over the tab.
  const tab: Tab = attempt && session?.nearby ? 'nearby' : chosenTab;
  const inSession = Boolean(session && (requester || session.helperUserId === userId));
  const simulate = __DEV__ ? () => catchNative(async () => { await buddyRequest(token, '/dev/simulate-nearby', 'POST', {}); await state.refresh(); }) : undefined;

  return <Page keyboard>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="eyebrow" style={{ color: colors.muted }}>{c('helpOthers')}</AppText>
        <AppText variant="title" accessibilityRole="header">{c('title')}</AppText>
      </View>
      <MoreMenu label={c('more')} items={[
        { label: c('notifications'), onPress: () => catchNative(native.enableNotifications) },
        { label: voice.listening ? c('listening') : c('listen'), onPress: () => { if (voice.listening) voice.stopListening(); else void voice.startListening(); } },
      ]} />
    </View>
    {issue && <Card tint="caution">
      <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{issue}</AppText>
      <ActionButton compact variant="secondary" label={c('retry')} onPress={() => { setLocalError(null); void state.refresh(); }} />
    </Card>}
    {inSession ? <SessionView a={a} token={token} userId={userId} /> : <>
      <Segmented<Tab> value={tab} onChange={setTab} options={[{ value: 'buddies', label: c('myBuddies') }, { value: 'nearby', label: c('nearbyTab') }]} />
      {tab === 'buddies' ? <BuddiesView a={a} userId={userId} /> : <NearbyView a={a} onSimulate={simulate} />}
    </>}
  </Page>;
}
