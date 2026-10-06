export const JOB_TITLE_VALUES = [
  'owner',
  'manager',
  'chef',
  'purchaser',
  'staff',
  'other',
] as const;

export type JobTitleValue = (typeof JOB_TITLE_VALUES)[number];

export const JOB_TITLE_OPTIONS: ReadonlyArray<{
  value: JobTitleValue;
  label: string;
  labelTh: string;
}> = [
  { value: 'owner', label: 'Owner', labelTh: 'เจ้าของ' },
  { value: 'manager', label: 'Manager', labelTh: 'ผู้จัดการ' },
  { value: 'chef', label: 'Chef', labelTh: 'เชฟ' },
  { value: 'purchaser', label: 'Purchaser', labelTh: 'จัดซื้อ' },
  { value: 'staff', label: 'Staff', labelTh: 'พนักงาน' },
  { value: 'other', label: 'Other', labelTh: 'อื่นๆ' },
];

export function jobTitleLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const option = JOB_TITLE_OPTIONS.find((item) => item.value === value);
  if (!option) return value;
  return `${option.label} / ${option.labelTh}`;
}
