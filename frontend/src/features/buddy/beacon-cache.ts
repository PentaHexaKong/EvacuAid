import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { Contact } from './api';

export type BeaconIdentity = { beaconId: number; contacts: { beaconId: number; name: string | null }[] };
const key = (accountId: string) => `evacuaid.buddy.beacons.v1:${accountId}`;
export const validBeaconId = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 0xffffffff;

export async function readBeaconIdentity(accountId: string): Promise<BeaconIdentity> {
  try {
    const stored = JSON.parse(await AsyncStorage.getItem(key(accountId)) ?? 'null');
    if (validBeaconId(stored?.beaconId)) return { beaconId: stored.beaconId, contacts: Array.isArray(stored.contacts) ? stored.contacts.filter((contact: BeaconIdentity['contacts'][number]) => validBeaconId(contact?.beaconId) && (contact.name === null || typeof contact.name === 'string')) : [] };
  } catch {}
  const bytes = await Crypto.getRandomBytesAsync(4);
  const identity = { beaconId: new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) || 1, contacts: [] };
  await writeBeaconIdentity(accountId, identity);
  return identity;
}

export async function writeBeaconIdentity(accountId: string, identity: BeaconIdentity) {
  await AsyncStorage.setItem(key(accountId), JSON.stringify(identity));
}

export function beaconContacts(contacts: Contact[], incoming: Contact[]): BeaconIdentity['contacts'] {
  return [...contacts, ...incoming].filter(contact => contact.status === 'ACTIVE' && validBeaconId(contact.beaconId)).map(contact => ({ beaconId: contact.beaconId!, name: contact.name }));
}
