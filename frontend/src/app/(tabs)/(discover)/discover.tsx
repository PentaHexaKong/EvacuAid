import { useAccess } from '@/features/access/use-access';
import { useProfile } from '@/features/profile/context';
import { DiscoverScreen } from '@/screens/discover';

// The tab is hidden for voice Home, but its screen can still mount; a map nobody can reach should not load.
// Waiting for the profile avoids mounting the map and tearing it down a moment later, which the map library reports as an error.
export default function Discover() {
  const { ready } = useProfile();
  const { voiceHome } = useAccess();
  return ready && !voiceHome ? <DiscoverScreen /> : null;
}
