import { act, fireEvent, render } from '@testing-library/react-native';
import { DeleteAccountScreen } from './delete-account';

const mockDelete = jest.fn();
jest.mock('@/features/profile/session',()=>({useGuestSession:()=>({deleteAccount:mockDelete})}));
jest.mock('@/features/location/alert-area',()=>({stopAlertArea:jest.fn().mockResolvedValue(undefined)}));
jest.mock('@/features/preferences/context',()=>({usePreferences:()=>({preferences:{}})}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:20,bottom:10})}));
jest.mock('react-i18next',()=>({useTranslation:()=>({i18n:{language:'en'},t:(key:string)=>jest.requireActual('../localization/en.json')[key]??key})}));
beforeEach(()=>jest.clearAllMocks());

const submit=async(view:ReturnType<typeof render>,password='secret-password')=>{
 fireEvent.changeText(view.getByPlaceholderText('Password'),password);
 await act(async()=>fireEvent.press(view.getByRole('button',{name:'Delete account'})));
};
test('cannot submit without a password',()=>{
 const view=render(<DeleteAccountScreen />);
 fireEvent.press(view.getByRole('button',{name:'Delete account'}));
 expect(mockDelete).not.toHaveBeenCalled();
});
test('sends the typed password',async()=>{
 mockDelete.mockResolvedValue(undefined);
 await submit(render(<DeleteAccountScreen />));
 expect(mockDelete).toHaveBeenCalledWith('secret-password');
});
test.each([[403,'That password is not right.'],[409,'You cannot delete this account right now. Finish or cancel any active buddy request first.'],[undefined,'The account was not deleted. Check your connection and try again.']])('failure %s tells the person what to do',async(status,message)=>{
 mockDelete.mockRejectedValue(Object.assign(new Error('x'),{status}));
 const view=render(<DeleteAccountScreen />);await submit(view);
 expect(view.getByRole('alert')).toHaveTextContent(message);
});
