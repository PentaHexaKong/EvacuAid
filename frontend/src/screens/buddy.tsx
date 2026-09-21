import { Alert, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, Page, Panel } from '@/components/ui';
import { ContentRow, EmptyContent, SampleNotice, SectionTitle } from '@/components/content';
import { sampleContacts } from '@/features/content/samples';
import { useRequestDraft } from '@/features/requests/draft';
import { colors } from '@/theme';

export function BuddyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { draft } = useRequestDraft();
  return <><Page><SampleNotice /><View style={{ gap: 8 }}><SectionTitle>{t('trustedContacts')}</SectionTitle><AppText style={{ color: colors.muted }}>{t('buddyIntro')}</AppText></View>
    {draft.contactId && <ContentRow title={t('continueDraft')} detail={t('draftOnly')} onPress={() => router.push('/request')} />}
    <View style={{ gap: 12 }}>{sampleContacts.length ? sampleContacts.map(contact => <ContentRow key={contact.id} leading={contact.initials} title={contact.name} detail={t(contact.relationship)} onPress={() => router.push({ pathname: '/contact/[id]', params: { id: contact.id } })} />) : <EmptyContent message="noContacts" />}</View>
    <AppText variant="small" style={{ color: colors.muted }}>{t('contactsUnavailable')}</AppText>
  </Page></>;
}
export function ContactScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contact = sampleContacts.find(item => item.id === id);
  const { t } = useTranslation();
  const router = useRouter();
  const { draft, setDraft } = useRequestDraft();
  if (!contact) return <Page><EmptyContent /></Page>;
  const start = () => {
    const open = () => { setDraft({ contactId: contact.id, message: draft.contactId === contact.id ? draft.message : '' }); router.push('/request'); };
    if (draft.contactId !== contact.id && draft.message.trim()) {
      Alert.alert(t('replaceDraft'), t('discardBody'), [{ text: t('cancel'), style: 'cancel' }, { text: t('discard'), style: 'destructive', onPress: open }]);
    } else open();
  };
  return <Page><SampleNotice />
    <View style={{ gap: 12, alignItems: 'center', paddingVertical: 16 }}><View accessible={false} style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}><AppText variant="title" style={{ color: colors.primary }}>{contact.initials}</AppText></View><AppText variant="title" accessibilityRole="header">{contact.name}</AppText><AppText style={{ color: colors.muted }}>{t(contact.relationship)}</AppText></View>
    <Panel><SectionTitle>{t('helpFromSomeone')}</SectionTitle><AppText>{t('contactExplanation')}</AppText></Panel>
    <ActionButton label={t('requestHelp')} onPress={start} /><AppText variant="small" style={{ color: colors.muted }}>{t('sharingOff')}</AppText>
  </Page>;
}
