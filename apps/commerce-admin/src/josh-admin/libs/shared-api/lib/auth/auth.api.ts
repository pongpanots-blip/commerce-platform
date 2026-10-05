import { apiClient } from '../api-client/api-client';

export type AuthDevicePlatform = 'web' | 'ios' | 'android';

export type AuthDeviceContext = {
  individual_id?: string;
  platform?: AuthDevicePlatform;
};

export type DeviceIdentity = {
  individual_id: string;
  user_id: string | null;
  platform: string;
  linked: boolean;
  first_seen_at?: string;
  last_seen_at?: string;
};

export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  job_title?: string | null;
  account_type?: 'home' | 'business' | null;
  pdpa_consent?: boolean;
};

export type AuthMeBranch = {
  id: string;
  name: string;
  shop_id: string;
  shop_name: string | null;
  delivery_address: string | null;
  recipient_name: string | null;
  phone: string | null;
  type: string | null;
  cuisine_type_id?: string | null;
  cuisine_type_name?: string | null;
};

export type AuthMeCredit = {
  eligible: boolean;
  companyName: string | null;
  creditLimit: number;
  creditUsed: number;
  creditAvailable: number;
  creditTermDays: number;
  reason: string | null;
};

export type AuthMeTier = {
  name: string;
  color: string;
};

/**
 * Profile My Orders badges: company owner and staff → active branch;
 * B2C → own orders. `shippingOrComplete` counts in-transit orders only.
 */
export type AuthMeOrderCounts = {
  unpaid: number;
  preparing: number;
  /** Shipping badge — in-transit orders only (name is historical; delivered not counted). */
  shippingOrComplete: number;
  refunded: number;
};

export type AuthMe = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  mobile_phone: string | null;
  recipient_name: string | null;
  role: string;
  job_title: string | null;
  account_type: 'home' | 'business';
  pdpa_consent: boolean;
  onboarding_completed: boolean;
  active_branch_id: string | null;
  company: {
    id: string;
    name: string;
    business_type: string;
    register_number: string | null;
    document_language: string | null;
    phone: string | null;
    address: string | null;
    billing_address: string | null;
  } | null;
  branches: AuthMeBranch[];
  /** super_admin only */
  credit?: AuthMeCredit;
  /** null when the user has no customer_metrics row or no tier assigned */
  tier: AuthMeTier | null;
  orderCounts: AuthMeOrderCounts;
};

export type SwitchBranchResult = {
  active_branch_id: string;
  branch: AuthMeBranch;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

export type RefreshSessionResult = {
  accessToken: string;
  refreshToken: string;
};

export type SignUpAvailability = {
  available: boolean;
  field?: 'email' | 'mobile_phone';
  message?: string;
  resumeSignup?: boolean;
};

export type EmailOtpStatus = {
  email: string;
  expiresIn: number;
  expiresAt: string;
  resendRemaining: number;
  /** Wrong attempts left on the current OTP code (max 3). */
  codeAttemptsRemaining: number;
  /** Wrong attempts left across all codes before 30-minute lock (max 15). */
  verifyAttemptsRemaining: number;
};

export type EmailOtpVerifyResult = {
  verified: true;
  verificationToken: string;
  email: string;
};

export type PasswordResetOtpVerifyResult = {
  verified: true;
  resetToken: string;
  verificationToken: string;
  email: string;
};

export type PasswordResetResult = {
  reset: true;
};

export type ChangePasswordResult = {
  changed: true;
  accessToken: string;
  refreshToken: string;
};

export type DeleteAccountResult = {
  deleted: true;
  emailReusable: true;
  registerNumberReusable: false;
};

export const getAuthMe = async (): Promise<AuthMe> => {
  const response = await apiClient.get<AuthMe>('/auth/me');
  return response.data;
};

export const postSwitchBranch = async (payload: {
  branch_id: string;
}): Promise<SwitchBranchResult> => {
  const response = await apiClient.post<SwitchBranchResult>(
    '/auth/switch-branch',
    payload,
  );
  return response.data;
};

export const postChangePassword = async (payload: {
  currentPassword: string;
  newPassword: string;
  confirmPassword?: string;
}): Promise<ChangePasswordResult> => {
  const response = await apiClient.post<ChangePasswordResult>(
    '/auth/change-password',
    payload,
  );
  return response.data;
};

export const postDeleteAccount = async (payload: {
  password: string;
  confirm: true;
}): Promise<DeleteAccountResult> => {
  const response = await apiClient.post<DeleteAccountResult>(
    '/auth/delete-account',
    payload,
  );
  return response.data;
};

export const postLogin = async (payload: {
  email: string;
  password: string;
} & AuthDeviceContext): Promise<AuthResponse> => {
  const response = await apiClient.post<AuthResponse>('/auth/login', payload);
  return response.data;
};

export const postRefreshSession = async (payload?: {
  refreshToken?: string;
}): Promise<RefreshSessionResult> => {
  const response = await apiClient.post<RefreshSessionResult>(
    '/auth/refresh',
    payload ?? {},
  );
  return response.data;
};

export const postLogout = async (payload?: {
  refreshToken?: string;
}): Promise<{ ok: true }> => {
  const response = await apiClient.post<{ ok: true }>(
    '/auth/logout',
    payload ?? {},
  );
  return response.data;
};

export const postSignUp = async (payload: {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  verificationToken: string;
  /** Optional for home users; company onboarding still sends it */
  job_title?: string;
  account_type?: 'home' | 'business';
  mobile_phone?: string;
  nickname?: string;
  pdpa_consent?: boolean;
  consent?: boolean;
  marketing_consent?: boolean;
} & AuthDeviceContext): Promise<AuthResponse> => {
  const response = await apiClient.post<AuthResponse>('/auth/signup', payload);
  return response.data;
};

export const checkSignUpAvailability = async (payload: {
  email?: string;
  mobile_phone?: string;
}): Promise<SignUpAvailability> => {
  const response = await apiClient.post<SignUpAvailability>(
    '/auth/signup/check-availability',
    payload,
  );
  return response.data;
};

export const getDeviceIdentity = async (
  individualId: string,
): Promise<DeviceIdentity> => {
  const response = await apiClient.get<DeviceIdentity>('/auth/device-identity', {
    params: { individual_id: individualId },
  });
  return response.data;
};

export const sendEmailOtp = async (email: string): Promise<EmailOtpStatus> => {
  const response = await apiClient.post<EmailOtpStatus>('/auth/email-otp/send', {
    email,
  });
  return response.data;
};

export const resendEmailOtp = async (email: string): Promise<EmailOtpStatus> => {
  const response = await apiClient.post<EmailOtpStatus>(
    '/auth/email-otp/resend',
    { email },
  );
  return response.data;
};

export const verifyEmailOtp = async (payload: {
  email: string;
  otp: string;
}): Promise<EmailOtpVerifyResult> => {
  const response = await apiClient.post<EmailOtpVerifyResult>(
    '/auth/email-otp/verify',
    payload,
  );
  return response.data;
};

export const sendPasswordResetOtp = async (
  email: string,
): Promise<EmailOtpStatus> => {
  const response = await apiClient.post<EmailOtpStatus>(
    '/auth/password-reset/otp/send',
    { email },
  );
  return response.data;
};

export const resendPasswordResetOtp = async (
  email: string,
): Promise<EmailOtpStatus> => {
  const response = await apiClient.post<EmailOtpStatus>(
    '/auth/password-reset/otp/resend',
    { email },
  );
  return response.data;
};

export const verifyPasswordResetOtp = async (payload: {
  email: string;
  otp: string;
}): Promise<PasswordResetOtpVerifyResult> => {
  const response = await apiClient.post<PasswordResetOtpVerifyResult>(
    '/auth/password-reset/otp/verify',
    payload,
  );
  return response.data;
};

export const postPasswordReset = async (payload: {
  email: string;
  resetToken?: string;
  verificationToken?: string;
  password: string;
  confirmPassword?: string;
}): Promise<PasswordResetResult> => {
  const response = await apiClient.post<PasswordResetResult>(
    '/auth/password-reset',
    payload,
  );
  return response.data;
};

/** Mobile alias of `sendPasswordResetOtp` → POST /auth/forgot-password */
export const sendForgotPasswordOtp = async (
  email: string,
): Promise<EmailOtpStatus> => {
  const response = await apiClient.post<EmailOtpStatus>(
    '/auth/forgot-password',
    { email },
  );
  return response.data;
};

/** Mobile alias of `verifyPasswordResetOtp` → POST /auth/forgot-password/verify */
export const verifyForgotPasswordOtp = async (payload: {
  email: string;
  otp: string;
}): Promise<PasswordResetOtpVerifyResult> => {
  const response = await apiClient.post<PasswordResetOtpVerifyResult>(
    '/auth/forgot-password/verify',
    payload,
  );
  return response.data;
};

/** Mobile alias of `postPasswordReset` → POST /auth/reset-password */
export const postResetPassword = async (payload: {
  email: string;
  resetToken?: string;
  verificationToken?: string;
  password: string;
  confirmPassword?: string;
}): Promise<PasswordResetResult> => {
  const response = await apiClient.post<PasswordResetResult>(
    '/auth/reset-password',
    payload,
  );
  return response.data;
};
