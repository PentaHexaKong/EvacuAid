import { confirmCommand } from './confirm-command';

test.each([
  ['yes', 'yes'], ['Yes please', 'yes'], ['ya', 'yes'], ['iya', 'yes'],
  ['no', 'no'], ['tidak', 'no'], ['jangan', 'no'], ['not yes', 'no'], ["don't say yes", 'no'],
  ['yes, no', 'no'], ['bukan iya', 'no'], ['yesterday', null], ['maybe', null], ['', null],
] as const)('%s → %s', (text, expected) => { expect(confirmCommand(text)).toBe(expected); });
