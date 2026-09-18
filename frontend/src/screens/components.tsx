import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { FieldError } from 'heroui-native/field-error';
import { Input } from 'heroui-native/input';
import { Label } from 'heroui-native/label';
import { TextField } from 'heroui-native/text-field';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import IconAlertTriangle from '@tabler/icons-react-native/IconAlertTriangle';
import IconInfoCircle from '@tabler/icons-react-native/IconInfoCircle';
import IconUserPlus from '@tabler/icons-react-native/IconUserPlus';
import IconWifiOff from '@tabler/icons-react-native/IconWifiOff';
import { ActionButton, AppText, Page, Panel, SectionHeading } from '@/components/ui';
import { colors, useTypography } from '@/theme';

export function ComponentsScreen() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<View>(null);
  const title = useRef<View>(null);
  const previouslyOpen = useRef(false);
  const bodyStyle = useTypography();
  const buttonStyle = useTypography('button');
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!open && !previouslyOpen.current) return;
    previouslyOpen.current = open;
    const timer = setTimeout(() => {
      const node = findNodeHandle(open ? title.current : trigger.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 350);
    return () => clearTimeout(timer);
  }, [open]);
  return <Page>
    <View accessibilityElementsHidden={open} importantForAccessibility={open ? 'no-hide-descendants' : 'auto'} style={{ gap: 24 }}>
      <SectionHeading number={t('preview')} title={t('componentsTitle')} subtitle={t('componentsDescription')} />
      <Panel><AppText variant="section" accessibilityRole="header">{t('typeTitle')}</AppText><AppText>{t('typeBody')}</AppText><AppText variant="small" style={{ color: colors.muted }}>{t('typeCaption')}</AppText></Panel>
      <Panel><AppText variant="section" accessibilityRole="header">{t('actions')}</AppText>
        <ActionButton variant="gradient" label={t('addBuddy')} icon={<IconUserPlus size={20} strokeWidth={2} color={colors.surface} />} onPress={() => setOpen(true)} />
        <ActionButton label={t('ordinaryButton')} onPress={() => setOpen(true)} />
        <ActionButton variant="secondary" label={t('secondaryButton')} onPress={() => { setName(''); setChecked(false); }} />
        <ActionButton loading label={t('loading')} />
        <ActionButton disabled label={t('disabledButton')} /><AppText variant="small" style={{ color: colors.muted }}>{t('disabledReason')}</AppText>
      </Panel>
      <Panel><AppText variant="section" accessibilityRole="header">{t('formTitle')}</AppText>
        <TextField isInvalid={checked && !name.trim()}><Label style={buttonStyle}>{t('nameLabel')}</Label><Input style={[bodyStyle, { minHeight: 52, height: 'auto', paddingVertical: 12, borderWidth: 1, borderColor: checked && !name.trim() ? colors.critical : colors.border, borderRadius: 12 }]} accessibilityLabel={t('nameLabel')} value={name} onChangeText={(value) => { setName(value); setChecked(false); }} placeholder={t('namePlaceholder')} /><FieldError style={bodyStyle}>{t('nameError')}</FieldError></TextField>
        <AppText variant="small" style={{ color: colors.muted }}>{t('nameDescription')}</AppText><ActionButton label={t('checkInput')} onPress={() => setChecked(true)} />
        {checked && !!name.trim() && <AppText accessibilityLiveRegion="polite">{t('inputValid')}</AppText>}
      </Panel>
      <Panel><AppText variant="section" accessibilityRole="header">{t('statesTitle')}</AppText>{([{ key: 'infoState', color: colors.primary, Icon: IconInfoCircle }, { key: 'warningState', color: colors.caution, Icon: IconAlertTriangle }, { key: 'errorState', color: colors.critical, Icon: IconWifiOff }] as const).map(({ key, color, Icon }) => <View key={key} style={{ flexDirection: 'row', gap: 12 }}><Icon size={24} strokeWidth={2} color={color} /><AppText style={{ color, flex: 1 }}>{t(key)}</AppText></View>)}</Panel>
    </View>
    <BottomSheet isOpen={open} onOpenChange={setOpen}>
      <Button ref={trigger} onPress={() => setOpen(true)} variant="secondary" style={{ minHeight: 52, height: 'auto', paddingVertical: 12 }}><AppText variant="button" style={{ flexShrink: 1 }}>{t('sheetOpen')}</AppText></Button>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay accessibilityLabel={t('sheetClose')} />
        <BottomSheet.Content snapPoints={['60%', '90%']} enableDynamicSizing={false} enableOverDrag={false} contentContainerClassName="h-full">
          <BottomSheetScrollView contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24, gap: 24 }}>
            <View ref={title} accessible accessibilityRole="header" accessibilityLabel={t('sheetTitle')}><AppText variant="section">{t('sheetTitle')}</AppText></View>
            <AppText>{t('sheetBody')}</AppText><ActionButton label={t('sheetClose')} onPress={() => setOpen(false)} />
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  </Page>;
}
