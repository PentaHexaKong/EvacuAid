import { Redirect } from 'expo-router';
import { OverviewScreen } from '@/screens/foundation-preview';
export default function Preview() {
  return __DEV__ ? <OverviewScreen /> : <Redirect href="/" />;
}
