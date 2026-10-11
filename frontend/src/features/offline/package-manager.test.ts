import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { fixtureManifest, testKeys, resign } from './test-fixture';

const mockFiles = new Map<string, Uint8Array>();
const mockDirs = new Set<string>();
let mockFree = 1024 ** 3;
let mockMetered = false;
let mockCorruptDownload = false;
let mockInterrupt = false;
const mockRequests: { url: string; range: string }[] = [];
const mockRemote = new Map<string, Uint8Array>();
const mockBytes = (text: string) => new TextEncoder().encode(text);
const mockText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const mockExists = (uri: string) => mockFiles.has(uri) || mockDirs.has(uri.replace(/\/$/, ''));
const mockDirectory = (uri: string) => {
  const normalized = uri.replace(/\/$/, '');
  let current = normalized;
  while (current.startsWith('file://')) {
    mockDirs.add(current);
    const parent = current.slice(0, current.lastIndexOf('/'));
    if (parent === current) break;
    current = parent;
  }
};
const mockNames = (uri: string) => {
  const prefix = uri.replace(/\/$/, '') + '/';
  return [...new Set([...mockFiles.keys(), ...mockDirs].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length).split('/')[0]).filter(Boolean))];
};
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  makeDirectoryAsync: async (uri: string) => mockDirectory(uri),
  readDirectoryAsync: async (uri: string) => mockNames(uri),
  getInfoAsync: async (uri: string) => ({ exists: mockExists(uri), isDirectory: mockDirs.has(uri.replace(/\/$/, '')), size: mockFiles.get(uri)?.length ?? 0 }),
  readAsStringAsync: async (uri: string) => {
    if (!mockFiles.has(uri)) throw new Error('missing');
    return mockText(mockFiles.get(uri)!);
  },
  writeAsStringAsync: async (uri: string, value: string) => { mockFiles.set(uri, mockBytes(value)); },
  getFreeDiskStorageAsync: async () => mockFree,
  deleteAsync: async (uri: string) => {
    for (const key of [...mockFiles.keys()]) if (key === uri || key.startsWith(uri.replace(/\/$/, '') + '/')) mockFiles.delete(key);
    for (const key of [...mockDirs]) if (key === uri.replace(/\/$/, '') || key.startsWith(uri.replace(/\/$/, '') + '/')) mockDirs.delete(key);
  },
  copyAsync: async ({ from, to }: { from: string; to: string }) => mockFiles.set(to, mockFiles.get(from)!.slice()),
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    if (mockFiles.has(from)) { mockFiles.set(to, mockFiles.get(from)!); mockFiles.delete(from); return; }
    for (const key of [...mockFiles.keys()]) if (key.startsWith(from)) { mockFiles.set(to + key.slice(from.length), mockFiles.get(key)!); mockFiles.delete(key); }
    for (const key of [...mockDirs]) if (key.startsWith(from.replace(/\/$/, ''))) { mockDirs.add(to.replace(/\/$/, '') + key.slice(from.replace(/\/$/, '').length)); mockDirs.delete(key); }
  },
  createDownloadResumable: (url: string, uri: string, options: { headers: { Range: string } }) => ({
    downloadAsync: async () => {
      mockRequests.push({ url, range: options.headers.Range });
      if (mockInterrupt) { mockInterrupt = false; throw new Error('connection interrupted'); }
      const checksum = url.split('/assets/')[1].split('?')[0];
      const content = mockRemote.get(checksum) ?? mockBytes('{}');
      const [start, end] = options.headers.Range.replace('bytes=', '').split('-').map(Number);
      const bytes = content.slice(start, end + 1);
      if (mockCorruptDownload) bytes[0] ^= 1;
      mockFiles.set(uri, bytes);
      return { status: 206 };
    },
    cancelAsync: async () => {},
  }),
}));
jest.mock('expo-file-system', () => ({
  FileMode: { ReadOnly: 'r' },
  File: class {
    uri: string;
    constructor(value: string) { this.uri = value; }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri)?.length ?? 0; }
    create() { mockFiles.set(this.uri, new Uint8Array()); }
    delete() { mockFiles.delete(this.uri); }
    rename(name: string) {
      const target = this.uri.slice(0, this.uri.lastIndexOf('/') + 1) + name;
      if (mockFiles.has(target)) throw new Error('already exists');
      mockFiles.set(target, mockFiles.get(this.uri)!); mockFiles.delete(this.uri); this.uri = target;
    }
    open() {
      const uri = this.uri;
      return {
        offset: 0,
        readBytes(length: number) {
          const bytes = mockFiles.get(uri)!.slice(this.offset, this.offset + length);
          this.offset += bytes.length; return bytes;
        },
        writeBytes(bytes: Uint8Array) {
          const old = mockFiles.get(uri) ?? new Uint8Array();
          const updated = new Uint8Array(Math.max(old.length, this.offset + bytes.length));
          updated.set(old); updated.set(bytes, this.offset); this.offset += bytes.length; mockFiles.set(uri, updated);
        },
        close() {},
      };
    }
  },
}));
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: async () => ({ type: mockMetered ? 'cellular' : 'wifi', details: { isConnectionExpensive: mockMetered } }) } }));
jest.mock('@/features/profile/api', () => ({ apiRequest: jest.fn() }));
import { installPackage, installedPackages, rollbackPackage, deletePackage, hashFile } from './package-manager';

beforeEach(() => {
  mockFiles.clear(); mockDirs.clear(); mockRequests.length = 0; mockRemote.clear();
  mockFree = 1024 ** 3; mockMetered = false; mockCorruptDownload = false; mockInterrupt = false;
  process.env.EXPO_PUBLIC_OFFLINE_KEY_ID = 'fixture-key';
  process.env.EXPO_PUBLIC_OFFLINE_PUBLIC_KEY = testKeys['fixture-key'];
});
test('installs only verified files and discovers an immutable committed version', async () => {
  await installPackage(fixtureManifest(), jest.fn());
  const entries = await installedPackages();
  expect(entries).toHaveLength(1);
  expect(entries[0].manifest.packageId).toBe('a'.repeat(64));
  expect(mockRequests).toHaveLength(1); // Identical assets reuse their verified object.
});
test('insufficient storage and metered connections fail before network transfer', async () => {
  mockFree = 0;
  await expect(installPackage(fixtureManifest(), jest.fn())).rejects.toThrow('INSUFFICIENT_STORAGE');
  expect(mockRequests).toHaveLength(0);
  mockFree = 1024 ** 3; mockMetered = true;
  await expect(installPackage(fixtureManifest(), jest.fn())).rejects.toThrow('METERED_CONSENT_REQUIRED');
  expect(mockRequests).toHaveLength(0);
  await installPackage(fixtureManifest(), jest.fn(), true);
});
test('corrupted download cannot replace a valid installed package', async () => {
  await installPackage(fixtureManifest(), jest.fn());
  const update = fixtureManifest('b');
  update.assets[0].sha256 = '0'.repeat(64); update.contentChecksums[update.assets[0].path] = '0'.repeat(64);
  mockCorruptDownload = true;
  await expect(installPackage(resign(update), jest.fn())).rejects.toThrow('CHECKSUM_MISMATCH');
  expect((await installedPackages())[0].manifest.packageId).toBe('a'.repeat(64));
});
test('retains the preceding valid version for explicit rollback and deletion', async () => {
  await installPackage(fixtureManifest(), jest.fn());
  await installPackage(fixtureManifest('b'), jest.fn());
  await rollbackPackage(fixtureManifest().regionId);
  expect((await installedPackages())[0].manifest.packageId).toBe('a'.repeat(64));
  await deletePackage(fixtureManifest().regionId);
  expect(await installedPackages()).toEqual([]);
  expect(mockNames('file:///documents/offline-packages/objects/')).toEqual([]);
});
test('recovers a corrupt current manifest through the preceding fully verified package', async () => {
  await installPackage(fixtureManifest(), jest.fn());
  await installPackage(fixtureManifest('b'), jest.fn());
  const current = (await installedPackages())[0];
  mockFiles.set(current.directory + 'manifest.json', mockBytes('corrupted'));
  expect((await installedPackages())[0].manifest.packageId).toBe('a'.repeat(64));
});
test('recovers an interrupted graph download from a persisted byte offset', async () => {
  const manifest = fixtureManifest();
  const content = new Uint8Array(4 * 1024 * 1024 + 3).fill(9);
  const checksum = bytesToHex(sha256(content));
  manifest.assets.push({ kind: 'routing', path: 'routing/2/fixture.gph', sha256: checksum, sizeBytes: content.length });
  manifest.contentChecksums['routing/2/fixture.gph'] = checksum;
  manifest.packageSizeBytes += content.length; resign(manifest);
  mockRemote.set(checksum, content);
  // Simulate a previous process having persisted the first verified transfer range.
  const region = 'file:///documents/offline-packages/' + manifest.regionId + '/';
  mockDirectory(region);
  mockFiles.set(region + checksum + '.part', content.slice(0, 4 * 1024 * 1024));
  await installPackage(manifest, jest.fn());
  expect(mockRequests.find(request => request.url.includes(checksum))?.range).toBe('bytes=4194304-4194306');
});
test('a network interruption preserves the previous installation and can be retried', async () => {
  mockInterrupt = true;
  await expect(installPackage(fixtureManifest(), jest.fn())).rejects.toThrow('interrupted');
  expect(await installedPackages()).toEqual([]);
  await installPackage(fixtureManifest(), jest.fn());
  expect(await installedPackages()).toHaveLength(1);
});
test('hashes large files in bounded chunks and rejects size changes', async () => {
  const bytes = new Uint8Array(130000).fill(1);
  mockFiles.set('file:///graph', bytes);
  expect(await hashFile('file:///graph', bytes.length)).toBe(bytesToHex(sha256(bytes)));
  await expect(hashFile('file:///graph', bytes.length + 1)).rejects.toThrow('SIZE_MISMATCH');
});
