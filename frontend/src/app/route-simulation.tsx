import { Redirect } from 'expo-router';
import { RouteSimulationScreen } from '@/screens/route-simulation';

export default function RouteSimulationPage() {
  return __DEV__ ? <RouteSimulationScreen /> : <Redirect href="/" />;
}
