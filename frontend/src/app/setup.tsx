import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/features/auth/context';
import { SetupScreen } from '@/screens/setup';
import { colors } from '@/theme';

export default function SetupRoute() {
  const { updateProfile } = useAuth();
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}><SetupScreen onDone={() => updateProfile({ preferences: { onboardingCompleted: true } })} /></SafeAreaView>;
}
