import { useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import IconMapPin from '@tabler/icons-react-native/IconMapPin';
import IconNavigation from '@tabler/icons-react-native/IconNavigation';
import IconFocus2 from '@tabler/icons-react-native/IconFocus2';
import IconWifi from '@tabler/icons-react-native/IconWifi';
import IconWifiOff from '@tabler/icons-react-native/IconWifiOff';
import { ActionButton, AppText, Page, Panel, SectionHeading } from '@/components/ui';
import { colors, corner, radius } from '@/theme';
import { useBuddyPreview } from '@/features/buddy-map/use-buddy-preview';
import { positionStatus, type Participant } from '@/features/buddy-map/location-source';

function ParticipantRow({ participant, now }: { participant: Participant; now: number }) {
  const { t, i18n } = useTranslation();
  const { position, id } = participant;
  const status = positionStatus(position, now);
  const Icon = id === 'you' ? IconNavigation : IconMapPin;
  const locale = i18n.language === 'id' ? 'id-ID' : 'en-US';
  const formats = useMemo(() => ({ time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }), coordinate: new Intl.NumberFormat(locale, { minimumFractionDigits: 5, maximumFractionDigits: 5 }), meters: new Intl.NumberFormat(locale) }), [locale]);
  return <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 16, gap: 8 }}>
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon size={24} strokeWidth={2} color={id === 'you' ? colors.ink : colors.primary} /><AppText variant="button" style={{ flex: 1 }}>{t(id)}</AppText></View>
    <AppText variant="small" style={{ color: status === 'current' ? colors.primary : colors.caution }}>{t(status)}</AppText>
    {position && <><AppText variant="small" style={{ color: colors.muted }}>{t('updated', { time: formats.time.format(position.observedAt) })}</AppText>
      <AppText selectable variant="small" style={{ color: colors.muted }}>{t('coordinates', { latitude: formats.coordinate.format(position.latitude), longitude: formats.coordinate.format(position.longitude) })}</AppText>
      {position.accuracy !== undefined && <AppText variant="small" style={{ color: colors.muted }}>{t('accuracy', { meters: formats.meters.format(position.accuracy) })}</AppText>}</>}
  </View>;
}
function SimulationControls({ source, disconnected }: { source: ReturnType<typeof useBuddyPreview>['source']; disconnected: boolean }) {
  const { t } = useTranslation();
  const [moving, setMoving] = useState(true);
  const [hidden, setHidden] = useState(false);
  return <Panel><AppText variant="section" accessibilityRole="header">{t('controls')}</AppText>
    <ActionButton variant="secondary" disabled={disconnected} label={t(moving ? 'pause' : 'resume')} onPress={() => { source.setMoving(!moving); setMoving(!moving); }} />
    <ActionButton label={t(disconnected ? 'recover' : 'interrupt')} onPress={() => disconnected ? source.recover() : source.interrupt()} />
    <ActionButton variant="secondary" disabled={disconnected} label={t(hidden ? 'showBuddy' : 'hideBuddy')} onPress={() => { source.setUnavailable(!hidden); setHidden(!hidden); }} />
  </Panel>;
}
export function BuddyMapScreen() {
  const { t } = useTranslation();
  const { snapshot, now, generation, source } = useBuddyPreview();
  const map = useRef<MapView>(null);
  const mapAvailable = Platform.OS === 'ios' || Boolean(Constants.expoConfig?.extra?.androidMapConfigured) || Constants.appOwnership === 'expo';
  const disconnected = snapshot?.connection === 'disconnected';
  const ConnectionIcon = disconnected ? IconWifiOff : IconWifi;
  const fit = () => {
    const positions = snapshot?.participants.flatMap((participant) => participant.position ? [participant.position] : []) ?? [];
    if (positions.length) map.current?.fitToCoordinates(positions, { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: false });
  };
  return <Page>
    <SectionHeading number={t('preview')} title={t('mapTitle')} subtitle={t('mapDescription')} />
    <View style={{ gap: 12 }}><AppText variant="small" style={{ color: colors.muted }}>{t('demoOnly')}</AppText>
      <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 8 }}><ConnectionIcon size={24} strokeWidth={2} color={disconnected ? colors.caution : colors.primary} /><AppText style={{ flex: 1, color: disconnected ? colors.caution : colors.primary }}>{t(!snapshot ? 'inactive' : disconnected ? 'disconnected' : 'connected')}</AppText></View>
    </View>
    <View style={styles.mapFrame} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {mapAvailable ? <MapView ref={map} style={StyleSheet.absoluteFill} provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined} initialRegion={{ latitude: -6.1765, longitude: 106.829, latitudeDelta: 0.013, longitudeDelta: 0.013 }} onMapReady={fit} showsUserLocation={false} showsMyLocationButton={false} toolbarEnabled={false} accessibilityLabel={t('mapLabel')}>
        {snapshot?.participants.map(({ id, position }) => position && <Marker key={id} coordinate={position} title={t(id)} description={t(positionStatus(position, now))} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={[styles.marker, { backgroundColor: id === 'you' ? colors.ink : colors.primary, opacity: positionStatus(position, now) === 'stale' ? 0.55 : 1 }]}>{id === 'you' ? <IconNavigation size={24} strokeWidth={2} color={colors.surface} /> : <IconMapPin size={24} strokeWidth={2} color={colors.surface} />}</View>
        </Marker>)}
      </MapView> : <View style={{ padding: 24, gap: 16 }}><IconMapPin color={colors.primary} size={32} strokeWidth={2} /><AppText>{t('mapKeyMissing')}</AppText></View>}
    </View>
    {!mapAvailable && <AppText style={{ color: colors.caution }}>{t('mapKeyMissing')}</AppText>}
    <ActionButton variant="secondary" disabled={!mapAvailable || !snapshot?.participants.some((p) => p.position)} label={t('recenter')} icon={<IconFocus2 color={colors.primary} size={20} strokeWidth={2} />} onPress={fit} />
    <Panel><AppText variant="section" accessibilityRole="header">{t('participants')}</AppText>{snapshot ? snapshot.participants.map((participant) => <ParticipantRow key={participant.id} participant={participant} now={now} />) : <AppText>{t('mapPaused')}</AppText>}</Panel>
    {snapshot && <SimulationControls key={generation} source={source} disconnected={disconnected} />}
    <AppText variant="small" style={{ color: colors.muted }}>{t('mapFooter')}</AppText>
  </Page>;
}
const styles = StyleSheet.create({
  mapFrame: { height: 320, ...corner(radius.lg), overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  marker: { padding: 10, borderWidth: 3, borderColor: colors.surface, borderRadius: radius.pill },
});
