import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthScreen } from './auth';
import en from '@/localization/en.json';
const mockLogin=jest.fn(), mockRegister=jest.fn(), mockGuest=jest.fn();
jest.mock('@/features/profile/session',()=>({GUEST_TOKEN_KEY:'guest',useAuthSession:()=>({login:mockLogin,register:mockRegister,continueAsGuest:mockGuest,error:null})}));
jest.mock('@/screens/setup',()=>({BrandBackdrop:()=>null}));
jest.mock('@/components/mascot',()=>({Mascot:()=>null}));
jest.mock('@/components/native-controls',()=>({LanguageMenu:()=>null}));
jest.mock('@/localization',()=>({selectLanguage:jest.fn()}));
jest.mock('@/features/preferences/context',()=>({usePreferences:()=>({preferences:{},save:jest.fn()})}));
jest.mock('expo-secure-store',()=>({getItemAsync:jest.fn().mockResolvedValue(null)}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:20,bottom:10})}));
jest.mock('react-i18next',()=>({useTranslation:()=>({i18n:{language:'en'},t:(key:string)=>jest.requireActual('../localization/en.json')[key]??key})}));
beforeEach(()=>{jest.clearAllMocks();mockLogin.mockResolvedValue(undefined);mockRegister.mockResolvedValue(undefined);mockGuest.mockResolvedValue(undefined);});
const signIn=(view:ReturnType<typeof render>)=>fireEvent.press(view.getByRole('button',{name:en.authSignIn}));
test('login sends credentials and blocks duplicate submissions',async()=>{
 let complete!:()=>void;mockLogin.mockImplementationOnce(()=>new Promise<void>(done=>{complete=done;}));
 const view=render(<AuthScreen />);await act(async()=>{});signIn(view);
 fireEvent.changeText(view.getByLabelText(en.authEmail),'citizen@example.com');fireEvent.changeText(view.getByLabelText(en.authPassword),'a-long-password');
 fireEvent.press(view.getByRole('button',{name:en.authSignIn}));fireEvent.press(view.getByRole('button',{name:en.authSignIn}));
 expect(mockLogin).toHaveBeenCalledTimes(1);expect(mockLogin).toHaveBeenCalledWith('citizen@example.com','a-long-password');
 await act(async()=>complete());expect(view.getByLabelText(en.authPassword).props.value).toBe('');
});
test('registration requires a long password and never includes a role',async()=>{
 const view=render(<AuthScreen />);await act(async()=>{});fireEvent.press(view.getByRole('button',{name:en.authNeedAccount}));
 fireEvent.changeText(view.getByLabelText(en.authEmail),'citizen@example.com');fireEvent.changeText(view.getByLabelText(en.authPassword),'short');
 fireEvent.press(view.getByRole('button',{name:en.authCreateAccount}));expect(view.getByRole('alert')).toHaveTextContent(en.authInvalidInput);expect(mockRegister).not.toHaveBeenCalled();
 fireEvent.changeText(view.getByLabelText(en.authPassword),'a-long-password');fireEvent.changeText(view.getByLabelText(en.authName),'Dwi');
 await act(async()=>fireEvent.press(view.getByRole('button',{name:en.authCreateAccount})));
 expect(mockRegister).toHaveBeenCalledWith('citizen@example.com','a-long-password','Dwi',false);
});
test('invalid credentials show a safe localized error and keep the form',async()=>{
 mockLogin.mockRejectedValueOnce(Object.assign(new Error('Invalid credentials'),{status:401}));
 const view=render(<AuthScreen />);await act(async()=>{});signIn(view);fireEvent.changeText(view.getByLabelText(en.authEmail),'citizen@example.com');fireEvent.changeText(view.getByLabelText(en.authPassword),'wrong');
 await act(async()=>fireEvent.press(view.getByRole('button',{name:en.authSignIn})));
 expect(view.getByRole('alert')).toHaveTextContent(en.authInvalidCredentials);expect(view.getByLabelText(en.authEmail).props.value).toBe('citizen@example.com');
});
test('a saved guest profile is kept by default and can be declined',async()=>{
 jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('guest-secret');const view=render(<AuthScreen />);await act(async()=>{});
 fireEvent.press(view.getByRole('button',{name:en.authNeedAccount}));await waitFor(()=>expect(view.getByRole('button',{name:en.authUpgradeSelected})).toBeTruthy());
 fireEvent.press(view.getByRole('button',{name:en.authUpgradeSelected}));fireEvent.press(view.getByRole('button',{name:en.authUpgradeGuest}));fireEvent.changeText(view.getByLabelText(en.authEmail),'citizen@example.com');fireEvent.changeText(view.getByLabelText(en.authPassword),'a-long-password');
 await act(async()=>fireEvent.press(view.getByRole('button',{name:en.authCreateAccount})));
 expect(mockRegister).toHaveBeenCalledWith('citizen@example.com','a-long-password','',true);
});
test('continue as guest starts a guest session once',async()=>{
 let complete!:()=>void;mockGuest.mockImplementationOnce(()=>new Promise<void>(done=>{complete=done;}));
 const view=render(<AuthScreen />);await act(async()=>{});
 const guest=view.getByRole('button',{name:new RegExp(en.entryGuest)});fireEvent.press(guest);fireEvent.press(guest);
 expect(mockGuest).toHaveBeenCalledTimes(1);await act(async()=>complete());
});
test('a server without guests says so and keeps the account options',async()=>{
 mockGuest.mockRejectedValueOnce(Object.assign(new Error('Guest sessions are disabled'),{status:404}));
 const view=render(<AuthScreen />);await act(async()=>{});
 await act(async()=>fireEvent.press(view.getByRole('button',{name:new RegExp(en.entryGuest)})));
 expect(view.getByRole('alert')).toHaveTextContent(en.authGuestUnavailable);expect(view.getByRole('button',{name:en.authSignIn})).toBeTruthy();
});
test('back returns from the form to the choice',async()=>{
 const view=render(<AuthScreen />);await act(async()=>{});signIn(view);
 fireEvent.press(view.getByRole('button',{name:en.back}));expect(view.getByRole('button',{name:new RegExp(en.entryGuest)})).toBeTruthy();
});
