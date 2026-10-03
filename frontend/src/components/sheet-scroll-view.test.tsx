import { fireEvent, render } from '@testing-library/react-native';
import { SheetScrollView } from './sheet-scroll-view';

const mockSetOptions = jest.fn();
jest.mock('expo-router', () => ({ useNavigation: () => ({ setOptions: mockSetOptions }) }));

test('sheet header clears at the adjusted scroll origin and frosts only after scrolling', () => {
  const view = render(<SheetScrollView testID="sheet" />);
  const scroll = (y: number) => fireEvent.scroll(view.getByTestId('sheet'), { nativeEvent: { contentOffset: { x: 0, y }, contentInset: { top: 64, bottom: 0, left: 0, right: 0 } } });
  scroll(-64);
  expect(mockSetOptions).not.toHaveBeenCalled();
  scroll(-40);
  expect(mockSetOptions).toHaveBeenLastCalledWith({ headerBlurEffect: 'systemThinMaterialLight', headerStyle: { backgroundColor: 'rgba(235, 245, 255, 0.15)' } });
  scroll(100);
  expect(mockSetOptions).toHaveBeenCalledTimes(1);
  scroll(-64);
  expect(mockSetOptions).toHaveBeenLastCalledWith({ headerBlurEffect: undefined, headerStyle: { backgroundColor: 'transparent' } });
  scroll(-80);
  expect(mockSetOptions).toHaveBeenCalledTimes(2);
});
