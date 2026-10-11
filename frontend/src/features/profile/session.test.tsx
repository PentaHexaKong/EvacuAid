import { act, renderHook } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { apiRequest, type UserProfile } from './api';
import { GuestSessionProvider, useAuthSession } from './session';
import { authSession, AUTH_KEY, createAuthSession, GUEST_TOKEN_KEY, type AuthTokens } from './auth-session';

jest.mock('expo-secure-store',()=>({ getItemAsync:jest.fn(),setItemAsync:jest.fn(),deleteItemAsync:jest.fn(),AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:1 }));
jest.mock('./api',()=>({ apiRequest:jest.fn(),configureAuthRecovery:jest.fn() }));
const pair = (suffix='1'): AuthTokens => ({ access_token:'access-'+suffix,refresh_token:'refresh-'+suffix,expires_in:900,refresh_expires_in:3600,
  user:{id:'user-1',email:'citizen@example.com',name:'Dwi',role:'CITIZEN'} });
const wrapper = ({children}:{children:React.ReactNode})=><GuestSessionProvider>{children}</GuestSessionProvider>;
beforeEach(async()=>{
  jest.resetAllMocks();jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);jest.mocked(SecureStore.deleteItemAsync).mockResolvedValue(undefined);
  jest.mocked(apiRequest).mockResolvedValue(undefined);
  await authSession.signOut();jest.clearAllMocks();
});

test('no credentials shows sign in and never creates a guest',async()=>{
 const {result}=renderHook(useAuthSession,{wrapper});
 await act(async()=>result.current.ensureGuest());
 expect(result.current.status).toBe('signed-out');expect(apiRequest).not.toHaveBeenCalled();
});
test('login loads the profile and stores only the refresh secret',async()=>{
 jest.mocked(apiRequest).mockResolvedValueOnce(pair()).mockResolvedValueOnce({id:'user-1',name:'Dwi'} as UserProfile);
 const {result}=renderHook(useAuthSession,{wrapper});
 await act(async()=>result.current.login('citizen@example.com','a-long-password'));
 expect(result.current.status).toBe('ready');expect(result.current.token).toBe('access-1');
 const stored=jest.mocked(SecureStore.setItemAsync).mock.calls[0][1];
 expect(JSON.parse(stored)).toEqual({refreshToken:'refresh-1',userId:'user-1'});
 expect(stored).not.toContain('access-1');expect(stored).not.toContain('a-long-password');
});
test('restores via refresh, with one rotation for concurrent requests',async()=>{
 const manager=createAuthSession();
 jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({refreshToken:'refresh-old',userId:'user-1'}));
 jest.mocked(apiRequest).mockResolvedValue(pair());
 const values=await Promise.all([manager.restore(),manager.restore(),manager.restore()]);
 expect(values.every(value=>value?.access_token==='access-1')).toBe(true);expect(apiRequest).toHaveBeenCalledTimes(1);
});
test('concurrent expired requests share rotation and old closures use the newest JWT',async()=>{
 const manager=createAuthSession();jest.mocked(apiRequest).mockResolvedValueOnce({...pair(),expires_in:0}).mockResolvedValueOnce(pair('2'));
 await manager.authenticate('login','citizen@example.com','a-long-password');
 const values=await Promise.all([manager.current('access-1'),manager.current('access-1')]);
 expect(values).toEqual(['access-2','access-2']);expect(apiRequest).toHaveBeenCalledTimes(2);
 expect(await manager.recover('access-1')).toBe('access-2');expect(apiRequest).toHaveBeenCalledTimes(2);
});
test.each([401,undefined])('failed refresh (%s) clears the secret and never retries it',async(status)=>{
 const manager=createAuthSession();jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({refreshToken:'old',userId:'user-1'}));
 jest.mocked(apiRequest).mockRejectedValue(Object.assign(new Error('refresh failed'),{status}));
 await expect(manager.restore()).rejects.toThrow('refresh failed');
 expect(manager.get()).toBeNull();expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(AUTH_KEY);
 jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);await manager.restore();expect(apiRequest).toHaveBeenCalledTimes(1);
});
test('logout clears local credentials even when revocation cannot reach server',async()=>{
 const manager=createAuthSession();jest.mocked(apiRequest).mockResolvedValueOnce(pair()).mockRejectedValueOnce(new Error('offline'));
 await manager.authenticate('login','citizen@example.com','a-long-password');await manager.signOut();
 expect(manager.get()).toBeNull();await expect(manager.current('access-1')).rejects.toMatchObject({status:401});
 expect(apiRequest).toHaveBeenLastCalledWith('/v1/auth/logout',undefined,{method:'POST',body:JSON.stringify({refresh_token:'refresh-1'})});
});
test('registration upgrades a guest only by explicit choice and sends no role',async()=>{
 const manager=createAuthSession();jest.mocked(SecureStore.getItemAsync).mockResolvedValue('guest-secret');jest.mocked(apiRequest).mockResolvedValue(pair());
 await manager.authenticate('register',' citizen@example.com ','a-long-password','Dwi',true);
 expect(apiRequest).toHaveBeenCalledWith('/v1/auth/register','guest-secret',{method:'POST',body:JSON.stringify({email:'citizen@example.com',password:'a-long-password',name:'Dwi'})});
 expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(GUEST_TOKEN_KEY);
});
test('secure storage failure revokes the newly issued family',async()=>{
 const manager=createAuthSession();jest.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error('keychain unavailable'));jest.mocked(apiRequest).mockResolvedValue(pair());
 await expect(manager.authenticate('login','citizen@example.com','a-long-password')).rejects.toThrow('keychain unavailable');
 expect(manager.get()).toBeNull();expect(apiRequest).toHaveBeenLastCalledWith('/v1/auth/logout',undefined,expect.anything());
});
test('logout during rotation cannot restore a signed out account',async()=>{
 const manager=createAuthSession();jest.mocked(apiRequest).mockResolvedValueOnce(pair());await manager.authenticate('login','citizen@example.com','a-long-password');
 let resolve!:(value:AuthTokens)=>void;
 jest.mocked(apiRequest).mockImplementationOnce(()=>new Promise(done=>{resolve=done;})).mockResolvedValue(undefined);
 const rotation=manager.refresh().catch(()=>null);await manager.signOut();resolve(pair('2'));await rotation;
 expect(manager.get()).toBeNull();
});
const keyStore = () => {
  const saved = new Map<string,string>();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key=>saved.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key,value)=>{ saved.set(key,value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key=>{ saved.delete(key); });
  return saved;
};
test('a guest is created once, survives leaving guest mode and resumes on restore',async()=>{
 const saved=keyStore();const manager=createAuthSession();
 jest.mocked(apiRequest).mockResolvedValueOnce({access_token:'guest-secret',user:{id:'guest-1',name:null}});
 const started=await manager.startGuest();
 expect(started.access_token).toBe('guest-secret');expect(started.user.email).toBeNull();expect(manager.isGuest()).toBe(true);
 expect(saved.get(GUEST_TOKEN_KEY)).toBe('guest-secret');
 await manager.signOut();
 expect(manager.get()).toBeNull();expect(saved.get(GUEST_TOKEN_KEY)).toBe('guest-secret');
 expect(apiRequest).not.toHaveBeenCalledWith('/v1/auth/logout',expect.anything(),expect.anything());
 jest.mocked(apiRequest).mockResolvedValueOnce({id:'guest-1',name:'Dwi'});
 const resumed=await manager.restore();
 expect(resumed?.access_token).toBe('guest-secret');expect(resumed?.user.id).toBe('guest-1');
 expect(apiRequest).toHaveBeenLastCalledWith('/v1/me',undefined,{headers:{Authorization:'Bearer guest-secret'}});
 expect(await manager.current('guest-secret')).toBe('guest-secret');
});
test('an expired guest is forgotten so the choice screen shows again',async()=>{
 const saved=keyStore();saved.set(GUEST_TOKEN_KEY,'stale');const manager=createAuthSession();
 jest.mocked(apiRequest).mockRejectedValueOnce(Object.assign(new Error('Unauthorized'),{status:401,kind:'http'}));
 expect(await manager.restore()).toBeNull();expect(saved.has(GUEST_TOKEN_KEY)).toBe(false);
});
test('a guest rejected mid-session signs out instead of retrying',async()=>{
 const saved=keyStore();const manager=createAuthSession();
 jest.mocked(apiRequest).mockResolvedValueOnce({access_token:'guest-secret',user:{id:'guest-1',name:null}});
 await manager.startGuest();
 await expect(manager.recover('guest-secret')).rejects.toMatchObject({status:401});
 expect(manager.get()).toBeNull();expect(saved.has(GUEST_TOKEN_KEY)).toBe(false);
});
test('only a newly created guest is marked fresh, once',async()=>{
 keyStore();const manager=createAuthSession();
 jest.mocked(apiRequest).mockResolvedValueOnce({access_token:'guest-secret',user:{id:'guest-1',name:null}});
 await manager.startGuest();
 expect(manager.takeFreshGuest('other')).toBe(false);expect(manager.takeFreshGuest('guest-1')).toBe(true);expect(manager.takeFreshGuest('guest-1')).toBe(false);
});
