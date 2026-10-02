import { Redirect, useLocalSearchParams } from 'expo-router';

export default function BuddyInvite() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <Redirect href={{ pathname: '/buddy', params: { code: code ?? '' } }} />;
}
