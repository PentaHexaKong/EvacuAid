import type { ExpoConfig } from 'expo/config';

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
    infoPlist: { CFBundleAllowMixedLocalizations: true },
  },
  android: {
    package: process.env.ANDROID_PACKAGE || 'dev.evacuaid.foundation',
    blockedPermissions: ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.RECORD_AUDIO'],
  },
  extra: { androidMapConfigured: Boolean(process.env.ANDROID_GOOGLE_MAPS_API_KEY) },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-secure-store',
    ['expo-splash-screen', { backgroundColor: '#F3F6FA' }],
    ['expo-font', { fonts: [
      './node_modules/@expo-google-fonts/plus-jakarta-sans/400Regular/PlusJakartaSans_400Regular.ttf',
      './node_modules/@expo-google-fonts/plus-jakarta-sans/500Medium/PlusJakartaSans_500Medium.ttf',
      './node_modules/@expo-google-fonts/plus-jakarta-sans/600SemiBold/PlusJakartaSans_600SemiBold.ttf',
      './node_modules/@expo-google-fonts/plus-jakarta-sans/700Bold/PlusJakartaSans_700Bold.ttf',
    ] }],
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.ANDROID_GOOGLE_MAPS_API_KEY || '' }],
  ],
};

export default config;
