import { apiClient } from '../api-client/api-client';
import type { CuisineHierarchyItem } from '../cuisine/cuisine.api';

export type OnboardingStep = 'company' | 'shop' | 'branch' | 'complete';

export type OnboardingStatus = {
  step: OnboardingStep;
  onboarding_completed: boolean;
  role: string;
  account_type: 'home' | 'business';
  erp_ready: boolean;
  company: {
    id: string;
    name: string;
    business_type: string;
    register_number: string | null;
    phone: string | null;
    address: string | null;
    billing_address: string | null;
    document_language: string | null;
  } | null;
  shops: Array<{
    id: string;
    name: string;
    cuisine_id: string | null;
    outlet_type: string | null;
  }>;
  branches: Array<{
    id: string;
    shop_id: string;
    shop_name: string | null;
    name: string;
    delivery_address: string | null;
    recipient_name: string | null;
    phone: string | null;
    type: string | null;
  }>;
  pendingInvitations: Array<{
    id: string;
    email: string;
    branchName: string;
    inviteUrl: string;
    expiresAt: string;
  }>;
};

export type BranchInvitePreview = {
  email: string;
  branchName: string;
  companyName: string;
  role: string;
  expiresAt: string;
  status: string;
};

export type CompanyRegisterProfile = {
  company: {
    id: string;
    name: string;
    register_number: string | null;
    business_type: string;
    address: string | null;
    billing_address: string | null;
    phone: string | null;
  };
  shops: Array<{
    id: string;
    name: string;
    address: string | null;
    cuisine_id: string | null;
    outlet_type: string | null;
  }>;
  branches: Array<{
    id: string;
    shop_id: string;
    shop_name: string | null;
    name: string;
    delivery_address: string | null;
    recipient_name: string | null;
    phone: string | null;
    type: string | null;
  }>;
};

export type CheckExistingRegisterResult = {
  in_josh: boolean;
  source: 'josh' | 'dbd' | 'manual';
  use_join_flow: boolean;
  already_registered: boolean;
  register_number: string;
  name: string;
  name_en: string | null;
  juristic_type: string | null;
  status: string | null;
  address: string | null;
  company: CompanyRegisterProfile['company'] | null;
  shops: CompanyRegisterProfile['shops'];
  branches: CompanyRegisterProfile['branches'];
};

export const checkExistingRegister = async (
  registerNumber: string,
): Promise<CheckExistingRegisterResult> => {
  const response = await apiClient.get<CheckExistingRegisterResult>(
    '/onboarding/check-existing',
    { params: { register_number: registerNumber } },
  );
  return response.data;
};

/** @deprecated Use `checkExistingRegister` */
export const lookupJuristicRegister = async (
  registerNumber: string,
): Promise<
  Pick<
    CheckExistingRegisterResult,
    | 'source'
    | 'in_josh'
    | 'register_number'
    | 'name'
    | 'name_en'
    | 'juristic_type'
    | 'status'
    | 'address'
    | 'use_join_flow'
  >
> => {
  const result = await checkExistingRegister(registerNumber);
  return {
    source: result.source,
    in_josh: result.in_josh,
    register_number: result.register_number,
    name: result.name,
    name_en: result.name_en,
    juristic_type: result.juristic_type,
    status: result.status,
    address: result.address,
    use_join_flow: result.use_join_flow,
  };
};

export const getOnboardingStatus = async (): Promise<OnboardingStatus> => {
  const response = await apiClient.get<OnboardingStatus>('/onboarding/status');
  return response.data;
};

/** @deprecated Prefer `getCuisineCatalog` from cuisine API. */
export const getOnboardingCuisineCatalog = async (): Promise<
  CuisineHierarchyItem[]
> => {
  const response = await apiClient.get<{
    statusCode: number;
    data: CuisineHierarchyItem[];
  }>('/onboarding/cuisine');
  return response.data?.data ?? [];
};

/** @deprecated Use `checkExistingRegister` */
export const getCompanyRegister = async (
  registerNumber: string,
): Promise<CompanyRegisterProfile> => {
  const result = await checkExistingRegister(registerNumber);
  if (!result.in_josh || !result.company) {
    throw new Error('Company not found in Josh');
  }
  return {
    company: result.company,
    shops: result.shops,
    branches: result.branches,
  };
};

export type StaffJoinOtpVerifyResult = {
  verified: true;
  verificationToken: string;
  register_number: string;
};

export type StaffJoinProfileFields = {
  first_name?: string;
  last_name?: string;
  nickname?: string;
  job_title?: string;
  recipient_name?: string;
  phone?: string;
};

export type StaffJoinPayload = StaffJoinProfileFields &
  (
  | {
      register_number: string;
      verificationToken: string;
      branch_id: string;
      /** Updates branch.recipient_name (latest value wins over owner default). */
      branch_update?: {
        name?: string;
        phone?: string;
        delivery_address?: string;
        delivery_note?: string;
        recipient_name?: string;
        type?: string;
      };
    }
  | {
      register_number: string;
      verificationToken: string;
      shop_id: string;
      branch: {
        name: string;
        phone: string;
        delivery_address?: string;
        recipient_name?: string;
        type?: string;
      };
    }
  | {
      register_number: string;
      verificationToken: string;
      shop: {
        name: string;
        cuisine_id?: string;
        outlet_type?: string;
      };
      branch: {
        name: string;
        phone: string;
        delivery_address?: string;
        recipient_name?: string;
        type?: string;
      };
    }
  );

export type StaffJoinOtpStatus = {
  expiresIn: number;
  expiresAt: string;
  resendRemaining: number;
  /** Wrong attempts left on the current OTP code (max 3). */
  codeAttemptsRemaining: number;
  /** Wrong attempts left across all codes before 30-minute lock (max 15). */
  verifyAttemptsRemaining: number;
  adminNotificationCount: number;
  /** Ref จาก SMS แอดมิน — staff เทียบกับข้อความที่แอดมินได้รับ */
  referenceCode?: string;
};

export const postStaffJoinSendOtp = async (payload: {
  register_number: string;
}): Promise<StaffJoinOtpStatus> => {
  const response = await apiClient.post<StaffJoinOtpStatus>(
    '/onboarding/join/send-otp',
    payload,
  );
  return response.data;
};

export const postStaffJoinResendOtp = async (payload: {
  register_number: string;
}): Promise<StaffJoinOtpStatus> => {
  const response = await apiClient.post<StaffJoinOtpStatus>(
    '/onboarding/join/resend-otp',
    payload,
  );
  return response.data;
};

export const postStaffJoinVerifyOtp = async (payload: {
  register_number: string;
  otp: string;
}): Promise<StaffJoinOtpVerifyResult> => {
  const response = await apiClient.post<StaffJoinOtpVerifyResult>(
    '/onboarding/join/verify-otp',
    payload,
  );
  return response.data;
};

export const postStaffJoin = async (
  payload: StaffJoinPayload,
): Promise<OnboardingStatus> => {
  const response = await apiClient.post<OnboardingStatus>(
    '/onboarding/join',
    payload,
  );
  return response.data;
};

export const postOnboardingCompany = async (payload: {
  name: string;
  business_type: 'individual' | 'juristic';
  register_number?: string;
  phone: string;
  address?: string;
  billing_address?: string;
  document_language?: 'thai' | 'english';
}): Promise<OnboardingStatus> => {
  const response = await apiClient.post<OnboardingStatus>(
    '/onboarding/company',
    payload,
  );
  return response.data;
};

export const postOnboardingShop = async (payload: {
  name: string;
  cuisine_id?: string;
  outlet_type?: string;
}): Promise<OnboardingStatus> => {
  const response = await apiClient.post<OnboardingStatus>(
    '/onboarding/shop',
    payload,
  );
  return response.data;
};

export const postOnboardingBranch = async (payload: {
  shop_id: string;
  name: string;
  delivery_address?: string;
  recipient_name?: string;
  phone: string;
  type?: string;
}): Promise<
  OnboardingStatus & {
    invitations: Array<{ email: string; inviteUrl: string }>;
  }
> => {
  const response = await apiClient.post<
    OnboardingStatus & {
      invitations: Array<{ email: string; inviteUrl: string }>;
    }
  >('/onboarding/branch', payload);
  return response.data;
};

export const postOnboardingComplete = async (): Promise<OnboardingStatus> => {
  const response = await apiClient.post<OnboardingStatus>('/onboarding/complete');
  return response.data;
};

export const getBranchInvitePreview = async (
  token: string,
): Promise<BranchInvitePreview> => {
  const response = await apiClient.get<BranchInvitePreview>(
    `/onboarding/invite/${token}`,
  );
  return response.data;
};

export const postAcceptBranchInvite = async (payload: {
  token: string;
  first_name: string;
  last_name: string;
  password: string;
  mobile_phone: string;
  job_title: string;
}) => {
  const response = await apiClient.post('/onboarding/invite/accept', payload);
  return response.data;
};

