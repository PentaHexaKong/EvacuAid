import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslation } from 'react-i18next';
import { tabsFor } from '@/features/access/access';
import { useAccess } from '@/features/access/use-access';
import { colors } from '@/theme';

export default function Tabs() {
  const { t, i18n } = useTranslation();
  const tabs = tabsFor(useAccess());
  // The native tab bar keeps the labels it was created with, so a language switch rebuilds it.
  return <NativeTabs key={i18n.language} tintColor={colors.primary} disableTransparentOnScrollEdge minimizeBehavior="never">
    <NativeTabs.Trigger name="(overview)" disablePopToTop disableScrollToTop>
      <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      <NativeTabs.Trigger.Label>{t('overview')}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="(discover)" hidden={!tabs.includes('discover')} disablePopToTop disableScrollToTop>
      <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} md="map" />
      <NativeTabs.Trigger.Label>{t('discoverTitle')}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="(alerts)" disablePopToTop disableScrollToTop>
      <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} md="notifications" />
      <NativeTabs.Trigger.Label>{t('alertsTitle')}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="(buddy)" disablePopToTop disableScrollToTop>
      <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="people" />
      <NativeTabs.Trigger.Label>{t('buddyTitle')}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
  </NativeTabs>;
}
