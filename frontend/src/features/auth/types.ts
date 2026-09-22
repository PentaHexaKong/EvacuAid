export type ProfilePreferences = {
  language: 'id' | 'en';
  largerText: boolean;
  strongerContrast: boolean;
  onboardingCompleted: boolean;
};

export type Profile = {
  id: string;
  name: string | null;
  preferences: ProfilePreferences;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'bearer';
  expiresIn: number;
  profile: Profile;
};

export type StoredSession = Pick<AuthResponse, 'accessToken' | 'refreshToken'>;

export type ProfileUpdate = {
  name?: string;
  preferences?: Partial<ProfilePreferences>;
};
