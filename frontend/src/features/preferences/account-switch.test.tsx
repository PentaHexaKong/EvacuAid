import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { PreferencesProvider, usePreferences } from './context';
import { PREFERENCES_KEY } from './storage';
import { apiRequest } from '@/features/profile/api';
let mockSession:{token:string;user:{id:string};account?:{id:string}}={token:'token-a',user:{id:'user-a'}};
jest.mock('@/features/profile/session',()=>({useGuestSession:()=>mockSession}));
jest.mock('@/features/profile/api',()=>({...jest.requireActual('@/features/profile/api'),apiRequest:jest.fn()}));
jest.mock('@/localization',()=>({selectLanguage:jest.fn().mockResolvedValue(undefined)}));
const remote={voice_enabled:true,vibration_enabled:true,text_enabled:true,language:'id',larger_text:true,stronger_contrast:false};
beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear();mockSession={token:'token-a',user:{id:'user-a'}};});
test('signing into another account reads its settings without overwriting them with device defaults',async()=>{
 await AsyncStorage.setItem(PREFERENCES_KEY,'{"completed":true}');
 await AsyncStorage.setItem('evacuaid.preferences.synced-user.v1','user-a');
 await AsyncStorage.setItem('evacuaid.language.v1','en');
 mockSession={token:'token-b',user:{id:'user-b'}};jest.mocked(apiRequest).mockResolvedValue(remote);
 const {result}=renderHook(usePreferences,{wrapper:PreferencesProvider});
 await waitFor(()=>expect(result.current.preferences.largerText).toBe(true));
 expect(apiRequest).toHaveBeenCalledWith('/v1/users/user-b/preferences','token-b');
 expect(jest.mocked(apiRequest).mock.calls.every(call=>call[2]?.method!=='PUT')).toBe(true);
});
test('a late preferences response from the previous account does not replace the current account',async()=>{
 await AsyncStorage.setItem('evacuaid.preferences.synced-user.v1','user-a');
 let release!:(value:unknown)=>void;
 jest.mocked(apiRequest).mockImplementation(path=>path.includes('user-a')?new Promise(done=>{release=done;}):Promise.resolve(remote));
 const view=renderHook(usePreferences,{wrapper:PreferencesProvider});await waitFor(()=>expect(release).toBeDefined());
 mockSession={token:'token-b',user:{id:'user-b'}};view.rerender({});
 await waitFor(()=>expect(view.result.current.preferences.largerText).toBe(true));
 await act(async()=>release({...remote,larger_text:false}));
 expect(view.result.current.preferences.largerText).toBe(true);
 expect(await AsyncStorage.getItem('evacuaid.preferences.synced-user.v1')).toBe('user-b');
});

test('existing account settings are preserved on a first login on this device',async()=>{
 await AsyncStorage.setItem(PREFERENCES_KEY,'{"completed":true,"largerText":false}');
 mockSession={token:'token-a',user:{id:'user-a'},account:{id:'user-a'}};
 jest.mocked(apiRequest).mockResolvedValue(remote);
 const {result}=renderHook(usePreferences,{wrapper:PreferencesProvider});
 await waitFor(()=>expect(result.current.preferences.largerText).toBe(true));
 expect(apiRequest).toHaveBeenCalledWith('/v1/users/user-a/preferences','token-a');
 expect(jest.mocked(apiRequest).mock.calls.every(call=>call[2]?.method!=='PUT')).toBe(true);
});

test('signing in keeps the language picked on this phone instead of the account default',async()=>{
 const {selectLanguage}=jest.requireMock('@/localization');
 await AsyncStorage.setItem(PREFERENCES_KEY,'{"completed":true}');
 await AsyncStorage.setItem('evacuaid.language','en');
 mockSession={token:'token-a',user:{id:'user-a'},account:{id:'user-a'}};
 jest.mocked(apiRequest).mockImplementation((_path,_token,init)=>Promise.resolve(init?.method==='PUT'?JSON.parse(String(init.body)):remote));
 const {result}=renderHook(usePreferences,{wrapper:PreferencesProvider});
 await waitFor(()=>expect(result.current.preferences.language).toBe('en'));
 expect(JSON.parse(String(jest.mocked(apiRequest).mock.calls.find(call=>call[2]?.method==='PUT')?.[2]?.body))).toMatchObject({language:'en',larger_text:true});
 expect(selectLanguage).toHaveBeenLastCalledWith('en');
});
