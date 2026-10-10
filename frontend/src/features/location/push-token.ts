import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { buddyRequest } from '@/features/buddy/api';

export async function prepareNotificationChannel() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('buddy', { name: 'Buddy requests', importance: Notifications.AndroidImportance.HIGH });
}

export async function registerPushToken(token: string) {
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('Push is not configured in this build. In-app updates remain available.');
  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  await buddyRequest(token, '/push-token', 'PUT', { token: result.data });
}
