import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import IconChevronRight from '@tabler/icons-react-native/IconChevronRight';
import IconPhone from '@tabler/icons-react-native/IconPhone';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText } from '@/components/ui';
import { MoreMenu } from '@/components/native-controls';
import { colors, radius } from '@/theme';
import { relativeTime } from '@/features/hazards/time';
import { relationLabel } from '../copy';
import type { BuddyActions } from '../use-buddy-actions';
import { buddyStyles, Card, Group, PersonAvatar, Row, StatusChip } from './parts';
import { ReceivedInvites, SentInvites } from './friend-card';

// The Buddy page of someone who may need help: who can come, and how to reach them now.
export function BuddiesView({ a }: { a: BuddyActions }) {
  const { state, c, confirm, askForHelp, askNearby } = a;
  const { t } = useTranslation();
  const router = useRouter();
  // One-time links shared before personal codes existed still end here, waiting for the owner to confirm the person.
  const redeemed = state.invitations.filter(item => item.status === 'REDEEMED');
  const first = state.contacts.find(item => item.level === 'PRIMARY') ?? state.contacts[0];
  return <View style={styles.content}>
    <View style={styles.ask}>
      <AppText variant="section" accessibilityRole="header">{c('requestNearbyTitle')}</AppText>
      {first ? <>
        <ActionButton label={c('askBuddy', { name: (first.name ?? c('name')).split(/\s+/)[0] })} loading={state.busy} onPress={() => askForHelp(first.buddyUserId)} />
        <ActionButton variant="secondary" label={c('searchNearby')} disabled={state.busy} onPress={askNearby} />
        <AppText variant="small" style={{ color: colors.muted }}>{c('searchNearbyHint')}</AppText>
      </> : <>
        <AppText style={{ color: colors.muted }}>{c('noBuddyAsk')}</AppText>
        <ActionButton label={c('searchNearby')} loading={state.busy} onPress={askNearby} />
        <ActionButton variant="secondary" label={c('addBuddy')} onPress={() => router.push('/buddy-add')} />
        <Pressable accessibilityRole="link" accessibilityLabel={c('call112')} style={styles.link} onPress={() => { void Linking.openURL('tel:112'); }}>
          <IconPhone size={18} color={colors.primary} /><AppText variant="button" style={{ color: colors.primary }}>{c('call112')}</AppText>
        </Pressable>
      </>}
    </View>

    <ReceivedInvites a={a} />
    {redeemed.map(item => <Card key={item.id} tint="info">
      <StatusChip label={c('friendRequest')} tone="info" />
      <View style={buddyStyles.row}><PersonAvatar name={item.redeemerName} size={48} /><AppText variant="section" style={buddyStyles.grow}>{item.redeemerName ?? c('name')}</AppText></View>
      <View style={buddyStyles.actions}>
        <View style={buddyStyles.grow}><ActionButton variant="secondary" label={c('declineShort')} loading={state.busy} onPress={() => { void state.run(`/invitations/${item.id}`, undefined, 'DELETE'); }} /></View>
        <View style={buddyStyles.grow}><ActionButton label={c('confirmBuddy')} loading={state.busy} onPress={() => confirm(c('confirmPerson'), () => { void state.run(`/invitations/${item.id}/confirm`, {}); }, item.redeemerName ?? c('name'))} /></View>
      </View>
    </Card>)}

    {state.contacts.length > 0 && <View style={styles.section}>
      <AppText variant="section" accessibilityRole="header">{c('myBuddies')}</AppText>
      <Group>{state.contacts.map(contact => {
        const name = contact.name ?? c('name');
        const detail = [contact.available ? c('availableNow') : c('unavailableNow'), contact.level === 'PRIMARY' ? c('primaryLabel') : relationLabel(contact.relation, c)].filter(Boolean).join(' · ');
        return <Row key={contact.id} accessibilityLabel={c('askRow', { name, detail })} onPress={() => askForHelp(contact.buddyUserId)}
          leading={<PersonAvatar name={contact.name} size={44} />}
          title={name}
          detail={<View style={[buddyStyles.row, { gap: 6 }]}>
            <View style={[styles.dot, !contact.available && styles.dotOff]} />
            <AppText variant="small" style={{ color: contact.available ? colors.primary : colors.muted, flexShrink: 1 }}>{detail}</AppText>
          </View>}
          trailing={<MoreMenu label={`${c('more')}: ${name}`} items={[
            ...(contact.level !== 'PRIMARY' ? [{ label: c('primary'), onPress: () => { void state.run(`/contacts/${contact.id}/primary`, {}); } }] : []),
            { label: c('remove'), destructive: true, onPress: () => confirm(c('remove'), () => { void state.run(`/contacts/${contact.id}`, undefined, 'DELETE'); }) },
          ]} />}
        />;
      })}</Group>
    </View>}

    <SentInvites a={a} direction="SEEK_HELP" />

    <View style={styles.section}>
      <AppText variant="section" accessibilityRole="header">{c('inbox')}</AppText>
      {state.inbox.length
        ? <Group>{state.inbox.map(item => {
          const time = relativeTime(item.createdAt);
          const title = item.payload.status ? a.status(item.payload.status) : a.event(item.kind);
          const when = t(time.key, { count: time.count });
          return <Row key={item.id}
            accessibilityLabel={`${title}, ${when}, ${item.read ? c('read') : c('unread')}`}
            leading={<View accessible={false} style={[styles.dot, item.read && { backgroundColor: 'transparent' }]} />}
            title={<AppText variant="button" style={!item.read ? undefined : { fontWeight: '400' }}>{title}</AppText>}
            detail={when}
            trailing={<IconChevronRight size={18} strokeWidth={1.75} color={colors.quiet} />}
            onPress={() => { void state.run(`/inbox/${item.id}/read`, {}).then(() => { if (item.requestId) void state.refresh(item.requestId); }); }}
          />;
        })}</Group>
        : <AppText style={{ color: colors.muted }}>{c('inboxEmpty')}</AppText>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 24 },
  ask: { gap: 12 },
  section: { gap: 10 },
  link: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  dotOff: { backgroundColor: colors.borderStrong },
});
