import { ActivityIndicator } from 'react-native';
import { useProfile } from '@/features/profile/context';
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function BuddyInvite() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { accessibility, ready } = useProfile();
  if (!ready) return <ActivityIndicator />;
  return <Redirect href={{ pathname: accessibility.length === 0 ? '/buddy-add' : '/buddy', params: { code: code ?? '' } }} />;
}
