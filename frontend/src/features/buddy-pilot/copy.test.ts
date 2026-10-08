import { readableIssue } from './copy';

const c = (key: string) => `<${key}>`;

test('native diagnostics become plain copy, other messages pass through', () => {
  expect(readableIssue("FunctionCallException: Calling the 'getCurrentPositionAsync' function has failed → Caused by: LocationUnavailable: Cannot obtain current location (kCLErrorDomain error 0.)", c)).toBe('<locationMissing>. <locationHint>');
  expect(readableIssue('Error Domain=SFSpeechRecognizerErrorDomain Code=1', c)).toBe('<deviceUnavailable>');
  expect(readableIssue('Phone number has not been shared.', c)).toBe('Phone number has not been shared.');
  expect(readableIssue(null, c)).toBeNull();
});
