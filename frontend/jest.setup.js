jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => ({ ...require('react-native-reanimated/mock'), cubicBezier: () => 'ease-out' }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()), notificationAsync: jest.fn(() => Promise.resolve()), impactAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' }, ImpactFeedbackStyle: { Light: 'light' } }));
// @expo/ui renders SwiftUI views; in Jest, stand in plain RN views that keep labels, roles and callbacks testable.
jest.mock('@expo/ui/swift-ui', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  const label = (modifiers = []) => modifiers.find(item => item && item.accessibilityLabel)?.accessibilityLabel;
  const tagOf = (modifiers = []) => modifiers.find(item => item && item.tag !== undefined)?.tag;
  return {
    Host: ({ children }) => React.createElement(View, null, children),
    HStack: ({ children }) => React.createElement(View, null, children),
    Image: () => null,
    Text: ({ children }) => React.createElement(Text, null, children),
    Menu: ({ modifiers, children }) => React.createElement(View, { accessible: true, accessibilityRole: 'button', accessibilityLabel: label(modifiers) }, children),
    VStack: ({ children }) => React.createElement(View, null, children),
    // Menu items carry a text label; icon buttons carry their label in an accessibilityLabel modifier.
    Button: ({ label: text, modifiers, onPress }) => React.createElement(Pressable, { accessibilityRole: text ? 'menuitem' : 'button', accessibilityLabel: text ?? label(modifiers), onPress }),
    Picker: ({ children, onSelectionChange }) => React.createElement(View, null, React.Children.map(children, option => React.createElement(Pressable, { accessibilityRole: 'menuitem', accessibilityLabel: option.props.children, onPress: () => onSelectionChange(tagOf(option.props.modifiers)) }))),
  };
});
jest.mock('@expo/ui/swift-ui/modifiers', () => ({ accessibilityLabel: accessibilityLabel => ({ accessibilityLabel }), font: () => ({}), foregroundStyle: () => ({}), pickerStyle: () => ({}), tag: tag => ({ tag }), buttonStyle: () => ({}), contentShape: () => ({}), disabled: () => ({}), frame: () => ({}), glassEffect: () => ({}), padding: () => ({}), shapes: { rectangle: () => ({}), capsule: () => ({}) } }));
// The speech recogniser is a native module; screens that can listen (Home, Buddy) import it, so every suite needs a stand-in.
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: { start: jest.fn(), stop: jest.fn(), abort: jest.fn(), requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })) },
  useSpeechRecognitionEvent: jest.fn(),
}));
