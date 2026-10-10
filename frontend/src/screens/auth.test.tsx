import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthScreen } from './auth';
import en from '@/localization/en.json';
const mockLogin=jest.fn(), mockRegister=jest.fn();
jest.mock('@/features/profile/session',()=>({GUEST_TOKEN_KEY:'guest',useAuthSession:()=>({login:mockLogin,register:mockRegister,error:null})}));
jest.mock('expo-secure-store',()=>({getItemAsync:jest.fn().mockResolvedValue(null)}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:20,bottom:10})}));
jest.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>jest.requireActual('../localization/en.json')[key]??key})}));
beforeEach(()=>{jest.clearAllMocks();mockLogin.mockResolvedValue(undefined);mockRegister.mockResolvedValue(undefined);});

test('downloaded regions can be opened without logging in',async()=>{
 const open=jest.fn();const view=render(<AuthScreen onOffline={open} />);await act(async()=>{});
 fireEvent.press(view.getByRole('button',{name:en.offlineTitle}));
 expect(open).toHaveBeenCalledTimes(1);expect(mockLogin).not.toHaveBeenCalled();
});
test('login sends credentials and blocks duplicate submissions',async()=>{
 let complete!:()=>void;mockLogin.mockImplementationOnce(()=>new Promise<void>(done=>{complete=done;}));
 const view=render(<AuthScreen />);await act(async()=>{});
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
 const view=render(<AuthScreen />);await act(async()=>{});fireEvent.changeText(view.getByLabelText(en.authEmail),'citizen@example.com');fireEvent.changeText(view.getByLabelText(en.authPassword),'wrong');
 await act(async()=>fireEvent.press(view.getByRole('button',{name:en.authSignIn})));
 expect(view.getByRole('alert')).toHaveTextContent(en.authInvalidCredentials);expect(view.getByLabelText(en.authEmail).props.value).toBe('citizen@example.com');
});
test('guest upgrade is available only when saved and explicitly selected',async()=>{
 jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('guest-secret');const view=render(<AuthScreen />);await act(async()=>{});
 fireEvent.press(view.getByRole('button',{name:en.authNeedAccount}));await waitFor(()=>expect(view.getByRole('button',{name:en.authUpgradeGuest})).toBeTruthy());
 fireEvent.press(view.getByRole('button',{name:en.authUpgradeGuest}));fireEvent.changeText(view.getByLabelText(en.authEmail),'citizen@example.com');fireEvent.changeText(view.getByLabelText(en.authPassword),'a-long-password');
 await act(async()=>fireEvent.press(view.getByRole('button',{name:en.authCreateAccount})));
 expect(mockRegister).toHaveBeenCalledWith('citizen@example.com','a-long-password','',true);
});
