import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FieldOperationsScreen } from './field-operations';
import { enqueueSubmission, pendingSubmissions } from '@/features/operations/outbox';
import { apiRequest } from '@/features/profile/api';
const mockUser={id:'citizen'};
const mockTranslate=(key:string)=>key;
const mockPush=jest.fn();
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush})}));
jest.mock('expo-crypto',()=>({randomUUID:()=> 'stable-submission'}));
jest.mock('react-i18next',()=>({useTranslation:()=>({t:mockTranslate})}));
jest.mock('@/features/profile/session',()=>({useGuestSession:()=>({user:mockUser,token:'token'})}));
jest.mock('@/features/profile/api',()=>({apiRequest:jest.fn().mockRejectedValue(new Error('offline'))}));
jest.mock('@/features/offline/package-manager',()=>({discoverRegions:jest.fn().mockResolvedValue([])}));
jest.mock('@/features/operations/outbox',()=>({enqueueSubmission:jest.fn().mockResolvedValue(undefined),flushSubmissions:jest.fn().mockResolvedValue([]),pendingSubmissions:jest.fn().mockResolvedValue([]),discardSubmission:jest.fn()}));
jest.mock('@react-native-community/netinfo',()=>({__esModule:true,default:{addEventListener:()=>()=>{}}}));
jest.mock('@/components/discover-map',()=>({DiscoverMap:()=>null}));
jest.mock('@/components/ui',()=>{
  const React=require('react'); const {View,Text,TextInput,Pressable}=require('react-native');
  return {Page:({children}:any)=>React.createElement(View,null,children),Panel:({children}:any)=>React.createElement(View,null,children),AppText:({children,...props}:any)=>React.createElement(Text,props,children),Field:(props:any)=>React.createElement(TextInput,props),ActionButton:({label,onPress,disabled}:any)=>React.createElement(Pressable,{accessibilityRole:'button',accessibilityLabel:label,disabled,onPress},React.createElement(Text,null,label))};
});
beforeEach(()=>jest.clearAllMocks());

test('a consented incident is queued before sending even while backend is unreachable',async()=>{
  const view=render(<FieldOperationsScreen/>);
  await waitFor(()=>expect(apiRequest).toHaveBeenCalled());
  fireEvent.changeText(view.getByLabelText('opsDescription'),'Bridge blocked by debris');
  fireEvent.changeText(view.getByLabelText('opsLatitude'),'-6.26');
  fireEvent.changeText(view.getByLabelText('opsLongitude'),'106.81');
  fireEvent(view.getByLabelText('opsLocationConsent'),'valueChange',true);
  fireEvent.press(view.getByRole('button',{name:'opsSubmit'}));
  await waitFor(()=>expect(enqueueSubmission).toHaveBeenCalledWith(expect.objectContaining({id:'stable-submission',userId:'citizen',endpoint:'/v1/field-reports',payload:expect.objectContaining({latitude:-6.26,longitude:106.81,kind:'BLOCKED_ROAD',publicLocationConsent:true})})));
});

test('queued status is visible during backend outage without claiming receipt',async()=>{
  jest.mocked(pendingSubmissions).mockResolvedValueOnce([{id:'queued',userId:'citizen',endpoint:'/v1/field-reports',payload:{kind:'BLOCKED_ROAD',observedAt:'2026-10-12T00:00:00Z'}}]);
  const view=render(<FieldOperationsScreen/>);
  await waitFor(()=>expect(view.getByText(/opsQueued/)).toBeTruthy());
  expect(enqueueSubmission).not.toHaveBeenCalled();
});

test('government action and current assigned shelter are visible only through owner API',async()=>{
  jest.mocked(apiRequest).mockImplementation(async(path:string)=>path==='/v1/operations/my-assistance' ? [{requestId:'case-owner',status:'EVACUATING',government:{status:'DISPATCHED',note:'Public assembly route assigned'},assignedRoute:{shelterId:'shelter',usable:true,expiresAt:new Date(Date.now()+60000).toISOString()}}] as any : []);
  const view=render(<FieldOperationsScreen/>);
  await waitFor(()=>expect(view.getByText(/Public assembly route assigned/)).toBeTruthy());
  fireEvent.press(view.getByRole('button',{name:'opsNavigate'}));
  expect(mockPush).toHaveBeenCalledWith({pathname:'/evacuate',params:{shelterId:'shelter'}});
  expect(apiRequest).toHaveBeenCalledWith('/v1/operations/my-assistance','token');
});

test('an expired assigned route cannot be used as a current government recommendation',async()=>{
  jest.mocked(apiRequest).mockImplementation(async(path:string)=>path==='/v1/operations/my-assistance' ? [{requestId:'case-owner',status:'EVACUATING',government:{status:'DISPATCHED',note:'Expired assignment'},assignedRoute:{shelterId:'shelter',usable:true,expiresAt:new Date(Date.now()-60000).toISOString()}}] as any : []);
  const view=render(<FieldOperationsScreen/>);
  await waitFor(()=>expect(view.getByText(/Expired assignment/)).toBeTruthy());
  expect(view.queryByRole('button',{name:'opsNavigate'})).toBeNull();
});
