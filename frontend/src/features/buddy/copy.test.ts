import { readableIssue, statusSentence } from './copy';

const c = (key: string) => `<${key}>`;

test('native diagnostics become plain copy, other messages pass through', () => {
  expect(readableIssue("FunctionCallException: Calling the 'getCurrentPositionAsync' function has failed → Caused by: LocationUnavailable: Cannot obtain current location (kCLErrorDomain error 0.)", c)).toBe('<locationMissing>. <locationHint>');
  expect(readableIssue('Error Domain=SFSpeechRecognizerErrorDomain Code=1', c)).toBe('<deviceUnavailable>');
  expect(readableIssue('fresh accurate availability location required', c)).toBe('<locationMissing>');
  expect(readableIssue('fresh accurate session location required', c)).toBe('<partnerLocationOld>');
  expect(readableIssue('Phone number has not been shared.', c)).toBe('Phone number has not been shared.');
  expect(readableIssue(null, c)).toBeNull();
});

test('status pieces join into sentences without doubled full stops or empty fragments', () => {
  expect(statusSentence(['Andi has arrived. Tap Confirm we have met.', "Andi's location isn't available yet"])).toBe("Andi has arrived. Tap Confirm we have met. Andi's location isn't available yet");
  expect(statusSentence(['You confirmed you are safe', '', null, false])).toBe('You confirmed you are safe');
});
