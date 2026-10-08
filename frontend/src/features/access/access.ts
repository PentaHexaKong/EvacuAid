import type { Preferences } from '../preferences/storage';
import type { AccessibilityType } from '../profile/context';

export type Access = {
  listen: boolean;
  autoRead: boolean;
  listFirst: boolean;
  voiceHome: boolean;
  captions: boolean;
  soundFree: boolean;
  stepFree: boolean;
  simpleHome: boolean;
  largeTargets: boolean;
};

export function accessFor(needs: readonly AccessibilityType[], preferences: Pick<Preferences, 'voiceEnabled' | 'textEnabled'>): Access {
  const soundFree = needs.includes('HEARING_IMPAIRMENT');
  const visual = needs.includes('VISUAL_IMPAIRMENT');
  const elderly = needs.includes('ELDERLY');
  return {
    listen: preferences.voiceEnabled && !soundFree,
    autoRead: visual && preferences.voiceEnabled && !soundFree,
    listFirst: visual,
    voiceHome: visual,
    captions: preferences.textEnabled || soundFree,
    soundFree,
    stepFree: needs.includes('MOBILITY_LIMITATION'),
    simpleHome: elderly,
    largeTargets: elderly,
  };
}
