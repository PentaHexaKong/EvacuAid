import * as FS from 'expo-file-system/legacy';
import { File, FileMode } from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { apiRequest } from '@/features/profile/api';
import { verifyManifest, type OfflineManifest, type OfflineAsset } from './manifest';

export type InstalledPackage = { manifest: OfflineManifest; directory: string };
type Pointer = { current: string; previous?: string };
const base = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
const storage = () => {
  if (!FS.documentDirectory) throw new Error('PERSISTENT_STORAGE_UNAVAILABLE');
  return FS.documentDirectory + 'offline-packages/';
};
const active = new Map<string, FS.DownloadResumable>();
const cancelled = new Set<string>();
const busy = new Set<string>();

export async function hashFile(uri: string, expectedSize: number) {
  const file = new File(uri);
  if (!file.exists || file.size !== expectedSize) throw new Error('SIZE_MISMATCH');
  const handle = file.open();
  const hash = sha256.create();
  try {
    let read = 0;
    while (read < expectedSize) {
      const chunk = handle.readBytes(Math.min(64 * 1024, expectedSize - read));
      if (!chunk.length) throw new Error('TRUNCATED_FILE');
      hash.update(chunk); read += chunk.length;
      // Keep graph bytes bounded and yield so cancellation/UI remain responsive.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return bytesToHex(hash.digest());
  } finally { handle.close(); }
}

async function verifiedFile(uri: string, asset: OfflineAsset) {
  try { return await hashFile(uri, asset.sizeBytes) === asset.sha256; } catch { return false; }
}
async function json(uri: string) { return JSON.parse(await FS.readAsStringAsync(uri)); }
async function exists(uri: string) { return (await FS.getInfoAsync(uri)).exists; }
async function pointer(regionId: string): Promise<Pointer | null> {
  try {
    const commits = storage() + regionId + '/commits/';
    const names = (await FS.readDirectoryAsync(commits)).filter(name => /^\d{16}\.json$/.test(name)).sort().reverse();
    if (!names.length) return null;
    const value = await json(commits + names[0]);
    if (!/^[a-f0-9]{64}$/.test(value.current) || (value.previous && !/^[a-f0-9]{64}$/.test(value.previous))) return null;
    return value;
  } catch { return null; }
}
async function writePointer(regionId: string, value: Pointer) {
  const directory = storage() + regionId + '/commits/';
  await FS.makeDirectoryAsync(directory, { intermediates: true });
  const names = (await FS.readDirectoryAsync(directory)).filter(name => /^\d{16}\.json$/.test(name)).sort();
  const revision = String(names.length ? Number(names[names.length - 1].slice(0, 16)) + 1 : 1).padStart(16, '0');
  const temporary = directory + revision + '.tmp';
  await FS.writeAsStringAsync(temporary, JSON.stringify(value));
  // Append an immutable commit through native rename. No delete/replace window.
  new File(temporary).rename(revision + '.json');
}
export async function discoverRegions() {
  const regions: { regionId: string; regionName: string; buildStatus: string; manifest: OfflineManifest | null }[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await apiRequest<{ regions: typeof regions }>('/v1/offline/regions?limit=500&offset=' + offset);
    regions.push(...page.regions);
    if (page.regions.length < 500) return regions;
  }
}
export async function installedPackages(): Promise<InstalledPackage[]> {
  await FS.makeDirectoryAsync(storage(), { intermediates: true });
  const result: InstalledPackage[] = [];
  for (const regionId of await FS.readDirectoryAsync(storage())) {
    if (!/^[a-f0-9-]{36}$/.test(regionId)) continue;
    const entry = await pointer(regionId);
    if (!entry) continue;
    try {
      const directory = storage() + regionId + '/versions/' + entry.current + '/';
      const manifest = verifyManifest(await json(directory + 'manifest.json'));
      if (manifest.regionId === regionId && manifest.packageId === entry.current) result.push({ manifest, directory });
    } catch {
      // A corrupt current manifest cannot hide access to a verified preceding
      // installation. Restore it after checking its complete file inventory.
      if (entry.previous) {
        try {
          await rollbackPackage(regionId);
          const directory = storage() + regionId + '/versions/' + entry.previous + '/';
          result.push({ manifest: verifyManifest(await json(directory + 'manifest.json')), directory });
        } catch { /* Neither version is trusted: do not list either as installed. */ }
      }
    }
  }
  return result;
}
export async function cancelDownload(regionId: string) {
  cancelled.add(regionId);
  const task = active.get(regionId);
  if (task) await task.cancelAsync();
}
export async function installPackage(value: unknown, onProgress: (downloaded: number, total: number) => void, consentMetered = false) {
  const manifest = verifyManifest(value);
  const regionId = manifest.regionId;
  if (busy.has(regionId)) throw new Error('DOWNLOAD_IN_PROGRESS');
  busy.add(regionId); cancelled.delete(regionId);
  const region = storage() + regionId + '/';
  const staging = region + 'staging/' + manifest.packageId + '/';
  try {
    if (Date.now() >= Date.parse(manifest.expiresAt)) throw new Error('PACKAGE_EXPIRED');
    const network = await NetInfo.fetch();
    if (!consentMetered && (network.type === 'cellular' || network.details?.isConnectionExpensive)) throw new Error('METERED_CONSENT_REQUIRED');
    // Reserve space for staging plus the new installed copy; keep the previous package.
    if (await FS.getFreeDiskStorageAsync() < manifest.packageSizeBytes * 2 + 32 * 1024 * 1024) throw new Error('INSUFFICIENT_STORAGE');
    await FS.makeDirectoryAsync(staging, { intermediates: true });
    await FS.writeAsStringAsync(staging + 'manifest.json', JSON.stringify(manifest));
    await FS.makeDirectoryAsync(storage() + 'objects/', { intermediates: true });
    let transferred = 0;
    onProgress(0, manifest.packageSizeBytes);
    for (const asset of manifest.assets) {
      if (cancelled.has(regionId)) throw new Error('DOWNLOAD_PAUSED');
      const blob = storage() + 'objects/' + asset.sha256;
      if (!await verifiedFile(blob, asset)) {
        const partial = region + asset.sha256 + '.part';
        const url = base + '/v1/offline/packages/' + regionId + '/assets/' + asset.sha256 + '?packageId=' + manifest.packageId;
        const file = new File(partial);
        if (!file.exists) file.create();
        let offset = file.size;
        if (offset > asset.sizeBytes) { file.delete(); file.create(); offset = 0; }
        // Persist completed 4 MiB ranges in a partial file. A process death can
        // lose at most the in-flight range; no opaque platform resume token is needed.
        while (offset < asset.sizeBytes) {
          if (cancelled.has(regionId)) throw new Error('DOWNLOAD_PAUSED');
          const end = Math.min(offset + 4 * 1024 * 1024, asset.sizeBytes) - 1;
          const chunkUri = partial + '.chunk';
          await FS.deleteAsync(chunkUri, { idempotent: true });
          const task = FS.createDownloadResumable(url, chunkUri, { headers: { Range: 'bytes=' + offset + '-' + end } },
            progress => onProgress(transferred + offset + progress.totalBytesWritten, manifest.packageSizeBytes));
          active.set(regionId, task);
          const response = await task.downloadAsync();
          active.delete(regionId);
          if (cancelled.has(regionId)) throw new Error('DOWNLOAD_PAUSED');
          if (!response || response.status !== 206) throw new Error('RESUMABLE_DOWNLOAD_UNAVAILABLE');
          const chunk = new File(chunkUri);
          if (!chunk.exists || chunk.size !== end - offset + 1) throw new Error('TRUNCATED_RANGE');
          const reader = chunk.open(FileMode.ReadOnly), writer = file.open();
          try {
            writer.offset = offset;
            let remaining = chunk.size;
            while (remaining) {
              const bytes = reader.readBytes(Math.min(64 * 1024, remaining));
              if (!bytes.length) throw new Error('TRUNCATED_RANGE');
              writer.writeBytes(bytes); remaining -= bytes.length;
            }
          } finally { reader.close(); writer.close(); }
          offset = end + 1;
          await FS.deleteAsync(chunkUri, { idempotent: true });
        }
        if (!await verifiedFile(partial, asset)) {
          await FS.deleteAsync(partial, { idempotent: true });
          throw new Error('CHECKSUM_MISMATCH');
        }
        await FS.deleteAsync(blob, { idempotent: true });
        await FS.moveAsync({ from: partial, to: blob });
      }
      const target = staging + asset.path;
      await FS.makeDirectoryAsync(target.slice(0, target.lastIndexOf('/')), { intermediates: true });
      await FS.deleteAsync(target, { idempotent: true });
      await FS.copyAsync({ from: blob, to: target });
      transferred += asset.sizeBytes; onProgress(transferred, manifest.packageSizeBytes);
    }
    await FS.writeAsStringAsync(staging + 'manifest.json', JSON.stringify(manifest));
    const version = region + 'versions/' + manifest.packageId + '/';
    await FS.makeDirectoryAsync(region + 'versions/', { intermediates: true });
    if (!await exists(version)) await FS.moveAsync({ from: staging, to: version });
    else {
      for (const asset of manifest.assets) if (!await verifiedFile(version + asset.path, asset)) throw new Error('CORRUPT_EXISTING_VERSION');
      await FS.deleteAsync(staging, { idempotent: true });
    }
    const old = await pointer(regionId);
    if (cancelled.has(regionId)) throw new Error('DOWNLOAD_PAUSED');
    await writePointer(regionId, { current: manifest.packageId, ...(old?.current && old.current !== manifest.packageId ? { previous: old.current } : old?.previous ? { previous: old.previous } : {}) });
    // Retain only the current and preceding installed versions. Open map data
    // has already been loaded; immutable package identity remains unchanged.
    const keep = await pointer(regionId);
    for (const name of await FS.readDirectoryAsync(region + 'versions/')) {
      if (name !== keep?.current && name !== keep?.previous) await FS.deleteAsync(region + 'versions/' + name + '/', { idempotent: true });
    }
    return { manifest, directory: version };
  } catch (error) {
    if (cancelled.has(regionId)) throw new Error('DOWNLOAD_PAUSED');
    throw error;
  } finally { busy.delete(regionId); active.delete(regionId); }
}
export async function loadPackage(installed: InstalledPackage) {
  const manifest = verifyManifest(await json(installed.directory + 'manifest.json'));
  if (manifest.packageId !== installed.manifest.packageId) throw new Error('PACKAGE_CHANGED');
  // Revalidate small displayed files each time; graph never enters JS as a whole.
  for (const asset of manifest.assets.filter(a => a.kind !== 'routing')) if (!await verifiedFile(installed.directory + asset.path, asset)) throw new Error('CHECKSUM_MISMATCH');
  return {
    streets: await json(installed.directory + 'map/streets.geojson'),
    boundary: await json(installed.directory + 'map/boundary.geojson'),
    coverage: await json(installed.directory + 'map/coverage.geojson'),
    shelters: (await json(installed.directory + 'shelters/shelters.json')).map(({ currentOccupancy: _historicalOccupancy, ...shelter }: { currentOccupancy?: number; status: string }) => ({ ...shelter, status: shelter.status === 'FULL' ? 'UNKNOWN' : shelter.status })),
    hazards: await json(installed.directory + 'hazards/evidence.json'),
    cachedRoutes: await json(installed.directory + 'cached-routes/routes.json'),
  };
}
export async function rollbackPackage(regionId: string) {
  if (!/^[a-f0-9-]{36}$/.test(regionId) || busy.has(regionId)) throw new Error('PACKAGE_BUSY_OR_INVALID');
  const old = await pointer(regionId);
  if (!old?.previous) throw new Error('NO_PREVIOUS_PACKAGE');
  const directory = storage() + regionId + '/versions/' + old.previous + '/';
  const manifest = verifyManifest(await json(directory + 'manifest.json'));
  if (manifest.regionId !== regionId || manifest.packageId !== old.previous) throw new Error('INVALID_PREVIOUS_PACKAGE');
  for (const asset of manifest.assets) if (!await verifiedFile(directory + asset.path, asset)) throw new Error('CHECKSUM_MISMATCH');
  await writePointer(regionId, { current: old.previous, previous: old.current });
}
export async function deletePackage(regionId: string) {
  if (!/^[a-f0-9-]{36}$/.test(regionId) || busy.has(regionId)) throw new Error('PACKAGE_BUSY_OR_INVALID');
  await FS.deleteAsync(storage() + regionId + '/', { idempotent: true });
  // Remove shared assets only if no retained installed/staging manifest references them.
  await pruneObjects();
}
async function pruneObjects() {
  if (busy.size) return;
  const referenced = new Set<string>();
  async function visit(directory: string) {
    for (const name of await FS.readDirectoryAsync(directory)) {
      if (name === 'objects') continue;
      const uri = directory + name;
      const info = await FS.getInfoAsync(uri);
      if (info.exists && info.isDirectory) await visit(uri + '/');
      else if (name === 'manifest.json') {
        try { for (const asset of verifyManifest(await json(uri)).assets) referenced.add(asset.sha256); }
        catch { /* Untrusted files are not a source of live object references. */ }
      }
    }
  }
  await visit(storage());
  const objects = storage() + 'objects/';
  if (await exists(objects)) for (const name of await FS.readDirectoryAsync(objects)) if (!referenced.has(name)) await FS.deleteAsync(objects + name, { idempotent: true });
}
export async function storageUsage() {
  let bytes = 0;
  async function visit(directory: string) {
    if (!await exists(directory)) return;
    for (const name of await FS.readDirectoryAsync(directory)) {
      const uri = directory + name, info = await FS.getInfoAsync(uri);
      if (info.exists && info.isDirectory) await visit(uri + '/');
      else if (info.exists) bytes += info.size;
    }
  }
  await visit(storage());
  return { bytes, freeBytes: await FS.getFreeDiskStorageAsync() };
}
