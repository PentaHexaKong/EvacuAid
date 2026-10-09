import { Platform, Share, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ActionButton, AppText } from '@/components/ui';
import { MoreMenu } from '@/components/native-controls';
import { colors, radius } from '@/theme';
import buddyArt from '../../../../assets/brand/quick/buddy.png';
import { relationLabel } from '../copy';
import type { BuddyActions } from '../use-buddy-actions';
import { buddyStyles, EmptyCard, Group, PersonAvatar, Row } from './parts';
import { CodeRow, FriendCard, ReceivedInvites } from './friend-card';

export function FriendsView({ a, code }: { a: BuddyActions; code: string | null }) {
  const { state, c, support, session, attempt, active, confirm, catchNative } = a;
  const router = useRouter();
  const sent = state.invitations.filter(item => item.status === 'SENT' && item.direction === 'OFFER_HELP');
  const offer = attempt && session && !session.nearby;
  // A friend who is asking for help is the card at the top, so they are not repeated in the list.
  const listed = state.incomingContacts.filter(contact => !offer || contact.userId !== session.requesterUserId);
  const empty = !state.incomingContacts.length && !state.received.length && !sent.length && !offer;
  const share = () => { if (code) catchNative(() => Share.share({ message: c('shareMessage', { code }) })); };
  const details = (needs?: string[], relation?: Parameters<typeof relationLabel>[0]) => [...(needs ?? []).map(support), relationLabel(relation, c)].filter(Boolean).join(' · ');
  return <View style={styles.content}>
    {offer && <FriendCard a={a} />}
    <ReceivedInvites a={a} />
    {listed.length > 0 && <View style={styles.section}>
      <AppText variant="section" accessibilityRole="header">{c('friendsHeading')}</AppText>
      <Group>{listed.map(contact => {
        const helping = active && session?.requesterUserId === contact.userId;
        return <Row key={contact.id} leading={<PersonAvatar name={contact.name} size={44} />} title={contact.name ?? c('name')}
          detail={helping ? <View style={[buddyStyles.row, { gap: 6 }]}><View style={styles.dot} /><AppText style={{ color: colors.primary }}>{c('inSession')}</AppText></View> : <AppText style={{ color: colors.muted }}>{details(contact.needs, contact.relation)}</AppText>}
          onPress={helping ? () => { void state.refresh(session.id); } : undefined}
          trailing={<MoreMenu label={`${c('more')}: ${contact.name ?? c('name')}`} items={[{ label: c('remove'), destructive: true, onPress: () => confirm(c('remove'), () => { void state.run(`/contacts/${contact.id}`, undefined, 'DELETE'); }) }]} />}
        />;
      })}</Group>
      <AppText variant="small" style={{ color: colors.muted }}>{c('friendsFootnote')}</AppText>
    </View>}
    {sent.length > 0 && <View style={styles.section}>
      <AppText variant="section" accessibilityRole="header">{c('sentHeading')}</AppText>
      <Group>{sent.map(item => <Row key={item.id} leading={<PersonAvatar name={item.redeemerName} size={44} />} title={item.redeemerName ?? c('name')} detail={c('sentDetail')}
        trailing={<ActionButton compact variant="secondary" label={c('cancelInvite')} loading={state.busy} onPress={() => { void state.run(`/invitations/${item.id}`, undefined, 'DELETE'); }} />}
      />)}</Group>
    </View>}
    {empty ? <EmptyCard title={c('noFriendsTitle')} body={c('noFriendsBody')} art={buddyArt}>
      {code && <View style={[buddyStyles.quote, styles.codeBlock]}><AppText variant="figure" selectable style={styles.code}>{code}</AppText></View>}
      <ActionButton label={c('shareCode')} disabled={!code} onPress={share} />
      <ActionButton variant="secondary" label={c('addBuddy')} onPress={() => router.push('/buddy-add')} />
    </EmptyCard> : code && <CodeRow a={a} code={code} />}
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  section: { gap: 10 },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  codeBlock: { backgroundColor: colors.canvas, alignItems: 'center' },
  code: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), letterSpacing: 0, fontVariant: ['tabular-nums'] },
});
