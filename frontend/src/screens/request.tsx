import { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, Page, Panel } from '@/components/ui';
import { EmptyContent, SampleNotice, SectionTitle } from '@/components/content';
import { sampleContacts } from '@/features/content/samples';
import { canReviewRequest, emptyDraft, useRequestDraft } from '@/features/requests/draft';
import { usePreferences } from '@/features/preferences/context';
import { colors, radius, useTypography } from '@/theme';

export function RequestScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { draft, setDraft } = useRequestDraft();
  const { preferences } = usePreferences();
  const [invalid, setInvalid] = useState(false);
  const bodyStyle = useTypography('body');
  const contact = sampleContacts.find(item => item.id === draft.contactId);
  const discard = () => Alert.alert(t('discardTitle'), t('discardBody'), [{ text: t('cancel'), style: 'cancel' }, { text: t('discard'), style: 'destructive', onPress: () => { setDraft(emptyDraft); router.navigate('/buddy'); } }]);
  if (!contact) return <Page><EmptyContent message="chooseContact" /><ActionButton label={t('buddyTitle')} onPress={() => router.navigate('/buddy')} /></Page>;
  return <Page keyboard><SampleNotice />
    <View style={{ gap: 4 }}><AppText variant="small" style={{ color: colors.muted }}>{t('recipient')}</AppText><SectionTitle>{contact.name}</SectionTitle></View>
    <View style={{ gap: 12 }}><AppText variant="button" nativeID="request-message-label">{t('requestMessage')}</AppText>
      <TextInput accessibilityLabel={t('requestMessage')} accessibilityLabelledBy="request-message-label" multiline textAlignVertical="top" value={draft.message} onChangeText={message => { setDraft({ ...draft, message }); setInvalid(false); }} placeholder={t('requestPlaceholder')} placeholderTextColor={preferences.strongerContrast ? colors.ink : colors.muted} style={[bodyStyle, { minHeight: 160, padding: 16, borderWidth: 1, borderColor: invalid ? colors.critical : colors.border, borderRadius: radius.input, backgroundColor: colors.surface }, preferences.largerText && { fontSize: 19.2, lineHeight: 28.8 }]} />
      {invalid && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('messageRequired')}</AppText>}
      <AppText variant="small" style={{ color: colors.muted }}>{t('draftOnly')}</AppText>
    </View>
    <ActionButton label={t('reviewRequest')} onPress={() => { if (!canReviewRequest(draft)) { setInvalid(true); return; } router.push('/request/review'); }} />
    <ActionButton variant="secondary" label={t('discard')} onPress={discard} />
  </Page>;
}
export function RequestReviewScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { draft } = useRequestDraft();
  const contact = sampleContacts.find(item => item.id === draft.contactId);
  if (!contact || !canReviewRequest(draft)) return <Page><EmptyContent message="requestIncomplete" /><ActionButton label={t('editRequest')} onPress={() => router.replace('/request')} /></Page>;
  return <Page><SampleNotice /><Panel><AppText variant="small" style={{ color: colors.muted }}>{t('recipient')}</AppText><SectionTitle>{contact.name}</SectionTitle><AppText selectable>{draft.message.trim()}</AppText></Panel>
    <View style={{ gap: 8 }}><SectionTitle>{t('sendingUnavailable')}</SectionTitle><AppText style={{ color: colors.muted }}>{t('sendingExplanation')}</AppText></View>
    <ActionButton disabled label={t('sendRequest')} /><ActionButton variant="secondary" label={t('editRequest')} onPress={() => router.dismissTo('/request')} /><AppText variant="small" style={{ color: colors.muted }}>{t('sharingOff')}</AppText>
  </Page>;
}
