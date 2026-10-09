import { fireEvent, render, renderHook } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { ActionButton, CheckOption } from './ui';
import { SystemReduceMotionContext } from '@/theme';

jest.mock('@/features/preferences/context', () => ({ usePreferences: () => ({ preferences: { largerText: false, strongerContrast: false } }) }));

const scaleOf = (node: { props: { style: unknown } }) => (StyleSheet.flatten(node.props.style as never) as { transform?: { scale?: number }[] }).transform?.find(item => 'scale' in item)?.scale ?? 1;

test('buttons scale on press-in and settle on press-out', () => {
  const view = render(<SystemReduceMotionContext.Provider value={false}><ActionButton label="Save" /></SystemReduceMotionContext.Provider>);
  const surface = view.getByRole('button', { name: 'Save' }).children[0] as never;
  fireEvent(view.getByRole('button', { name: 'Save' }), 'pressIn');
  expect(scaleOf(surface)).toBe(0.96);
  fireEvent(view.getByRole('button', { name: 'Save' }), 'pressOut');
  expect(scaleOf(surface)).toBe(1);
});

test('Reduce Motion keeps press colour feedback but drops the scale', () => {
  const view = render(<SystemReduceMotionContext.Provider value={true}><ActionButton label="Save" /></SystemReduceMotionContext.Provider>);
  const button = view.getByRole('button', { name: 'Save' });
  fireEvent(button, 'pressIn');
  expect(scaleOf(button.children[0] as never)).toBe(1);
});

test('check options are checkboxes that report their state', () => {
  const onToggle = jest.fn();
  const view = render(<CheckOption label="Larger text" checked={false} onToggle={onToggle} />);
  const box = view.getByRole('checkbox', { name: 'Larger text' });
  expect(box).toHaveProp('accessibilityState', expect.objectContaining({ checked: false }));
  fireEvent.press(box);
  expect(onToggle).toHaveBeenCalledWith(true);
});


let mockLargeTargets = false;
jest.mock('@/features/access/use-access', () => ({ useAccess: () => ({ largeTargets: mockLargeTargets }) }));
beforeEach(() => { mockLargeTargets = false; });
test.each([false, true])('button heights follow largeTargets (%s)', largeTargets => {
  mockLargeTargets = largeTargets;
  const view = render(<><ActionButton label="Full" /><ActionButton compact label="Compact" /></>);
  const full = view.getByRole('button', { name: 'Full' }).children[0] as unknown as { props: { style: StyleProp<ViewStyle> } };
  const compact = view.getByRole('button', { name: 'Compact' }).children[0] as unknown as { props: { style: StyleProp<ViewStyle> } };
  expect(StyleSheet.flatten(full.props.style).minHeight).toBe(largeTargets ? 60 : 52);
  expect(StyleSheet.flatten(compact.props.style).minHeight).toBe(largeTargets ? 52 : 44);
});

test('access capabilities are safe without providers', () => {
  const useAccess = jest.requireActual('@/features/access/use-access').useAccess as typeof import('@/features/access/use-access').useAccess;
  const { result } = renderHook(() => useAccess());
  expect(result.current.largeTargets).toBe(false);
  expect(result.current.soundFree).toBe(false);
});


test('button detail is visible and included in its accessible label', () => {
  const view = render(<ActionButton label="Ask Sari for help" detail="Shares your location with Sari" />);
  expect(view.getByRole('button', { name: "Ask Sari for help. Shares your location with Sari" })).toBeTruthy();
  expect(view.getByText("Shares your location with Sari")).toBeTruthy();
});
