import { useState } from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { Group } from './grouped-list';

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
