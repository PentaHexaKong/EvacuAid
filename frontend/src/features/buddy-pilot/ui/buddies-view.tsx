import { Share, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, CheckOption, Field } from '@/components/ui';
import { MoreMenu } from '@/components/native-controls';
import { colors, radius } from '@/theme';
import { relativeTime } from '@/features/hazards/time';
import type { Invitation } from '../api';
import type { BuddyActions } from '../use-buddy-actions';
import { buddyStyles, Card, PersonAvatar, StatusChip } from './parts';
import { IncomingRequestCard } from './incoming-request-card';

export function BuddiesView({ a, userId }: { a: BuddyActions; userId: string }) {
  const { state, c, language, helper, setHelper, message, setMessage, consent, setConsent, invite, setInvite, code, setCode, attempt, session, confirm, startNearby, sendRequest, resetIdempotency } = a;
  const { t } = useTranslation();
  const friendRequests = state.invitations.filter(item => item.status === 'REDEEMED');
  const pendingInvites = state.invitations.filter(item => item.status === 'PENDING');
  return <View style={{ gap: 16 }}>
    {attempt && session && !session.nearby && <IncomingRequestCard a={a} />}

    {friendRequests.map(item => <Card key={item.id} tint="info">
      <StatusChip label={c('friendRequest')} tone="info" />
      <View style={buddyStyles.row}>
        <PersonAvatar name={item.redeemerName} size={44} />
        <View style={buddyStyles.grow}>
          <AppText variant="section">{item.redeemerName ?? c('name')}</AppText>
          {item.redeemerUserId && <AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>ID {item.redeemerUserId.slice(-8)}</AppText>}
        </View>
      </View>
      <View style={buddyStyles.actions}>
        <View style={buddyStyles.grow}><ActionButton compact variant="secondary" label={c('revoke')} onPress={() => { void state.run(`/invitations/${item.id}`, undefined, 'DELETE'); }} /></View>
        <View style={buddyStyles.grow}><ActionButton compact label={c('confirmBuddy')} onPress={() => confirm(c('confirmPerson'), () => { void state.run(`/invitations/${item.id}/confirm`, {}); }, `${item.redeemerName ?? c('name')} · ${item.redeemerUserId?.slice(-8) ?? ''}`)} /></View>
      </View>
    </Card>)}

    <View style={{ gap: 10 }}>
      <AppText variant="section" accessibilityRole="header">{c('trusted')}</AppText>
      {!state.contacts.length && <AppText style={{ color: colors.muted }}>{c('empty')}</AppText>}
      {state.contacts.map(contact => <Card key={contact.id}>
        <View style={buddyStyles.row}>
          <PersonAvatar name={contact.name} />
          <View style={[buddyStyles.grow, { gap: 4 }]}>
            <AppText variant="section">{contact.name ?? c('name')}</AppText>
            <View style={[buddyStyles.row, { gap: 6, flexWrap: 'wrap' }]}>
              <StatusChip dot tone={contact.available ? 'info' : 'neutral'} label={contact.available ? c('availableNow') : c('unavailableNow')} />
              {contact.level === 'PRIMARY' && <StatusChip label={c('primaryLabel')} />}
            </View>
            {contact.observedAt && <AppText variant="small" style={{ color: colors.muted }}>{c('updated')}: {new Date(contact.observedAt).toLocaleTimeString(language)}</AppText>}
          </View>
          <MoreMenu label={`${c('more')}: ${contact.name ?? c('name')}`} items={[
            ...(contact.level !== 'PRIMARY' ? [{ label: c('primary'), onPress: () => { void state.run(`/contacts/${contact.id}/primary`, {}); } }] : []),
            { label: c('remove'), destructive: true, onPress: () => confirm(c('remove'), () => { void state.run(`/contacts/${contact.id}`, undefined, 'DELETE'); }) },
          ]} />
        </View>
        {helper === contact.buddyUserId ? <View style={{ gap: 12 }}>
          <Field accessibilityLabel={c('message')} placeholder={c('message')} value={message} onChangeText={setMessage} multiline maxLength={1000} />
          <CheckOption label={c('consent')} checked={consent} onToggle={setConsent} />
          <View style={buddyStyles.actions}>
            <View style={buddyStyles.grow}><ActionButton compact variant="secondary" label={c('cancel')} onPress={() => setHelper(null)} /></View>
            <View style={buddyStyles.grow}><ActionButton compact label={c('send')} loading={state.busy} onPress={() => { void sendRequest(); }} /></View>
          </View>
        </View> : <ActionButton compact label={c('request')} onPress={() => { setHelper(contact.buddyUserId); resetIdempotency(); }} />}
      </Card>)}
    </View>

    {/* One consent at a time: while an offer waits for an answer, requesting help yourself is hidden. */}
    {!attempt && <Card tint="info">
      <AppText variant="section" accessibilityRole="header">{c('requestNearbyTitle')}</AppText>
      <AppText style={{ color: colors.muted }}>{c('nearbyExplanation')}</AppText>
      <CheckOption label={c('consent')} checked={consent} onToggle={setConsent} />
      <ActionButton label={c('nearby')} loading={state.busy} onPress={() => confirm(c('nearby'), () => { void startNearby(); }, c('nearbyExplanation'))} />
    </Card>}

    {state.incomingContacts?.length > 0 && <View style={{ gap: 10 }}>
      <AppText variant="section" accessibilityRole="header">{c('supporting')}</AppText>
      {state.incomingContacts.map(contact => <Card key={contact.id} style={{ paddingVertical: 12 }}>
        <View style={buddyStyles.row}>
          <PersonAvatar name={contact.name} size={36} />
          <AppText variant="button" style={buddyStyles.grow}>{contact.name ?? c('name')}</AppText>
          <MoreMenu label={`${c('more')}: ${contact.name ?? c('name')}`} items={[{ label: c('remove'), destructive: true, onPress: () => confirm(c('remove'), () => { void state.run(`/contacts/${contact.id}`, undefined, 'DELETE'); }) }]} />
        </View>
      </Card>)}
    </View>}

    <Card>
      <AppText variant="section" accessibilityRole="header">{c('add')}</AppText>
      <AppText style={{ color: colors.muted }}>{c('inviteExplanation')}</AppText>
      <AppText variant="small" selectable style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{c('you')}: {userId.slice(-8)}</AppText>
      {invite?.code
        ? <View style={[buddyStyles.quote, { gap: 10 }]}>
          <AppText variant="figure" selectable style={{ letterSpacing: 1 }}>{invite.code}</AppText>
          <ActionButton compact variant="secondary" label={c('share')} onPress={() => { void Share.share({ message: `EvacuAid Buddy: evacuaid://buddy-invite?code=${encodeURIComponent(invite.code!)}` }); }} />
        </View>
        : <ActionButton compact label={c('create')} loading={state.busy} onPress={() => { void state.run<Invitation>('/invitations', {}).then(result => { if (result) setInvite(result); }); }} />}
      {pendingInvites.map(item => <View key={item.id} style={[buddyStyles.row, { justifyContent: 'space-between' }]}>
        <AppText variant="small" style={{ color: colors.muted, flex: 1 }}>{c('pending')} · {new Date(item.expiresAt).toLocaleString(language)}</AppText>
        <ActionButton compact variant="secondary" label={c('revoke')} onPress={() => { void state.run(`/invitations/${item.id}`, undefined, 'DELETE'); }} />
      </View>)}
      <View style={{ gap: 10, marginTop: 4 }}>
        <AppText variant="button">{c('haveCode')}</AppText>
        <Field accessibilityLabel={c('code')} placeholder={c('code')} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} />
        <ActionButton compact variant="secondary" label={c('redeem')} loading={state.busy} disabled={!code.trim()} onPress={() => { void state.run('/invitations/redeem', { code: code.trim() }).then(result => { if (result) setCode(''); }); }} />
      </View>
    </Card>

    <View style={{ gap: 10 }}>
      <AppText variant="section" accessibilityRole="header">{c('inbox')}</AppText>
      {!state.inbox.length && <AppText style={{ color: colors.muted }}>{c('inboxEmpty')}</AppText>}
      {state.inbox.map(item => {
        const time = relativeTime(item.createdAt);
        return <Card key={item.id} style={{ paddingVertical: 12 }}>
          <View style={buddyStyles.row}>
            {!item.read && <View accessible={false} style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.primary }} />}
            <View style={buddyStyles.grow}>
              <AppText variant="button">{item.payload.status ? a.status(item.payload.status) : a.event(item.kind)}</AppText>
              <AppText variant="small" style={{ color: colors.muted }}>{t(time.key, { count: time.count })} · {item.read ? c('read') : c('unread')}</AppText>
            </View>
            <ActionButton compact variant="secondary" label={c('open')} onPress={() => { void state.run(`/inbox/${item.id}/read`, {}).then(() => { if (item.requestId) void state.refresh(item.requestId); }); }} />
          </View>
        </Card>;
      })}
    </View>
  </View>;
}
