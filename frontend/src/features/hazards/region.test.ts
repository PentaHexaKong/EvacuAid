import { parseFeltIntensity, parseQuakeRegion } from './region';

test('parses every BMKG region format seen in the live feeds', () => {
  expect(parseQuakeRegion('Pusat gempa berada di laut 82 km Timur Laut RUTENG-MANGGARAI-NTT')).toEqual({ distanceKm: '82', direction: 'ne', place: 'Ruteng', area: 'Manggarai, NTT', setting: 'sea' });
  expect(parseQuakeRegion('34 km TimurLaut RUTENG-MANGGARAI-NTT')).toEqual({ distanceKm: '34', direction: 'ne', place: 'Ruteng', area: 'Manggarai, NTT', setting: null });
  expect(parseQuakeRegion('Pusat gempa berada di darat 2.7 km timur laut Mamasa')).toEqual({ distanceKm: '2.7', direction: 'ne', place: 'Mamasa', area: null, setting: 'land' });
  expect(parseQuakeRegion('Pusat gempa berada di laut 127 km Barat Daya Kota Sabang')).toMatchObject({ direction: 'sw', place: 'Kota Sabang', area: null });
  expect(parseQuakeRegion('Pusat gempa berada di Laut 31 km Barat Kab. Kupang')).toMatchObject({ direction: 'w', place: 'Kab. Kupang', setting: 'sea' });
  expect(parseQuakeRegion('Pusat gempa berada di laut 60 km utara Ruteng, Manggarai')).toMatchObject({ direction: 'n', place: 'Ruteng', area: 'Manggarai' });
  expect(parseQuakeRegion('156 km Tenggara KAB-MALANG-JATIM')).toMatchObject({ direction: 'se', place: 'Kab. Malang', area: 'Jatim' });
  expect(parseQuakeRegion('118 km BaratLaut JAILOLO-MALUT')).toMatchObject({ direction: 'nw', place: 'Jailolo', area: 'Malut' });
  expect(parseQuakeRegion('6 km Tenggara KEPSERIBU-DKI')).toMatchObject({ place: 'Kepseribu', area: 'DKI' });
});

test('unrecognised region text returns null so the card can show it raw', () => {
  expect(parseQuakeRegion('Somewhere unusual')).toBeNull();
  expect(parseQuakeRegion('')).toBeNull();
});

test('felt intensity keeps the full MMI range, with or without spaces', () => {
  expect(parseFeltIntensity('II-III Kab. Manggarai')).toEqual({ text: 'II-III', from: 2, to: 3 });
  expect(parseFeltIntensity('II - III Kab. Gorontalo Utara')).toEqual({ text: 'II-III', from: 2, to: 3 });
  expect(parseFeltIntensity('IV Kab. Kupang, IV Kota Kupang')).toEqual({ text: 'IV', from: 4, to: null });
  expect(parseFeltIntensity('III-IV Calang, III Aceh Besar')).toEqual({ text: 'III-IV', from: 3, to: 4 });
  expect(parseFeltIntensity('Dirasakan')).toBeNull();
  expect(parseFeltIntensity(null)).toBeNull();
});
