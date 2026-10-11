import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, Page } from '@/components/ui';
import { colors } from '@/theme';
import { discoverRegions, installedPackages, installPackage, cancelDownload, deletePackage, rollbackPackage, storageUsage, loadPackage, type InstalledPackage } from '@/features/offline/package-manager';
import { freshness, type OfflineManifest } from '@/features/offline/manifest';
import { OfflineMap, type MapData } from '@/features/offline/offline-map';
import { OfflineRoutingEngine } from '@/features/offline/routing';
import { useProfile } from '@/features/profile/context';

export function OfflineRegionsScreen({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation();
  const { accessibility = [] } = useProfile();
  const [installed, setInstalled] = useState<InstalledPackage[]>([]);
  const [regions, setRegions] = useState<Awaited<ReturnType<typeof discoverRegions>>>([]);
  const [usage, setUsage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [selected, setSelected] = useState<{ package: InstalledPackage; data: MapData } | null>(null);
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const refreshLocal = useCallback(async () => {
    setInstalled(await installedPackages());
    setUsage((await storageUsage()).bytes);
  }, []);
  const sync = useCallback(async () => {
    try { await refreshLocal(); setRegions(await discoverRegions()); }
    catch {
      // Preserve already installed packages and open map snapshots on server failure.
      setError(t('offlineSyncUnavailable'));
    }
  }, [refreshLocal, t]);
  useEffect(() => {
    const initial = setTimeout(() => { void sync(); }, 0);
    const network = NetInfo.addEventListener(state => { if (state.isConnected) void sync(); });
    const app = AppState.addEventListener('change', state => { if (state === 'active') void sync(); });
    return () => { clearTimeout(initial); network(); app.remove(); };
  }, [sync]);
  const run = async (operation: () => Promise<unknown>) => {
    try { setError(null); await operation(); await refreshLocal(); }
    catch { setError(t('offlineOperationFailed')); }
  };
  const download = async (manifest: OfflineManifest, consent = false) => {
    setActive(manifest.regionId); setError(null);
    try {
      await installPackage(manifest, (bytes, total) => setProgress(total ? bytes / total : 1), consent);
      await refreshLocal();
    } catch (cause) {
      if ((cause as Error).message === 'METERED_CONSENT_REQUIRED') {
        Alert.alert(t('offlineMeteredTitle'), t('offlineMeteredBody'), [
          { text: t('cancel'), style: 'cancel' },
          { text: t('offlineDownload'), onPress: () => void download(manifest, true) },
        ]);
      } else setError(t((cause as Error).message === 'INSUFFICIENT_STORAGE' ? 'offlineStorageLow' : (cause as Error).message === 'DOWNLOAD_PAUSED' ? 'offlinePaused' : 'offlineOperationFailed'));
    } finally { setActive(null); setProgress(0); }
  };
  const locate = async () => {
    if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error('LOCATION_DENIED');
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setPosition(location.coords);
  };
  const route = async (shelter: { latitude: number; longitude: number }) => {
    if (!position || !selected) { setError(t('offlineLocateFirst')); return; }
    await OfflineRoutingEngine.route({ origin: position, destination: shelter, costing: 'pedestrian', accessibilityRequirements: accessibility.map(item => item.type) }, selected.package.manifest);
    setError(t('offlineRoutingUnavailable'));
  };
  return <Page contentStyle={{ gap: 16 }}>
    {onBack && <ActionButton compact variant="secondary" label={t('offlineBack')} onPress={onBack} />}
    <AppText variant="title" accessibilityRole="header">{t('offlineTitle')}</AppText>
    <AppText>{t('offlineNotice')}</AppText>
    <AppText>{t('offlineStorage', { size: (usage / 1024 / 1024).toFixed(1) })}</AppText>
    <ActionButton variant="secondary" label={t('offlineCheckUpdates')} onPress={() => void sync()} />
    {error && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{error}</AppText>}
    {active && <View style={{ gap: 8 }}>
      <AppText accessibilityLiveRegion="polite">{t('offlineProgress', { percent: Math.floor(progress * 100) })}</AppText>
      <ActionButton label={t('offlinePause')} onPress={() => void cancelDownload(active)} />
    </View>}
    <AppText variant="button" accessibilityRole="header">{t('offlineInstalled')}</AppText>
    {!installed.length && <AppText>{t('offlineNone')}</AppText>}
    {installed.map(item => <View key={item.manifest.regionId} style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: colors.border }}>
      <AppText variant="button">{item.manifest.regionName}</AppText>
      <AppText>{t('offlineUpdated', { date: item.manifest.generatedAt })}</AppText>
      <AppText>{t('offlineEvidence', { status: t('offlineFreshness' + freshness(item.manifest)) })}</AppText>
      {freshness(item.manifest) !== 'CURRENT_SNAPSHOT' && <AppText>{t('offlineStale')}</AppText>}
      <AppText>{t('offlineCapabilities')}</AppText>
      <ActionButton label={t('offlineOpenMap')} onPress={() => void run(async () => setSelected({ package: item, data: await loadPackage(item) }))} />
      <ActionButton variant="secondary" disabled={Boolean(active)} label={t('offlineRollback')} onPress={() => void run(() => rollbackPackage(item.manifest.regionId))} />
      <ActionButton variant="secondary" disabled={Boolean(active)} label={t('offlineDelete')} onPress={() => Alert.alert(t('offlineDelete'), item.manifest.regionName, [
        { text: t('cancel'), style: 'cancel' }, { text: t('offlineDelete'), style: 'destructive', onPress: () => void run(async () => { await deletePackage(item.manifest.regionId); if (selected?.package.manifest.regionId === item.manifest.regionId) setSelected(null); }) },
      ])} />
    </View>)}
    {selected && <View style={{ gap: 12 }}>
      <AppText variant="button">{selected.package.manifest.regionName}</AppText>
      <AppText>{t('offlineEvidence', { status: t('offlineFreshness' + freshness(selected.package.manifest)) })}</AppText>
      <OfflineMap manifest={selected.package.manifest} data={selected.data} position={position} onShelter={shelter => void route(shelter)} />
      <ActionButton variant="secondary" label={t('offlineLocate')} onPress={() => void run(locate)} />
      {selected.data.hazards.map((hazard, index) => <AppText key={index}>
        {hazard.hazardType} · {hazard.source ?? t('offlineUnknown')} · {t('offlineObserved', { date: hazard.observedAt ?? t('offlineUnknown') })} · {t('offlineValidUntil', { date: hazard.validUntil ?? t('offlineUnknown') })}
      </AppText>)}
      {selected.data.shelters.map(shelter => <View key={shelter.id} style={{ gap: 6 }}>
        <AppText>{shelter.name} · {shelter.status}</AppText>
        <AppText>{t('offlineStepFree', { status: t(shelter.wheelchairAccessible === true ? 'offlineReportedYes' : shelter.wheelchairAccessible === false ? 'offlineReportedNo' : 'offlineUnknown') })}</AppText>
        <ActionButton compact variant="secondary" label={t('offlineRouteTo', { name: shelter.name })} onPress={() => void route(shelter)} />
      </View>)}
      <AppText>{t('offlineCachedNone')}</AppText>
    </View>}
    <AppText variant="button" accessibilityRole="header">{t('offlineAvailable')}</AppText>
    {regions.filter(region => region.manifest).map(region => {
      const manifest = region.manifest!;
      const current = installed.find(item => item.manifest.regionId === region.regionId);
      const same = current?.manifest.packageId === manifest.packageId;
      return <View key={region.regionId} style={{ gap: 8 }}>
        <AppText>{region.regionName} · {(manifest.packageSizeBytes / 1024 / 1024).toFixed(1)} MB</AppText>
        <ActionButton disabled={Boolean(active) || same} label={t(same ? 'offlineUpToDate' : current ? 'offlineUpdate' : 'offlineDownload')} onPress={() => void download(manifest)} />
      </View>;
    })}
    {!regions.some(region => region.manifest) && <AppText>{t('offlineNoPublished')}</AppText>}
  </Page>;
}
