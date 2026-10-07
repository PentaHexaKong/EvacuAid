import { useMemo } from 'react';
import { usePreferences } from '../preferences/context';
import { useProfile } from '../profile/context';
import { accessFor, type Access } from './access';

export function useAccess(): Access {
  const { accessibility } = useProfile();
  const { preferences: { voiceEnabled, textEnabled } } = usePreferences();
  return useMemo(() => accessFor(accessibility.map(item => item.type), { voiceEnabled, textEnabled }), [accessibility, voiceEnabled, textEnabled]);
}
