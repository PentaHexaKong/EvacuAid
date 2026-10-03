import Constants from 'expo-constants';

export const DEFAULT_MAPBOX_STYLE_URL = 'mapbox://styles/mapbox/standard';

export function mapboxToken() {
  const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN?.trim();
  return token?.startsWith('pk.') ? token : undefined;
}

export function mapboxStyleUrl() {
  return process.env.EXPO_PUBLIC_MAPBOX_STYLE_URL?.trim() || DEFAULT_MAPBOX_STYLE_URL;
}

export function usesMapbox() {
  return Constants.appOwnership !== 'expo' && mapboxToken() !== undefined;
}
