// @vitest-environment jsdom
import { act, createRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskForm, TaskInput, TaskSelect, TaskTextarea, TaskSubmitButton, TaskMasterDataSelect, Input, Select, type TaskFormProps, type TaskSubmitResult } from '@cp/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const scroll = vi.fn();
const messages = { invalid: (count: number) => `แก้ไขข้อมูล ${count} ช่องที่ระบุด้านล่าง`, submitting: 'กำลังบันทึก', loading: 'รอตัวเลือกที่จำเป็นโหลดเสร็จ แล้วลองอีกครั้ง', failure: 'บันทึกไม่ได้ ลองอีกครั้ง ข้อมูลยังอยู่', success: 'บันทึกแล้ว' };
const saved = { ok: true as const, receipt: { id: 'persisted-1' } };
const submit = vi.fn(async (_data: FormData, _signal: AbortSignal) => saved);
const fields = <><TaskInput name="email" type="email" label="อีเมลสำหรับติดต่อ" help="ตัวอย่าง name@example.com" required /><TaskSelect name="warehouse" label="คลังสินค้า" required defaultValue=""><option value="">เลือกคลังสินค้า</option><option value="BKK">กรุงเทพฯ</option></TaskSelect><TaskTextarea name="note" label="หมายเหตุ" defaultValue="คงข้อมูลนี้" /><TaskSubmitButton name="action" value="save">บันทึก</TaskSubmitButton></>;
async function render(children: ReactNode = fields, props: Partial<TaskFormProps<{ id: string }>> = {}) {
  await act(async () => root.render(<TaskForm messages={messages} onSubmit={submit} {...props}>{children}</TaskForm>));
}
async function change(name: string, value: string) {
  const element = container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
  await act(async () => {
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  return element;
}
async function fill() { await change('email', 'person@example.com'); await change('warehouse', 'BKK'); }
async function save() { await act(async () => (container.querySelector('button') as HTMLButtonElement).click()); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  HTMLElement.prototype.scrollIntoView = scroll;
  scroll.mockClear(); submit.mockClear(); submit.mockImplementation(async () => saved);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('associates labels, long Thai help, external hints, errors and unique generated ids', async () => {
  const label = 'ชื่อผู้ติดต่อและรายละเอียดเพิ่มเติมสำหรับลูกค้าที่มีชื่อยาวมากในภาษาไทย'.repeat(3);
  const ref = createRef<HTMLInputElement>();
  await render(<><p id="external">ข้อมูลเพิ่มเติม</p><TaskInput ref={ref} name="name" label={label} help="ใช้ชื่อเต็ม" error="กรอกชื่อเต็มเพื่อดำเนินการต่อ" aria-describedby="external" required /><TaskInput name="other" label="อีกช่อง" /></>);
  const input = ref.current!;
  expect(container.querySelector(`label[for="${input.id}"]`)?.textContent).toContain(label);
  expect(input.id).not.toBe(container.querySelector('[name="other"]')?.id);
  expect(input.required).toBe(true); expect(input.getAttribute('aria-invalid')).toBe('true');
  const descriptions = input.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)?.textContent);
  expect(descriptions).toEqual(['ข้อมูลเพิ่มเติม', 'ใช้ชื่อเต็ม', 'กรอกชื่อเต็มเพื่อดำเนินการต่อ']);
});

it('shows all client errors inline and focuses/scrolls the first invalid field only on submit', async () => {
  await render(); await save();
  const email = container.querySelector('[name="email"]')!;
  const warehouse = container.querySelector('[name="warehouse"]')!;
  expect(email.getAttribute('aria-invalid')).toBe('true'); expect(warehouse.getAttribute('aria-invalid')).toBe('true');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('2 ช่อง');
  expect(document.activeElement).toBe(email); expect(scroll).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
  (container.querySelector('[name="note"]') as HTMLElement).focus();
  await change('email', 'person@example.com');
  expect(email.getAttribute('aria-invalid')).not.toBe('true'); expect(document.activeElement?.getAttribute('name')).toBe('note'); expect(scroll).toHaveBeenCalledOnce();
  await change('warehouse', 'BKK'); expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('keeps an invalid corrected value invalid and uses actionable custom validation copy', async () => {
  await render(fields, { validate: data => String(data.get('email') ?? '').includes('@') ? {} : { email: 'กรอกอีเมล เช่น name@example.com' } });
  await save(); await change('email', 'bad');
  expect(container.querySelector('[name="email"]')?.getAttribute('aria-invalid')).toBe('true');
  expect(container.textContent).toContain('กรอกอีเมล เช่น name@example.com'); expect(submit).not.toHaveBeenCalled();
});

it('submits named values, the empty optional option and the native submitter, without resetting fields', async () => {
  const onSubmit = vi.fn(async (data: FormData) => { expect(Object.fromEntries(data)).toEqual({ email: 'person@example.com', warehouse: 'BKK', optional: '', note: 'คงข้อมูลนี้', action: 'save' }); return saved; });
  await render(<>{fields}<TaskSelect name="optional" label="ตัวเลือก" defaultValue=""><option value="">ไม่ระบุ</option><option value="x">X</option></TaskSelect></>, { onSubmit });
  await fill(); await save();
  expect(onSubmit).toHaveBeenCalledOnce(); expect(container.textContent).toContain('บันทึกแล้ว');
  expect((container.querySelector('[name="note"]') as HTMLTextAreaElement).value).toBe('คงข้อมูลนี้');
});

it('preserves controlled Input and Select state, empty option, disabled and loading behavior', async () => {
  function Controlled() {
    const [name, setName] = useState('เดิม'); const [value, setValue] = useState('');
    return <><TaskInput name="name" label="ชื่อ" value={name} onChange={event => setName(event.target.value)} /><TaskSelect name="select" label="เลือก" value={value} onChange={event => setValue(event.target.value)}><option value="">ว่าง</option><option value="chosen">เลือกแล้ว</option></TaskSelect><TaskInput name="disabled" label="ปิดใช้งาน" disabled defaultValue="omit" /><TaskSelect name="loading" label="กำลังโหลดตัวเลือก" loading loadingMessage="รอสักครู่" defaultValue=""><option value="">ว่าง</option></TaskSelect><TaskSubmitButton>บันทึก</TaskSubmitButton></>;
  }
  await render(<Controlled />); await change('name', 'ใหม่'); await change('select', 'chosen');
  expect((container.querySelector('[name="name"]') as HTMLInputElement).value).toBe('ใหม่');
  expect((container.querySelector('[name="select"]') as HTMLSelectElement).value).toBe('chosen');
  await change('select', '');
  const loading = container.querySelector('[name="loading"]') as HTMLSelectElement;
  expect(loading.disabled).toBe(true); expect(loading.getAttribute('aria-busy')).toBe('true'); expect(document.getElementById(loading.getAttribute('aria-describedby')!)?.textContent).toBe('รอสักครู่');
  await save(); const data = submit.mock.calls[0]?.[0] as FormData;
  expect(data.get('select')).toBe(''); expect(data.has('disabled')).toBe(false); expect(data.has('loading')).toBe(false);
});

it('guards same-tick duplicate and native Enter submits while pending, and waits for the API receipt', async () => {
  const pending = deferred<TaskSubmitResult<{ id: string }>>(); const onSuccess = vi.fn();
  const onSubmit = vi.fn(() => pending.promise);
  await render(fields, { onSubmit, onSuccess }); await fill();
  await act(async () => { const form = container.querySelector('form')!; form.requestSubmit(); form.requestSubmit(); });
  expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
  expect(container.querySelector<HTMLInputElement>('[name="email"]')!.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  expect(container.textContent).not.toContain('บันทึกแล้ว'); expect(onSuccess).not.toHaveBeenCalled();
  expect(onSubmit).toHaveBeenCalledOnce();
  await act(async () => pending.resolve(saved)); expect(onSuccess).toHaveBeenCalledExactlyOnceWith(saved.receipt);
  expect(container.querySelector<HTMLInputElement>('[name="email"]')!.disabled).toBe(false);
});

it('maps server field errors, keeps values, focuses the first and permits corrections and retry', async () => {
  const onSubmit = vi.fn().mockResolvedValueOnce({ ok: false, fieldErrors: { email: 'อีเมลนี้มีผู้ใช้งานแล้ว ใช้อีเมลอื่น', warehouse: 'เลือกคลังที่เปิดใช้งาน' } }).mockResolvedValueOnce(saved);
  await render(fields, { onSubmit }); await fill(); await save();
  const email = container.querySelector<HTMLInputElement>('[name="email"]')!;
  expect(email.value).toBe('person@example.com'); expect(document.activeElement).toBe(email); expect(container.textContent).toContain('อีเมลนี้มีผู้ใช้งานแล้ว'); expect(container.textContent).not.toContain('บันทึกแล้ว');
  await change('email', 'new@example.com'); await change('warehouse', ''); await change('warehouse', 'BKK'); await save();
  expect(onSubmit).toHaveBeenCalledTimes(2); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain('บันทึกแล้ว');
});

it('shows unknown server errors as a form failure rather than silently claiming success', async () => {
  await render(fields, { onSubmit: async () => ({ ok: false, fieldErrors: { unrelated: 'rejected' } }) }); await fill(); await save();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(messages.failure); expect(container.textContent).not.toContain('บันทึกแล้ว');
});

it('retains values on network failure and allows retry, clearing old success on an edit', async () => {
  const onSubmit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(saved);
  await render(fields, { onSubmit }); await fill(); await save();
  expect(container.textContent).toContain(messages.failure); expect((container.querySelector('[name="email"]') as HTMLInputElement).value).toBe('person@example.com'); expect(container.textContent).not.toContain(messages.success);
  await save(); expect(container.textContent).toContain(messages.success); await change('email', 'next@example.com'); expect(container.textContent).not.toContain(messages.success);
});

it('rejects malformed success and non-null receipt omissions', async () => {
  const onSuccess = vi.fn();
  await render(fields, { onSubmit: async () => ({ ok: true } as TaskSubmitResult<{ id: string }>), onSuccess }); await fill(); await save();
  expect(container.textContent).toContain(messages.failure); expect(onSuccess).not.toHaveBeenCalled(); expect(container.textContent).not.toContain(messages.success);
});

it('aborts an interrupted flow and does not notify success after unmount', async () => {
  const pending = deferred<TaskSubmitResult<{ id: string }>>(); const onSuccess = vi.fn(); let signal!: AbortSignal;
  await render(fields, { onSubmit: async (_data, value) => { signal = value; return pending.promise; }, onSuccess }); await fill(); await save();
  await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(saved)); expect(onSuccess).not.toHaveBeenCalled();
});

it('handles a validation exception as a form error and unlocks the next attempt', async () => {
  const validate = vi.fn().mockImplementationOnce(() => { throw new Error('invalid config'); }).mockReturnValue({});
  await render(fields, { validate }); await fill(); await save(); expect(container.textContent).toContain(messages.failure); expect(submit).not.toHaveBeenCalled();
  await save(); expect(submit).toHaveBeenCalledOnce();
});

it('keeps shared Input and Select markup with responsive touch targets', async () => {
  await act(async () => root.render(<><Input aria-label="legacy input" /><Select aria-label="legacy select"><option>Option</option></Select></>));
  expect(container.children).toHaveLength(2); expect(container.children[0].tagName).toBe('INPUT'); expect(container.children[1].tagName).toBe('SELECT');
  expect(container.querySelector('input')?.className).toContain('sm:min-h-10'); expect(container.querySelector('input')?.className).toContain('min-h-11'); expect(container.querySelector('label')).toBeNull();
});

it('validates unnamed required shared controls by id and focuses them', async () => {
  await render(<><TaskInput label="ชื่อ" required /><TaskSubmitButton>บันทึก</TaskSubmitButton></>); await save();
  const input = container.querySelector('input')!;
  expect(input.getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement).toBe(input); expect(submit).not.toHaveBeenCalled();
});

it('does not let blank custom validation or blank explicit errors erase native errors', async () => {
  await render(<><TaskInput name="email" type="email" label="อีเมล" error="" required /><TaskSubmitButton>บันทึก</TaskSubmitButton></>, { validate: () => ({ email: '' }) });
  await change('email', 'bad'); await save();
  const input = container.querySelector('input')!;
  expect(input.getAttribute('aria-invalid')).toBe('true'); expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBeTruthy(); expect(document.activeElement).toBe(input); expect(submit).not.toHaveBeenCalled();
});

it('clears dependent client errors when another field fixes them without moving focus', async () => {
  await render(<><TaskInput name="first" label="รหัส" defaultValue="first" /><TaskInput name="confirm" label="ยืนยันรหัส" defaultValue="second" /><TaskSubmitButton>บันทึก</TaskSubmitButton></>, { validate: data => data.get('first') === data.get('confirm') ? {} : { confirm: 'รหัสต้องตรงกัน' } });
  await save(); const first = container.querySelector<HTMLInputElement>('[name="first"]')!; first.focus();
  await change('first', 'second');
  expect(container.querySelector('[name="confirm"]')?.getAttribute('aria-invalid')).not.toBe('true'); expect(document.activeElement).toBe(first); expect(scroll).toHaveBeenCalledOnce();
});

it('retains unrelated server errors while another field changes', async () => {
  await render(fields, { onSubmit: async () => ({ ok: false, fieldErrors: { email: 'อีเมลซ้ำ' } }) }); await fill(); await save();
  await change('note', 'แก้หมายเหตุ');
  expect(container.querySelector('[name="email"]')?.getAttribute('aria-invalid')).toBe('true'); expect(container.textContent).toContain('อีเมลซ้ำ');
});

it('blocks custom validation for unknown fields instead of dropping it and submitting', async () => {
  await render(fields, { validate: () => ({ missing: 'กรอกข้อมูลที่หายไป' }) }); await fill(); await save();
  expect(container.textContent).toContain(messages.failure); expect(submit).not.toHaveBeenCalled();
});

it('blocks submission while a required select is loading, then permits its loaded value', async () => {
  const select = (loading: boolean) => <><TaskSelect name="warehouse" label="คลัง" required loading={loading} defaultValue="BKK"><option value="BKK">กรุงเทพฯ</option></TaskSelect><TaskSubmitButton>บันทึก</TaskSubmitButton></>;
  await render(select(true)); await save(); expect(submit).not.toHaveBeenCalled(); expect(container.textContent).toContain(messages.loading);
  await render(select(false)); await save(); expect(submit).toHaveBeenCalledOnce();
});

it('unlocks and preserves values after FormData construction fails', async () => {
  await render(); await fill();
  const data = vi.spyOn(globalThis, 'FormData').mockImplementationOnce(() => { throw new Error('cannot collect form'); });
  try { await save(); } finally { data.mockRestore(); }
  expect(submit).not.toHaveBeenCalled(); expect(container.textContent).toContain(messages.failure);
  expect((container.querySelector('[name="email"]') as HTMLInputElement).value).toBe('person@example.com');
  await save(); expect(submit).toHaveBeenCalledOnce();
});

it('Stitch opt-in fields preserve existing Input and Select classes while adding label associations', async () => {
  await render(<><TaskInput name="new" label="Name" /><Input name="legacy" /><TaskSelect name="next" label="Choice"><option>One</option></TaskSelect><Select name="old"><option>One</option></Select></>, { appearance: 'stitch' });
  expect(container.querySelector('[name="new"]')!.className).toBe(container.querySelector('[name="legacy"]')!.className);
  expect(container.querySelector('[name="next"]')!.className).toBe(container.querySelector('[name="old"]')!.className);
  expect(container.querySelector('label')?.htmlFor).toBe(container.querySelector('[name="new"]')!.id);
});

it('an externally disabled action blocks programmatic submission and controls without announcing saving', async () => {
  await render(fields, { disabled: true });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(submit).not.toHaveBeenCalled(); expect(container.querySelector<HTMLInputElement>('[name="email"]')!.disabled).toBe(true);
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it('master picker keeps searchable keyboard behavior and submits the stored code with inline errors', async () => {
  function Picker() {
    const [value, setValue] = useState('');
    return <><TaskMasterDataSelect name="warehouse" label="Warehouse" required value={value} onChange={next => setValue(String(next))} options={[{value:'A',label:'Warehouse Alpha'},{value:'B',label:'Warehouse Beta'}]} /><TaskSubmitButton>Save</TaskSubmitButton></>;
  }
  await render(<Picker />, { appearance: 'stitch' });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true})));
  const picker = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
  expect(picker.placeholder).toBeTruthy();
  expect(picker.getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement).toBe(picker);
  await act(async () => picker.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
  expect(picker.getAttribute('aria-activedescendant')).toBeTruthy();
  await act(async () => picker.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  expect(container.querySelector<HTMLInputElement>('input[type="hidden"][name="warehouse"]')!.value).toBe('B');
  expect(picker.getAttribute('aria-invalid')).not.toBe('true');
  await act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect(submit).toHaveBeenCalledOnce(); expect(submit.mock.calls[0][0].get('warehouse')).toBe('B');
});

it('refocusing a selected picker then tabbing away restores its label and remains valid for Enter submit', async () => {
  function Picker() { const [value,setValue]=useState('A'); return <><TaskMasterDataSelect name="warehouse" label="Warehouse" required value={value} onChange={next=>setValue(String(next))} options={[{value:'A',label:'Warehouse Alpha'}]} /><TaskInput name="note" label="Note" /><TaskSubmitButton>Save</TaskSubmitButton></>; }
  await render(<Picker />, {appearance:'stitch'});
  const picker=container.querySelector<HTMLInputElement>('[role=combobox]')!;
  const note=container.querySelector<HTMLInputElement>('[name=note]')!;
  await act(async()=>picker.focus()); expect(picker.value).toBe('');
  await act(async()=>note.focus()); expect(picker.value).toBe('Warehouse Alpha'); expect(picker.validity.valid).toBe(true);
  await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(submit).toHaveBeenCalledOnce(); expect(submit.mock.calls[0][0].get('warehouse')).toBe('A');
});

it('Stitch appearance keeps existing required hints and email example defaults', async () => {
  await render(<TaskInput name="email" type="email" label="Email" required />, {appearance:'stitch'});
  expect(container.querySelector<HTMLInputElement>('[name=email]')!.placeholder).toBe('name@shop.com');
  expect(container.querySelector('[id$="-help"]')?.textContent).toBeTruthy();
});
