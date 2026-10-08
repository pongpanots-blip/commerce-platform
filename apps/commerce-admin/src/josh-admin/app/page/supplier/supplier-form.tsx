import { FormSection } from '@cp/ui';
import { Input } from '@josh/shared-ui-web';
import type { ChangeEvent } from 'react';

import { uiText as __uiText } from '@cp/ui';

export type SupplierFormValue = {
  supplier_name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
};

export const emptySupplier = (): SupplierFormValue => ({
  supplier_name: '',
  contact_name: '',
  phone: '',
  email: '',
  address: '',
});

/** Create and edit use this same form. Edit passes the saved values. */
export function SupplierFields({ value, onChange, nameError }: { value: SupplierFormValue; onChange: (next: SupplierFormValue) => void; nameError?: string }) {
  const set = (key: keyof SupplierFormValue) => (event: ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: event.target.value });
  return (
    <>
      <FormSection title="ข้อมูลผู้จัดจำหน่าย" description="ชื่อที่ทีมใช้เรียกมาก่อน">
        <Input label={__uiText('ชื่อผู้จัดจำหน่าย')} required error={nameError} placeholder={__uiText('เช่น บริษัท ตัวอย่าง จำกัด')} hint={__uiText('ใช้ชื่อที่ทีมเรียกจริง')} value={value.supplier_name} onChange={set('supplier_name')} />
        <Input label={__uiText('ชื่อผู้ติดต่อ')} placeholder={__uiText('เช่น คุณสมชาย')} hint={__uiText('ไม่จำเป็น เว้นว่างได้')} value={value.contact_name} onChange={set('contact_name')} />
      </FormSection>
      <FormSection title="ช่องทางติดต่อ" description="ไม่จำเป็นตอนบันทึกครั้งแรก" collapsed>
        <Input label={__uiText('เบอร์โทร')} type="tel" placeholder="0812345678" hint={__uiText('ตัวเลขอย่างเดียว ไม่ต้องใส่ขีด')} value={value.phone} onChange={set('phone')} />
        <Input label={__uiText('อีเมล')} type="email" placeholder="orders@example.com" hint={__uiText('ใช้ส่งเอกสาร')} value={value.email} onChange={set('email')} />
        <Input label={__uiText('ที่อยู่')} placeholder={__uiText('เช่น 99 ถนนสุขุมวิท กรุงเทพ')} hint={__uiText('ไม่จำเป็น เว้นว่างได้')} value={value.address} onChange={set('address')} />
      </FormSection>
    </>
  );
}
