import { useAccess } from '@/features/access/use-access';
import { DiscoverScreen } from '@/screens/discover';

// The tab is hidden for voice Home, but its screen can still mount; a map nobody can reach should not load.
export default function Discover() {
  return useAccess().voiceHome ? null : <DiscoverScreen />;
}
