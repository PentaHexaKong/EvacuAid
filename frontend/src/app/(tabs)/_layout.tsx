import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslation } from 'react-i18next';
import { colors } from '@/theme';

export default function Tabs() {
  const { t } = useTranslation();
  return <NativeTabs tintColor={colors.primary} disableTransparentOnScrollEdge minimizeBehavior="never">
    <NativeTabs.Trigger name="(overview)" disablePopToTop disableScrollToTop>
      <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      <NativeTabs.Trigger.Label>{t('overview')}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="(discover)" disablePopToTop disableScrollToTop>
      <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} md="map" />
      <NativeTabs.Trigger.Label>{t('discoverTitle')}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="(buddy)" disablePopToTop disableScrollToTop>
      <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="people" />
      <NativeTabs.Trigger.Label>{t('buddyTitle')}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
  </NativeTabs>;
}
