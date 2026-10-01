import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
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
