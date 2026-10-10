/** Test-only consumer: no existing application route imports or mounts this fixture. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskForm, TaskInput, TaskSelect, TaskTextarea, TaskSubmitButton } from '@cp/ui';
import '../../src/styles.css';

const en = new URLSearchParams(location.search).get('lang') === 'en';
const words = en ? {
  title: 'Shared form controls', name: 'Full contact name for the receiving warehouse and additional contact information', help: 'Use the name shown on your account.', email: 'Contact email', warehouse: 'Receiving warehouse', choose: 'Choose a warehouse', note: 'Notes', save: 'Save contact', loading: 'Loading options', waiting: 'Please wait for the available options.', disabled: 'Account reference', invalid: (count: number) => `Correct ${count} highlighted fields.`, submitting: 'Saving contact…', failure: 'Could not save. Try again; your values are still here.', success: 'Contact saved.', required: 'Enter your full name.', emailError: 'Enter an email, for example name@example.com.', warehouseError: 'Choose a receiving warehouse.',
} : {
  title: 'ส่วนประกอบฟอร์มกลาง', name: 'ชื่อผู้ติดต่อสำหรับคลังสินค้าปลายทางและรายละเอียดเพิ่มเติมสำหรับลูกค้าที่มีชื่อยาวมากในภาษาไทย', help: 'ใช้ชื่อเต็มตามบัญชีของคุณ', email: 'อีเมลสำหรับติดต่อ', warehouse: 'คลังสินค้าปลายทาง', choose: 'เลือกคลังสินค้า', note: 'หมายเหตุ', save: 'บันทึกผู้ติดต่อ', loading: 'กำลังโหลดตัวเลือก', waiting: 'รอสักครู่ ระบบกำลังโหลดตัวเลือกที่ใช้ได้', disabled: 'รหัสบัญชี', invalid: (count: number) => `แก้ไขข้อมูล ${count} ช่องที่ระบุด้านล่าง`, submitting: 'กำลังบันทึกผู้ติดต่อ…', failure: 'บันทึกไม่ได้ ลองอีกครั้ง ข้อมูลของคุณยังอยู่', success: 'บันทึกผู้ติดต่อแล้ว', required: 'กรอกชื่อเต็มของผู้ติดต่อ', emailError: 'กรอกอีเมล เช่น name@example.com', warehouseError: 'เลือกคลังสินค้าปลายทาง',
};

function Fixture() {
  const [name, setName] = useState('');
  const [warehouse, setWarehouse] = useState('');
  return <main className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6"><h1 className="text-2xl font-semibold">{words.title}</h1><p className="text-sm text-on-surface-variant">Validation fixture · isolated browser API</p>
    <TaskForm aria-label={words.title} messages={words} validate={data => {
      const errors: Record<string, string> = {};
      if (!String(data.get('name') ?? '').trim()) errors.name = words.required;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.get('email') ?? ''))) errors.email = words.emailError;
      if (!data.get('warehouse')) errors.warehouse = words.warehouseError;
      return errors;
    }} onSubmit={async (data, signal) => {
      const response = await fetch('/__task_form_validation', { method: 'POST', body: JSON.stringify(Object.fromEntries(data)), signal });
      const result = await response.json();
      if (!response.ok || result.ok !== true || !result.contact?.id) return { ok: false, fieldErrors: result.fieldErrors, formError: result.formError };
      return { ok: true, receipt: result.contact };
    }}>
      <TaskInput name="name" label={words.name} help={words.help} required value={name} onChange={event => setName(event.target.value)} autoComplete="name" />
      <TaskInput name="email" type="email" label={words.email} help="name@example.com" required autoComplete="email" />
      <TaskSelect name="warehouse" label={words.warehouse} required value={warehouse} onChange={event => setWarehouse(event.target.value)}><option value="">{words.choose}</option><option value="BKK">กรุงเทพฯ · Bangkok</option><option value="CNX">เชียงใหม่ · Chiang Mai</option></TaskSelect>
      <TaskTextarea name="note" label={words.note} rows={3} defaultValue="ข้อมูลที่ต้องเก็บไว้ · Keep these notes" />
      <TaskInput name="account" label={words.disabled} disabled defaultValue="FIXTURE-001" />
      <TaskSelect name="options" label={words.loading} loading loadingMessage={words.waiting} defaultValue=""><option value="">{words.choose}</option></TaskSelect>
      <TaskSubmitButton name="intent" value="save">{words.save}</TaskSubmitButton>
    </TaskForm>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
