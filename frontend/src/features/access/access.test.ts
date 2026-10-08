import { renderHook } from '@testing-library/react-native';
import { defaults } from '../preferences/storage';
import type { AccessibilityItem, AccessibilityType } from '../profile/context';
import { accessFor, type Access } from './access';
import { useAccess } from './use-access';

let mockAccessibility: AccessibilityItem[] = [];
let mockPreferences = { ...defaults };
jest.mock('../profile/context', () => ({ useProfile: () => ({ accessibility: mockAccessibility }) }));
jest.mock('../preferences/context', () => ({ usePreferences: () => ({ preferences: mockPreferences }) }));

const base: Access = {
  listen: true, autoRead: false, listFirst: false, voiceHome: false, captions: true,
  soundFree: false, stepFree: false, simpleHome: false, largeTargets: false,
};
const cases: { name: string; needs: readonly AccessibilityType[]; voiceEnabled?: boolean; textEnabled?: boolean; expected: Partial<Access> }[] = [
  { name: 'no needs with defaults', needs: [], expected: {} },
  { name: 'visual impairment', needs: ['VISUAL_IMPAIRMENT'], expected: { autoRead: true, listFirst: true, voiceHome: true } },
  { name: 'hearing impairment', needs: ['HEARING_IMPAIRMENT'], expected: { listen: false, soundFree: true } },
  { name: 'mobility limitation', needs: ['MOBILITY_LIMITATION'], expected: { stepFree: true } },
  { name: 'elderly', needs: ['ELDERLY'], expected: { simpleHome: true, largeTargets: true } },
  { name: 'visual impairment with voice off', needs: ['VISUAL_IMPAIRMENT'], voiceEnabled: false, expected: { listen: false, listFirst: true, voiceHome: true } },
  { name: 'hearing wins over visual with text off', needs: ['VISUAL_IMPAIRMENT', 'HEARING_IMPAIRMENT'], textEnabled: false, expected: { listen: false, soundFree: true, listFirst: true, voiceHome: true } },
  { name: 'mobility and elderly', needs: ['MOBILITY_LIMITATION', 'ELDERLY'], expected: { stepFree: true, simpleHome: true, largeTargets: true } },
  { name: 'other', needs: ['OTHER'], expected: {} },
  { name: 'unknown string', needs: ['UNKNOWN' as AccessibilityType], expected: {} },
  { name: 'text off without hearing impairment', needs: [], textEnabled: false, expected: { captions: false } },
  { name: 'voice off without needs', needs: [], voiceEnabled: false, expected: { listen: false } },
];

test.each(cases)('$name', ({ needs, voiceEnabled = defaults.voiceEnabled, textEnabled = defaults.textEnabled, expected }) => {
  expect(accessFor(needs, { voiceEnabled, textEnabled })).toEqual({ ...base, ...expected });
});

test('useAccess keeps its identity until needs or relevant switches change', () => {
  mockAccessibility = [];
  mockPreferences = { ...defaults };
  const view = renderHook(useAccess);
  const initial = view.result.current;
  view.rerender({});
  expect(view.result.current).toBe(initial);
  mockPreferences = { ...mockPreferences, largerText: true };
  view.rerender({});
  expect(view.result.current).toBe(initial);
  mockPreferences = { ...mockPreferences, voiceEnabled: false };
  view.rerender({});
  expect(view.result.current).not.toBe(initial);
  expect(view.result.current.listen).toBe(false);
  mockAccessibility = [{ type: 'VISUAL_IMPAIRMENT', severity: null }];
  view.rerender({});
  expect(view.result.current.listFirst).toBe(true);
  const visual = view.result.current;
  mockPreferences = { ...mockPreferences, textEnabled: false };
  view.rerender({});
  expect(view.result.current).not.toBe(visual);
  expect(view.result.current.captions).toBe(false);
});
