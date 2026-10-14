import { bearing, decodeBeacon, distanceM, encodeBeacon, proximity } from './beacon-codec';

const beacon = { role: 1 as const, beaconId: 0x12345678, latitude: -1, longitude: 10, accuracy: 7 };

it('round trips requester and helper payloads including unsigned IDs', () => {
  expect(decodeBeacon(encodeBeacon(beacon))).toEqual(beacon);
  const helper = { ...beacon, role: 2 as const, beaconId: 0xffffffff };
  expect(decodeBeacon(encodeBeacon(helper))).toEqual(helper);
});

it('decodes an ESP32 manufacturer data fixture after removing the company ID', () => {
  const manufacturer = Uint8Array.from('ff ff ea 11 78 56 34 12 80 69 67 ff 00 e1 f5 05 07'.split(' ').map(byte => parseInt(byte, 16)));
  expect(manufacturer[0] | manufacturer[1] << 8).toBe(0xffff);
  expect(decodeBeacon(manufacturer.slice(2))).toEqual(beacon);
  expect(decodeBeacon(manufacturer)).toBeNull();
});

it('handles missing fixes, latitude sentinel independent of longitude, and unknown accuracy', () => {
  const unknown = { ...beacon, latitude: null, longitude: null, accuracy: null };
  expect(decodeBeacon(encodeBeacon(unknown))).toEqual(unknown);
  const bytes = encodeBeacon(unknown);
  bytes.splice(10, 4, 0, 0, 0, 0);
  expect(decodeBeacon(bytes)).toEqual(unknown);
  expect(decodeBeacon(encodeBeacon({ ...beacon, accuracy: 999 }))?.accuracy).toBeNull();
  expect(decodeBeacon(encodeBeacon({ ...beacon, accuracy: 7.2 }))?.accuracy).toBe(8);
});

it.each([
  [], [0xea], Array(16).fill(0),
  [0, ...encodeBeacon(beacon).slice(1)],
  [0xea, 0x21, ...encodeBeacon(beacon).slice(2)],
  [0xea, 0x13, ...encodeBeacon(beacon).slice(2)],
  encodeBeacon(beacon).map((byte, index) => index === 5 ? 256 : byte),
  encodeBeacon(beacon).map((byte, index) => index === 5 ? -1 : byte),
  encodeBeacon(beacon).map((byte, index) => index === 5 ? 0.1 : byte),
  [0xea, 0x11, 0, 0, 0, 0, ...encodeBeacon(beacon).slice(6)],
].map(bytes => ({ bytes })))('rejects malformed payload $bytes', ({ bytes }) => expect(decodeBeacon(bytes)).toBeNull());

it('rejects out-of-range coordinates and invalid input identities', () => {
  const latitude = encodeBeacon(beacon);
  const bytes = Uint8Array.from(latitude);
  new DataView(bytes.buffer).setInt32(6, 910000000, true);
  expect(decodeBeacon(bytes)).toBeNull();
  new DataView(bytes.buffer).setInt32(6, 0, true);
  new DataView(bytes.buffer).setInt32(10, 1800000001, true);
  expect(decodeBeacon(bytes)).toBeNull();
  for (const beaconId of [0, -1, 1.1, 0x100000000]) expect(() => encodeBeacon({ ...beacon, beaconId })).toThrow();
  expect(() => encodeBeacon({ ...beacon, latitude: null })).toThrow();
  expect(() => encodeBeacon({ ...beacon, latitude: NaN })).toThrow();
  expect(() => encodeBeacon({ ...beacon, accuracy: -1 })).toThrow();
});

it('uses RSSI as a tunable category and bearings with existing distance math', () => {
  expect(proximity(-60)).toBe('near');
  expect(proximity(-61)).toBe('medium');
  expect(proximity(-76)).toBe('far');
  expect(proximity(-70, { near: -70, medium: -80 })).toBe('near');
  expect(proximity(127)).toBe('far');
  const origin = { latitude: 0, longitude: 0 };
  expect(bearing(origin, { latitude: 1, longitude: 0 })).toBeCloseTo(0);
  expect(bearing(origin, { latitude: 0, longitude: 1 })).toBeCloseTo(90);
  expect(distanceM(origin, { latitude: 0.001, longitude: 0 })).toBeCloseTo(111.195, 2);
});
