import { Switch, Platform, Share, StyleSheet, View } from 'react-native';
import IconChevronRight from '@tabler/icons-react-native/IconChevronRight';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, Field } from '@/components/ui';
import { MoreMenu } from '@/components/native-controls';
import { colors, radius } from '@/theme';
import { relativeTime } from '@/features/hazards/time';
import type { Invitation } from '../api';
import type { BuddyActions } from '../use-buddy-actions';
import buddyArt from '../../../../assets/brand/quick/buddy.png';
import { buddyStyles, Card, EmptyCard, Group, PersonAvatar, Row, StatusChip } from './parts';
import { IncomingRequestCard } from './incoming-request-card';
import { CodeRow, ReceivedInvites } from './friend-card';

export function BuddiesView({ a, userId, buddyCode }: { a: BuddyActions; userId: string; buddyCode?: string | null }) {
  const { state, c, language, helper, setHelper, message, setMessage, consent, setConsent, invite, setInvite, code, setCode, attempt, session, confirm, startNearby, sendRequest, resetIdempotency } = a;
  const { t } = useTranslation();
  const friendRequests = state.invitations.filter(item => item.status === 'REDEEMED');
  const pendingInvites = state.invitations.filter(item => item.status === 'PENDING');
  const empty = !state.contacts.length;
  const inviteBody = <>
    {invite?.code
      ? <View style={[buddyStyles.quote, { gap: 10, backgroundColor: colors.canvas }]}>
        <AppText variant="figure" selectable numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.code}>{invite.code}</AppText>
        <ActionButton compact variant="secondary" label={c('share')} onPress={() => { void Share.share({ message: `EvacuAid Buddy: evacuaid://buddy-invite?code=${encodeURIComponent(invite.code!)}` }); }} />
        {empty && <AppText variant="small" style={{ color: colors.muted }}>{c('inviteExplanation')}</AppText>}
      </View>
      : <ActionButton compact variant={empty ? 'primary' : 'secondary'} label={c('create')} loading={state.busy} onPress={() => { void state.run<Invitation>('/invitations', {}).then(result => { if (result) setInvite(result); }); }} />}
    {pendingInvites.map(item => <View key={item.id} style={[buddyStyles.row, { justifyContent: 'space-between' }]}>
      <AppText variant="small" style={{ color: colors.muted, flex: 1 }}>{c('pending')} · {new Date(item.expiresAt).toLocaleString(language)}</AppText>
      <ActionButton compact variant="secondary" label={c('revoke')} onPress={() => { void state.run(`/invitations/${item.id}`, undefined, 'DELETE'); }} />
    </View>)}
    <View style={styles.divider} />
    <View style={{ gap: 10 }}>
      <AppText variant="button">{c('haveCode')}</AppText>
      <Field accessibilityLabel={c('code')} placeholder={c('code')} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} />
      <ActionButton compact variant="secondary" label={c('redeem')} loading={state.busy} disabled={!code.trim()} onPress={() => { void state.run('/invitations/redeem', { code: code.trim() }).then(result => { if (result) setCode(''); }); }} />
    </View>
    {/* The inviter confirms a redeemer by this ID, so it stays visible, but as a footnote. */}
    <AppText variant="small" selectable style={{ color: colors.quiet, fontVariant: ['tabular-nums'] }}>{c('you')} · ID {userId.slice(-8)}</AppText>
  </>;
  const addBuddy = empty
    ? <EmptyCard title={c('emptyTitle')} body={c('emptyBody')} art={buddyArt}>{inviteBody}</EmptyCard>
    : <Card>
      <View style={{ gap: 4 }}>
        <AppText variant="section" accessibilityRole="header">{c('add')}</AppText>
        <AppText style={{ color: colors.muted }}>{c('inviteExplanation')}</AppText>
      </View>
      {inviteBody}
    </Card>;
  return <View style={{ gap: 16 }}>
    {attempt && session && !session.nearby && <IncomingRequestCard a={a} />}
    <ReceivedInvites a={a} />

    {friendRequests.map(item => <Card key={item.id}>
      <StatusChip label={c('friendRequest')} tone="info" />
      <View style={buddyStyles.row}>
        <PersonAvatar name={item.redeemerName} size={44} />
        <View style={buddyStyles.grow}>
          <AppText variant="section">{item.redeemerName ?? c('name')}</AppText>
          {item.redeemerUserId && <AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>ID {item.redeemerUserId.slice(-8)}</AppText>}
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <ActionButton label={c('confirmBuddy')} onPress={() => confirm(c('confirmPerson'), () => { void state.run(`/invitations/${item.id}/confirm`, {}); }, `${item.redeemerName ?? c('name')} · ${item.redeemerUserId?.slice(-8) ?? ''}`)} />
        <ActionButton compact variant="secondary" label={c('revoke')} onPress={() => { void state.run(`/invitations/${item.id}`, undefined, 'DELETE'); }} />
      </View>
    </Card>)}

    {!empty ? <View style={{ gap: 10 }}>
      <AppText variant="section" accessibilityRole="header">{c('trusted')}</AppText>
      <Group>{state.contacts.map(contact => <View key={contact.id}>
        <Row
          leading={<PersonAvatar name={contact.name} size={44} />}
          title={contact.name ?? c('name')}
          detail={<View style={[buddyStyles.row, { gap: 6 }]}>
            <View style={[styles.presence, { backgroundColor: contact.available ? colors.primary : colors.borderStrong }]} />
            <AppText variant="small" style={{ color: contact.available ? colors.primary : colors.muted, flexShrink: 1 }}>{[contact.available ? c('availableNow') : c('unavailableNow'), contact.level === 'PRIMARY' ? c('primaryLabel') : null].filter(Boolean).join(' · ')}</AppText>
          </View>}
          trailing={<MoreMenu label={`${c('more')}: ${contact.name ?? c('name')}`} items={[
            ...(contact.level !== 'PRIMARY' ? [{ label: c('primary'), onPress: () => { void state.run(`/contacts/${contact.id}/primary`, {}); } }] : []),
            { label: c('remove'), destructive: true, onPress: () => confirm(c('remove'), () => { void state.run(`/contacts/${contact.id}`, undefined, 'DELETE'); }) },
          ]} />}
        />
        <View style={[styles.rowFooter, helper === contact.buddyUserId && { paddingLeft: 16 }]}>
          {contact.observedAt && <AppText variant="small" style={{ color: colors.muted }}>{c('updated')}: {new Date(contact.observedAt).toLocaleTimeString(language)}</AppText>}
          {helper === contact.buddyUserId ? <View style={{ gap: 12 }}>
            <Field accessibilityLabel={c('message')} placeholder={c('message')} value={message} onChangeText={setMessage} multiline maxLength={1000} />
            <View style={[buddyStyles.row, { gap: 12 }]}><AppText style={buddyStyles.grow}>{c('consent')}</AppText><Switch style={{ alignSelf: 'center' }} accessibilityLabel={c('consent')} value={consent} trackColor={{ true: colors.primary }} onValueChange={setConsent} /></View>
            <ActionButton label={c('send')} loading={state.busy} onPress={() => { void sendRequest(); }} />
            <ActionButton compact variant="secondary" label={c('cancel')} onPress={() => setHelper(null)} />
          </View> : <ActionButton compact variant="secondary" label={c('request')} onPress={() => { setHelper(contact.buddyUserId); resetIdempotency(); }} />}
        </View>
      </View>)}</Group>
    </View> : addBuddy}

    {/* One consent at a time: hidden while an offer waits for an answer or a Buddy request is being written. */}
    {!attempt && !helper && <Card>
      <View style={{ gap: 4 }}>
        <AppText variant="section" accessibilityRole="header">{c('requestNearbyTitle')}</AppText>
        <AppText style={{ color: colors.muted }}>{c('nearbyExplanation')}</AppText>
      </View>
      <View style={[buddyStyles.row, { gap: 12 }]}><AppText style={buddyStyles.grow}>{c('consent')}</AppText><Switch style={{ alignSelf: 'center' }} accessibilityLabel={c('consent')} value={consent} trackColor={{ true: colors.primary }} onValueChange={setConsent} /></View>
      <ActionButton label={c('nearby')} loading={state.busy} onPress={() => confirm(c('nearby'), () => { void startNearby(); }, c('nearbyExplanation'))} />
    </Card>}

    {state.incomingContacts?.length > 0 && <View style={styles.section}>
      <AppText variant="section" accessibilityRole="header">{c('supporting')}</AppText>
      <Group>{state.incomingContacts.map(contact => <Row key={contact.id}
        leading={<PersonAvatar name={contact.name} size={36} />}
        title={contact.name ?? c('name')}
        trailing={<MoreMenu label={`${c('more')}: ${contact.name ?? c('name')}`} items={[{ label: c('remove'), destructive: true, onPress: () => confirm(c('remove'), () => { void state.run(`/contacts/${contact.id}`, undefined, 'DELETE'); }) }]} />}
      />)}</Group>
    </View>}

    {!empty && addBuddy}

    <View style={styles.section}>
      <AppText variant="section" accessibilityRole="header">{c('inbox')}</AppText>
      {state.inbox.length
        ? <Group>{state.inbox.map(item => {
          const time = relativeTime(item.createdAt);
          const title = item.payload.status ? a.status(item.payload.status) : a.event(item.kind);
          const when = t(time.key, { count: time.count });
          return <Row key={item.id}
            accessibilityLabel={`${title}, ${when}, ${item.read ? c('read') : c('unread')}`}
            leading={<View accessible={false} style={[styles.unread, item.read && { backgroundColor: 'transparent' }]} />}
            title={<AppText variant="button" style={!item.read ? undefined : { fontWeight: '400' }}>{title}</AppText>}
            detail={when}
            trailing={<IconChevronRight size={18} strokeWidth={1.75} color={colors.quiet} />}
            onPress={() => { void state.run(`/inbox/${item.id}/read`, {}).then(() => { if (item.requestId) void state.refresh(item.requestId); }); }}
          />;
        })}</Group>
        : <AppText style={{ color: colors.muted }}>{c('inboxEmpty')}</AppText>}
    </View>
    {buddyCode && <CodeRow a={a} code={buddyCode} />}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 8 },
  rowFooter: { gap: 10, paddingHorizontal: 16, paddingBottom: 14, paddingLeft: 72 },
  presence: { width: 8, height: 8, borderRadius: radius.pill },
  unread: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  // Monospaced so people typing the code can tell l from I and 0 from O.
  code: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 26, lineHeight: 32, letterSpacing: 0 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
});
