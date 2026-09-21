import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, Page, Panel } from '@/components/ui';
import { colors } from '@/theme';
import { SimulationMap } from '@/features/route-simulation/map';
import { graph, endpoints, presets, selectRoute, type Scenario, type Shelter, type Preset } from '@/features/route-simulation/sample';
import { interpolate, snapDestination, MAX_DESTINATION_SNAP_METERS, type Coordinate } from '@/features/route-simulation/routing';
import { usePlayback } from '@/features/route-simulation/use-playback';

export function RouteSimulationScreen() {
  const { t } = useTranslation();
  const [scenario, setScenario] = useState<Scenario>('shelter');
  const [shelter, setShelter] = useState<Shelter>('nearest');
  const [preset, setPreset] = useState<Preset>('clear');
  const [mapSelection, setMapSelection] = useState<ReturnType<typeof snapDestination>>();
  const [selectionError, setSelectionError] = useState(false);
  const clearMapSelection = () => { setMapSelection(undefined); setSelectionError(false); };
  const selectMapDestination = (coordinate: Coordinate) => {
    const selection = snapDestination(graph, coordinate);
    setSelectionError(!selection);
    if (selection) setMapSelection(selection);
  };
  return <Page>
    <AppText variant="title" accessibilityRole="header">{t('routeSimulation')}</AppText>
    <AppText>{t('simulationNotice')}</AppText>
    <Panel>
      <Choices title={t('simulationScenario')} value={scenario} options={[{ value: 'shelter', label: t('simulationShelter') }, { value: 'buddy', label: t('simulationBuddy') }]} onChange={value => { setScenario(value); clearMapSelection(); }} />
      {scenario === 'shelter' && <Choices<Shelter | 'map'> title={t('simulationShelterChoice')} value={mapSelection ? 'map' : shelter} options={[{ value: 'nearest', label: t('simulationNearest') }, { value: 'hall', label: t('hallName') }, { value: 'center', label: t('centerName') }, ...(mapSelection ? [{ value: 'map' as const, label: t('simulationSelectedDestination') }] : [])]} onChange={value => { if (value !== 'map') { setShelter(value); clearMapSelection(); } }} />}
      <Choices title={t('simulationRestrictions')} value={preset} options={[{ value: 'clear', label: t('simulationClear') }, { value: 'blocked', label: t('simulationBlocked') }, { value: 'cut', label: t('simulationCut') }]} onChange={setPreset} />
    </Panel>
    <Journey key={`${scenario}:${shelter}:${preset}:${mapSelection?.node.id ?? ''}`} scenario={scenario} shelter={shelter} preset={preset} mapSelection={mapSelection} selectionError={selectionError} onDestinationSelect={selectMapDestination} onClearDestination={clearMapSelection} />
  </Page>;
}
function Choices<T extends string>({ title, value, options, onChange }: { title: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <View style={{ gap: 8 }}>
    <AppText variant="section" accessibilityRole="header">{title}</AppText>
    {options.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: value === option.value }} onPress={() => onChange(option.value)} style={({ pressed }) => ({ padding: 12, minHeight: 48, borderWidth: 2, borderRadius: 12, borderColor: value === option.value ? colors.primary : colors.border, backgroundColor: pressed ? colors.canvas : colors.surface })}>
      <AppText style={{ color: value === option.value ? colors.primary : colors.ink }}>{value === option.value ? '● ' : '○ '}{option.label}</AppText>
    </Pressable>)}
  </View>;
}
function Journey({ scenario, shelter, preset, mapSelection, selectionError, onDestinationSelect, onClearDestination }: { scenario: Scenario; shelter: Shelter; preset: Preset; mapSelection: ReturnType<typeof snapDestination>; selectionError: boolean; onDestinationSelect: (coordinate: Coordinate) => void; onClearDestination: () => void }) {
  const { t } = useTranslation();
  const result = useMemo(() => selectRoute(scenario, shelter, preset, mapSelection?.node.id), [scenario, shelter, preset, mapSelection?.node.id]);
  const { route, origin, destination } = result;
  const playback = usePlayback(route.reachable && route.distance > 0);
  const originCoordinate = graph.nodes.find(node => node.id === origin)!.coordinate;
  const destinationCoordinate = graph.nodes.find(node => node.id === destination)?.coordinate;
  const blocked = graph.edges.filter(edge => presets[scenario][preset].includes(edge.id));
  const destinationLabel = mapSelection ? t('simulationSelectedDestination') : scenario === 'buddy' ? t('simulationRequester') : destination === endpoints.hall ? t('hallName') : destination === endpoints.center ? t('centerName') : t('simulationNearest');
  let segmentEnd = 0;
  const travelled = route.reachable ? playback.progress * route.distance : 0;
  return <>
    <Panel>
      <AppText>{t('simulationPickDestination', { distance: MAX_DESTINATION_SNAP_METERS })}</AppText>
      <SimulationMap origin={originCoordinate} destination={destinationCoordinate} traveller={route.reachable ? interpolate(route.geometry, playback.progress) : originCoordinate} route={route} blocked={blocked} network={graph.edges} onDestinationSelect={onDestinationSelect} />
      {selectionError && <AppText accessibilityRole="alert">{t('simulationDestinationOutside', { distance: MAX_DESTINATION_SNAP_METERS })}</AppText>}
      {mapSelection && <>
        <AppText accessibilityLiveRegion="polite">{t('simulationDestinationSnapped', { distance: Math.round(mapSelection.distance), latitude: mapSelection.node.coordinate[1].toFixed(5), longitude: mapSelection.node.coordinate[0].toFixed(5) })}</AppText>
        <ActionButton variant="secondary" label={t('simulationUseExampleDestination')} onPress={onClearDestination} />
      </>}
    </Panel>
    <Panel>
      <AppText variant="section" accessibilityRole="header">{t('simulationSummary')}</AppText>
      <AppText>{scenario === 'buddy' ? t('simulationBuddyOrigin') : t('simulationPersonOrigin')} → {destinationLabel}</AppText>
      <AppText variant="small">{t('simulationPositions')}</AppText>
      {mapSelection && <AppText variant="small">{t('simulationPickedRestrictions')}</AppText>}
      {route.reachable ? <><AppText>{t('simulationDistance', { distance: Math.round(route.distance), minutes: Math.ceil(route.distance / 1.2 / 60) })}</AppText><AppText variant="small">{t('simulationScope')}</AppText></> : <AppText accessibilityRole="alert">{t('simulationUnreachable')}</AppText>}
      {blocked.map((edge, index) => <AppText key={edge.id} variant="small" style={{ color: colors.critical }}>{t('simulationBlockedSegment', { number: index + 1, road: edge.name || t('simulationUnnamed'), id: edge.id })}</AppText>)}
    </Panel>
    <Panel>
      <AppText variant="section" accessibilityRole="header">{t('simulationPlayback')}</AppText>
      <AppText>{t('simulationPlaybackNotice')}</AppText>
      <AppText accessibilityLiveRegion="polite">{t(route.reachable && route.distance === 0 ? 'simulationAtDestination' : playback.progress === 1 ? 'simulationComplete' : playback.playing ? 'simulationPlaying' : 'simulationPaused')}</AppText>
      <View accessibilityRole="progressbar" accessibilityLabel={t('simulationProgress')} accessibilityValue={{ min: 0, max: 100, now: Math.round(playback.progress * 100) }}><AppText>{Math.round(playback.progress * 100)}%</AppText></View>
      <ActionButton label={t(playback.playing ? 'simulationPause' : 'simulationPlay')} disabled={!route.reachable || route.distance === 0 || playback.progress === 1} onPress={playback.playing ? playback.pause : playback.play} />
      <ActionButton variant="secondary" label={t('simulationReset')} disabled={!route.reachable} onPress={playback.reset} />
    </Panel>
    <Panel>
      <AppText variant="section" accessibilityRole="header">{t('simulationSteps')}</AppText>
      <AppText variant="small">{t('simulationStepsNotice')}</AppText>
      {route.reachable ? route.segments.map((segment, index) => {
        const start = segmentEnd;
        segmentEnd += segment.distance;
        const current = playback.progress < 1 && travelled >= start && travelled < segmentEnd;
        return <View key={segment.id} style={{ padding: 12, borderLeftWidth: current ? 4 : 0, borderColor: colors.primary, backgroundColor: current ? colors.canvas : colors.surface, gap: 4 }}>
          <AppText style={{ color: current ? colors.primary : colors.ink }}>{t('simulationStep', { number: index + 1, road: segment.name || t('simulationUnnamed'), distance: Math.round(segment.distance), waypoint: index + 1 })}</AppText>
          {current && <AppText variant="small" style={{ color: colors.primary }}>{t('simulationCurrentSegment')}</AppText>}
        </View>;
      }) : <AppText>{t('simulationNoSteps')}</AppText>}
    </Panel>
  </>;
}
