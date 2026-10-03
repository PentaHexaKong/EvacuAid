import { useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import IconAlertTriangle from '@tabler/icons-react-native/IconAlertTriangle';
import IconInfoCircle from '@tabler/icons-react-native/IconInfoCircle';
import IconUserPlus from '@tabler/icons-react-native/IconUserPlus';
import IconWifiOff from '@tabler/icons-react-native/IconWifiOff';
import { ActionButton, AppText, Field, Page, Panel, SectionHeading } from '@/components/ui';
import { colors } from '@/theme';

export function ComponentsScreen() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [checked, setChecked] = useState(false);
  const router = useRouter();
  const openSheet = () => router.navigate('/sheet');
  return <Page>
    <View style={{ gap: 24 }}>
      <SectionHeading number={t('preview')} title={t('componentsTitle')} subtitle={t('componentsDescription')} />
      <Panel><AppText variant="section" accessibilityRole="header">{t('typeTitle')}</AppText><AppText>{t('typeBody')}</AppText><AppText variant="small" style={{ color: colors.muted }}>{t('typeCaption')}</AppText></Panel>
      <Panel><AppText variant="section" accessibilityRole="header">{t('actions')}</AppText>
        <ActionButton variant="gradient" label={t('addBuddy')} icon={<IconUserPlus size={20} strokeWidth={2} color={colors.surface} />} onPress={openSheet} />
        <ActionButton label={t('ordinaryButton')} onPress={openSheet} />
        <ActionButton variant="secondary" label={t('secondaryButton')} onPress={() => { setName(''); setChecked(false); }} />
        <ActionButton loading label={t('loading')} />
        <ActionButton disabled label={t('disabledButton')} /><AppText variant="small" style={{ color: colors.muted }}>{t('disabledReason')}</AppText>
      </Panel>
      <Panel><AppText variant="section" accessibilityRole="header">{t('formTitle')}</AppText>
        <View style={{ gap: 8 }}><AppText variant="button">{t('nameLabel')}</AppText><Field invalid={checked && !name.trim()} accessibilityLabel={t('nameLabel')} value={name} onChangeText={(value) => { setName(value); setChecked(false); }} placeholder={t('namePlaceholder')} />{checked && !name.trim() && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('nameError')}</AppText>}</View>
        <AppText variant="small" style={{ color: colors.muted }}>{t('nameDescription')}</AppText><ActionButton label={t('checkInput')} onPress={() => setChecked(true)} />
        {checked && !!name.trim() && <AppText accessibilityLiveRegion="polite">{t('inputValid')}</AppText>}
      </Panel>
      <Panel><AppText variant="section" accessibilityRole="header">{t('statesTitle')}</AppText>{([{ key: 'infoState', color: colors.primary, Icon: IconInfoCircle }, { key: 'warningState', color: colors.caution, Icon: IconAlertTriangle }, { key: 'errorState', color: colors.critical, Icon: IconWifiOff }] as const).map(({ key, color, Icon }) => <View key={key} style={{ flexDirection: 'row', gap: 12 }}><Icon size={24} strokeWidth={2} color={color} /><AppText style={{ color, flex: 1 }}>{t(key)}</AppText></View>)}</Panel>
    </View>
    <ActionButton variant="secondary" label={t('sheetOpen')} onPress={openSheet} />
  </Page>;
}
