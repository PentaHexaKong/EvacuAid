import { useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from 'heroui-native/button';
import { Chip } from 'heroui-native/chip';
import { AppText } from '@/components/ui';
import { ContentRow, EmptyContent } from '@/components/content';
import { DiscoverMap } from '@/components/discover-map';
import { sampleAlerts, sampleDestinations } from '@/features/content/samples';
import { colors } from '@/theme';

export function DiscoverScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  const items = useMemo(() => [
    ...sampleAlerts.map(item => ({ id: item.id, kind: 'alert' as const, coordinate: item.coordinate, title: t(item.title), status: t(item.severity), detail: `${t(item.area)}\n${t(item.source)} · ${item.issued}` })),
    ...sampleDestinations.map(item => ({ id: item.id, kind: 'destination' as const, coordinate: item.coordinate, title: t(item.name), status: t('destinationTitle'), detail: `${t(item.address)}\n${t('accessInformation')}: ${t(item.access)}` })),
  ].filter(item => filter === 'all' || item.kind === filter), [filter, t]);
  const select = (id: string) => {
    setSelected(id);
    if (positions.current[id] !== undefined) scroll.current?.scrollTo({ y: Math.max(0, positions.current[id] - insets.top - 12), animated: false });
  };
  return <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: colors.canvas }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 24, gap: 20 }}>
    <AppText variant="title" accessibilityRole="header">{t('discoverTitle')}</AppText>
    <View style={{ gap: 6 }}><AppText variant="eyebrow" style={{ color: colors.primary }}>{t('exampleArea')}</AppText><AppText variant="small" style={{ color: colors.muted }}>{t('discoverExample')}</AppText></View>
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['all', 'alert', 'destination'] as const).map(value => <Button key={value} variant={filter === value ? 'primary' : 'secondary'} accessibilityRole="tab" accessibilityLabel={t(`filter_${value}`)} accessibilityState={{ selected: filter === value }} onPress={() => { setFilter(value); setSelected(null); }} style={{ minHeight: 48, height: 'auto', paddingVertical: 12 }}><AppText variant="button" style={{ color: filter === value ? colors.surface : colors.primary }}>{t(`filter_${value}`)}</AppText></Button>)}</View>
    <DiscoverMap items={items} selected={selected} onSelect={select} />
    <AppText variant="section" accessibilityRole="header">{t('nearbyExamples')}</AppText>
    {!items.length && <EmptyContent message="discoverEmpty" />}
    {items.map(item => <View key={item.id} onLayout={event => { positions.current[item.id] = event.nativeEvent.layout.y; }} style={{ gap: 8, padding: 4, borderWidth: 2, borderRadius: 20, borderColor: selected === item.id ? colors.primary : 'transparent' }}>
      <Chip style={{ alignSelf: 'flex-start', backgroundColor: colors.surface, height: 'auto', paddingVertical: 6 }}><AppText variant="small" style={{ color: item.kind === 'alert' ? colors.caution : colors.primary }}>{item.status}</AppText></Chip>
      {selected === item.id && <AppText variant="small" accessibilityLiveRegion="polite" style={{ color: colors.primary }}>{t('selectedMapItem')}</AppText>}
      <ContentRow title={item.title} detail={item.detail} onPress={() => { setSelected(item.id); router.push({ pathname: item.kind === 'alert' ? '/alert/[id]' : '/destinations/[id]', params: { id: item.id } }); }} />
    </View>)}
  </ScrollView>;
}
