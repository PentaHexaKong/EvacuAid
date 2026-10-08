import { useState } from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { Group, Row } from './grouped-list';

test('removing the first keyed row preserves remaining row state', () => {
  let mounts = 0;
  function StatefulRow({ name }: { name: string }) {
    const [mount] = useState(() => ++mounts);
    return <Text>{name}:{mount}</Text>;
  }
  const { getByText, rerender } = render(<Group>{['first', 'second', 'third'].map(name => <StatefulRow key={name} name={name} />)}</Group>);
  expect(getByText('second:2')).toBeTruthy();
  expect(getByText('third:3')).toBeTruthy();
  rerender(<Group>{['second', 'third'].map(name => <StatefulRow key={name} name={name} />)}</Group>);
  expect(getByText('second:2')).toBeTruthy();
  expect(getByText('third:3')).toBeTruthy();
  expect(mounts).toBe(3);
});


let mockLargeTargets = false;
jest.mock('@/features/access/use-access', () => ({ useAccess: () => ({ largeTargets: mockLargeTargets }) }));
beforeEach(() => { mockLargeTargets = false; });
test.each([false, true])('row heights follow largeTargets (%s)', largeTargets => {
  mockLargeTargets = largeTargets;
  const view = render(<><Row title="Press" onPress={() => {}} /><Row title="Static" accessibilityLabel="Static" /></>);
  expect(view.getByRole('button', { name: 'Press' })).toHaveStyle({ minHeight: largeTargets ? 76 : 64 });
  expect(view.getByLabelText('Static')).toHaveStyle({ minHeight: largeTargets ? 76 : 64 });
});
