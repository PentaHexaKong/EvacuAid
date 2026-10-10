import { useEffect, useState } from 'react';

// A screen that arrives uninvited can slide in under a finger already on its way to something else.
// Its actions stay inert for a moment so that tap cannot decline a request or answer a warning by accident.
export function useArmed(delayMs = 600) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  return armed;
}
