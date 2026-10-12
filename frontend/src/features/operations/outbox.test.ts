import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '@/features/profile/api';
import { enqueueSubmission, flushSubmissions, pendingSubmissions, discardSubmission, type PendingSubmission } from './outbox';
jest.mock('@/features/profile/api',()=>({apiRequest:jest.fn()}));
const submission=(id:string,userId='citizen'):PendingSubmission=>({id,userId,endpoint:'/v1/field-reports',payload:{kind:'BLOCKED_ROAD',observedAt:'2026-10-12T00:00:00Z'}});
beforeEach(async()=>{await AsyncStorage.clear();jest.mocked(apiRequest).mockReset();});

test('network loss retains a durable submission and retry preserves its id',async()=>{
  await enqueueSubmission(submission('retry-id'));
  jest.mocked(apiRequest).mockRejectedValueOnce(Object.assign(new Error('offline'),{kind:'network'}));
  await flushSubmissions('citizen','token');
  expect(await pendingSubmissions('citizen')).toHaveLength(1);
  jest.mocked(apiRequest).mockResolvedValueOnce({id:'retry-id'});
  await flushSubmissions('citizen','token');
  expect(await pendingSubmissions('citizen')).toHaveLength(0);
  expect(JSON.parse(jest.mocked(apiRequest).mock.calls[1][2]!.body as string).id).toBe('retry-id');
});

test('switching account never sends or discards another citizen submissions',async()=>{
  await enqueueSubmission(submission('private-other','other'));
  await flushSubmissions('citizen','token');await discardSubmission('citizen','private-other');
  expect(apiRequest).not.toHaveBeenCalled();expect(await pendingSubmissions('other')).toHaveLength(1);
});

test('concurrent enqueue and flush preserve both submissions',async()=>{
  jest.mocked(apiRequest).mockResolvedValue({});
  await Promise.all([enqueueSubmission(submission('a')),enqueueSubmission(submission('b'))]);
  await Promise.all([flushSubmissions('citizen','token'),flushSubmissions('citizen','token')]);
  expect(apiRequest).toHaveBeenCalledTimes(2);expect(await pendingSubmissions('citizen')).toEqual([]);
});

test('validation failure remains visible and server failures remain retryable',async()=>{
  await enqueueSubmission(submission('invalid'));await enqueueSubmission(submission('server'));
  jest.mocked(apiRequest).mockRejectedValueOnce(Object.assign(new Error('Expired observation'),{kind:'http',status:422})).mockRejectedValueOnce(Object.assign(new Error('Unavailable'),{kind:'http',status:503}));
  const pending=await flushSubmissions('citizen','token');
  expect(pending[0].error).toBe('Expired observation');expect(pending[1].error).toBeUndefined();
});

test('corrupted local queue is reported rather than overwritten',async()=>{
  await AsyncStorage.setItem('evacuaid.operations.outbox.v1','corrupt');
  await expect(enqueueSubmission(submission('new'))).rejects.toThrow();
  expect(await AsyncStorage.getItem('evacuaid.operations.outbox.v1')).toBe('corrupt');
});
