import type { ExpoConfig } from 'expo/config';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
const usesLocalHttpApi = /^http:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(apiBaseUrl);

const config: ExpoConfig = {
  name: 'EvacuAid',
  slug: 'evacuaid-foundation',
  scheme: 'evacuaid',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  platforms: ['ios', 'android'],
  ios: {
    bundleIdentifier: process.env.IOS_BUNDLE_IDENTIFIER || 'dev.evacuaid.foundation',
    supportsTablet: false,
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      ...(usesLocalHttpApi ? {
        NSLocalNetworkUsageDescription: 'EvacuAid connects to your development API server on the local network.',
        NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      } : {}),
    },
  },
  android: {
    package: process.env.ANDROID_PACKAGE || 'dev.evacuaid.foundation',
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },
  extra: { androidMapConfigured: Boolean(process.env.ANDROID_GOOGLE_MAPS_API_KEY) },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-secure-store',
    ['expo-location', { locationWhenInUsePermission: 'Allow EvacuAid to save your current location when you choose.' }],
    ['expo-splash-screen', { backgroundColor: '#F3F6FA' }],
    ['expo-font', { android: { fonts: [{ fontFamily: 'Inter', fontDefinitions: [
      { path: './node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf', weight: 400 },
      { path: './node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf', weight: 500 },
      { path: './node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf', weight: 600 },
      { path: './node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf', weight: 700 },
    ] }] } }],
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.ANDROID_GOOGLE_MAPS_API_KEY || '' }],
    '@rnmapbox/maps',
    './plugins/with-ios-scene-lifecycle',
  ],
};

export default config;
