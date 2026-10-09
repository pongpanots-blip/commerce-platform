/** Opt-in controls. Existing Stitch controls and consumers retain their defaults. */
import {
  createContext, forwardRef, useContext, useEffect, useId, useRef, useState,
  type FormHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes, type ButtonHTMLAttributes,
  type ComponentProps,
} from 'react';
import { MasterDataSelect } from './forms';
import { fieldExample, fieldHint } from './usability';
import { uiText } from './i18n';

export type TaskFieldErrors = Record<string, string>;
export type TaskSubmitResult<Receipt> =
  | { ok: true; receipt: Receipt; message?: string }
  | { ok: false; fieldErrors?: TaskFieldErrors; formError?: string };

export interface TaskFormMessages {
  /** Supply localized, actionable copy; native validation uses the browser's locale. */
  invalid: (count: number) => string;
  submitting: string;
  loading: string;
  failure: string;
  success: string;
}

export type TaskFormAppearance = 'task' | 'stitch';
interface FieldState { errors: TaskFieldErrors; busy: boolean; disabled?: boolean; appearance: TaskFormAppearance; revalidate?: (name: string) => void; }
const TaskFormContext = createContext<FieldState>({ errors: {}, busy: false, appearance: 'task' });
export function useTaskFormState() { return useContext(TaskFormContext); }
const controlClass = 'w-full min-w-0 min-h-11 rounded-lg border border-secondary-container bg-surface-container-lowest px-3 py-2 text-sm leading-[22px] text-on-surface placeholder:text-outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:opacity-60 disabled:cursor-not-allowed aria-invalid:border-error';
// Matches the existing shared Input/Select classes; no theme or legacy default changes.
const stitchControlClass = 'w-full min-h-10 px-3 py-2 bg-surface-container-lowest text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-[13px] focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-colors disabled:opacity-60';
const cx = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' ');

interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  error?: string;
  loading?: boolean;
  loadingMessage?: string;
  fieldClassName?: string;
  appearance?: TaskFormAppearance;
}

function useField(props: FieldProps & { id?: string; name?: string; disabled?: boolean; required?: boolean; readOnly?: boolean; 'aria-describedby'?: string; 'aria-invalid'?: InputHTMLAttributes<HTMLInputElement>['aria-invalid'] }) {
  const generatedId = useId();
  const state = useContext(TaskFormContext);
  const id = props.id ?? `task-field-${generatedId}`;
  const key = props.name || id;
  const error = props.error?.trim() ? props.error : (Object.prototype.hasOwnProperty.call(state.errors, key) ? state.errors[key] : undefined);
  const loading = props.loading || state.busy;
  const appearance = props.appearance ?? state.appearance;
  const help = props.help !== undefined ? props.help : appearance === 'stitch' && props.required && !props.disabled && !props.readOnly ? fieldHint(true) : undefined;
  const describedBy = [props['aria-describedby'], help != null && `${id}-help`, error && `${id}-error`, props.loading && props.loadingMessage && `${id}-loading`].filter(Boolean).join(' ') || undefined;
  return { id, help, error, loading, disabled: props.disabled || loading || state.disabled, describedBy, invalid: error ? true : props['aria-invalid'], appearance };
}

function Field({ id, label, help, error, loading, loadingMessage, required, fieldClassName, appearance, children }: FieldProps & { id: string; required?: boolean; children: ReactNode }) {
  const stitch = appearance === 'stitch';
  return <div className={cx(stitch ? 'flex flex-col gap-1 min-w-0' : 'min-w-0 space-y-1.5', fieldClassName)}>
    <label htmlFor={id} className={stitch ? 'text-xs font-medium text-on-surface' : 'block break-words text-sm font-medium leading-[22px] text-on-surface'}>{label}{required && <span className={stitch ? 'text-[#c2333f]' : undefined} aria-hidden="true"> *</span>}</label>
    {children}
    {help != null && <div id={`${id}-help`} className={stitch ? 'text-[11px] text-outline' : 'break-words text-xs leading-5 text-on-surface-variant'}>{typeof help === 'string' ? uiText(help) : help}</div>}
    {error && <p id={`${id}-error`} className={stitch ? 'text-[11px] text-[#c2333f]' : 'break-words text-sm leading-[22px] text-error'}>{error}</p>}
    {loading && loadingMessage && <p id={`${id}-loading`} className="text-xs leading-5 text-on-surface-variant">{loadingMessage}</p>}
  </div>;
}

export type TaskInputProps = InputHTMLAttributes<HTMLInputElement> & FieldProps;
export const TaskInput = forwardRef<HTMLInputElement, TaskInputProps>(function TaskInput(props, ref) {
  const state = useField(props);
  const { label, help, error: _error, loading: _loading, loadingMessage, fieldClassName, className, appearance: _appearance, ...native } = props;
  return <Field {...state} label={label} help={state.help} loadingMessage={props.loading ? loadingMessage : undefined} required={native.required} fieldClassName={fieldClassName}>
    <input {...native} placeholder={native.placeholder ?? (state.appearance === 'stitch' ? uiText(fieldExample(native.type) ?? '') : undefined)} ref={ref} id={state.id} className={cx(state.appearance === 'stitch' ? stitchControlClass : controlClass, className)} disabled={state.disabled} aria-busy={state.loading || undefined} aria-invalid={state.invalid} aria-describedby={state.describedBy} />
  </Field>;
});

export type TaskSelectProps = SelectHTMLAttributes<HTMLSelectElement> & FieldProps;
export const TaskSelect = forwardRef<HTMLSelectElement, TaskSelectProps>(function TaskSelect(props, ref) {
  const state = useField(props);
  const { label, help, error: _error, loading: _loading, loadingMessage, fieldClassName, className, children, appearance: _appearance, ...native } = props;
  return <Field {...state} label={label} help={state.help} loadingMessage={props.loading ? loadingMessage : undefined} required={native.required} fieldClassName={fieldClassName}>
    <select {...native} ref={ref} id={state.id} className={cx(state.appearance === 'stitch' ? `${stitchControlClass} pr-7 bg-surface-container-lowest` : controlClass, className)} disabled={state.disabled} aria-busy={state.loading || undefined} aria-invalid={state.invalid} aria-describedby={state.describedBy}>{children}</select>
  </Field>;
});

export type TaskTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps;
export const TaskTextarea = forwardRef<HTMLTextAreaElement, TaskTextareaProps>(function TaskTextarea(props, ref) {
  const state = useField(props);
  const { label, help, error: _error, loading: _loading, loadingMessage, fieldClassName, className, appearance: _appearance, ...native } = props;
  return <Field {...state} label={label} help={state.help} loadingMessage={props.loading ? loadingMessage : undefined} required={native.required} fieldClassName={fieldClassName}>
    <textarea {...native} placeholder={native.placeholder ?? (state.appearance === 'stitch' ? uiText(fieldExample() ?? '') : undefined)} ref={ref} id={state.id} className={cx(state.appearance === 'stitch' ? `${stitchControlClass} font-mono text-[11px] leading-relaxed` : controlClass, className)} disabled={state.disabled} aria-busy={state.loading || undefined} aria-invalid={state.invalid} aria-describedby={state.describedBy} />
  </Field>;
});

/** Reuses the searchable master-data picker and its original styles/keyboard behavior. */
export function TaskMasterDataSelect(props: ComponentProps<typeof MasterDataSelect> & FieldProps & { name: string; id?: string }) {
  const context = useContext(TaskFormContext);
  const state = useField(props);
  const { label, help, error: _error, loading: _loading, loadingMessage, fieldClassName, appearance: _appearance, name, id: _id, ...picker } = props;
  const valueKey = JSON.stringify(props.value);
  const example = state.appearance === 'stitch' ? fieldExample() : undefined;
  useEffect(() => { context.revalidate?.(name); }, [valueKey, name]); // DOM contains the newly selected stored value after commit.
  return <Field {...state} label={label} help={state.help} required={props.required} fieldClassName={fieldClassName} loadingMessage={loadingMessage}>
    {(Array.isArray(props.value) ? props.value : [props.value]).map(value => <input key={value} type="hidden" name={name} disabled={state.disabled} value={value} />)}
    <MasterDataSelect {...picker} placeholder={picker.placeholder ?? (example ? uiText(example) : undefined)} inputId={state.id} fieldName={name} aria-label={typeof label === 'string' ? label : picker['aria-label']} disabled={state.disabled} aria-invalid={state.invalid} aria-describedby={state.describedBy} aria-busy={state.loading || undefined} />
  </Field>;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
function controls(form: HTMLFormElement) {
  return Array.from(form.elements).filter((element): element is Control => element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement);
}
function nativeErrors(form: HTMLFormElement): TaskFieldErrors {
  const errors: TaskFieldErrors = Object.create(null);
  for (const control of controls(form)) {
    if (control.willValidate && !control.validity.valid) errors[control.dataset.fieldName || control.name || control.id || '__unnamed_invalid_control'] = control.validationMessage;
  }
  return errors;
}
function knownErrors(form: HTMLFormElement, errors: TaskFieldErrors): TaskFieldErrors {
  const names = new Set(controls(form).filter(control => !control.disabled).map(control => control.dataset.fieldName || control.name || control.id || '__unnamed_invalid_control'));
  return Object.fromEntries(Object.entries(errors).filter(([name, message]) => names.has(name) && typeof message === 'string' && message.trim()));
}
function clientErrors(form: HTMLFormElement, validate: TaskFormProps<unknown>['validate'], data: FormData) {
  // Empty custom entries must never erase native required/type/range constraints.
  const custom = Object.fromEntries(Object.entries(validate?.(data) ?? {}).filter(([, message]) => typeof message === 'string' && message.trim()));
  return { ...nativeErrors(form), ...custom };
}

export interface TaskFormProps<Receipt> extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit' | 'noValidate'> {
  /** Field names must match this form. Map server fields explicitly in the API adapter. */
  validate?: (data: FormData) => TaskFieldErrors;
  onSubmit: (data: FormData, signal: AbortSignal) => Promise<TaskSubmitResult<Receipt>>;
  /** Called only for a confirmed successful result with a non-null API receipt. */
  onSuccess?: (receipt: Receipt) => void;
  messages: TaskFormMessages;
  appearance?: TaskFormAppearance;
  disabled?: boolean;
}

/** Owns submission state and inline errors, never owns or resets the person's field values. */
export function TaskForm<Receipt>({ children, validate, onSubmit, onSuccess, messages, onChange, className, appearance = 'task', disabled = false, ...native }: TaskFormProps<Receipt>) {
  const formRef = useRef<HTMLFormElement>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const serverNames = useRef(new Set<string>());
  const [errors, setErrors] = useState<TaskFieldErrors>({});
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [focusVersion, setFocusVersion] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!focusVersion) return;
    const first = formRef.current?.querySelector<HTMLElement>('input[aria-invalid="true"]:not(:disabled), select[aria-invalid="true"]:not(:disabled), textarea[aria-invalid="true"]:not(:disabled), input:invalid:not(:disabled), select:invalid:not(:disabled), textarea:invalid:not(:disabled)');
    first?.focus({ preventScroll: true });
    first?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
  }, [focusVersion]);

  function fail(fieldErrors: TaskFieldErrors, message = '', fromServer = false) {
    serverNames.current = new Set(fromServer ? Object.keys(fieldErrors) : []);
    setErrors(fieldErrors);
    setFormError(message);
    setFocusVersion(version => version + 1);
  }
  async function submit(form: HTMLFormElement, submitter: HTMLElement | null) {
    if (locked.current || disabled) return;
    locked.current = true;
    setSuccess('');
    setFormError('');
    let data: FormData;
    try { data = new FormData(form, submitter); }
    catch {
      fail({}, messages.failure);
      locked.current = false;
      return;
    }
    const fieldNames = new Set(controls(form).filter(control => !control.disabled).map(control => control.name));
    if (controls(form).some(control => control.required && control.getAttribute('aria-busy') === 'true')) {
      fail({}, messages.loading);
      locked.current = false;
      return;
    }
    let invalid: TaskFieldErrors;
    try {
      const supplied = clientErrors(form, validate, data);
      invalid = knownErrors(form, supplied);
      if (Object.keys(supplied).some(name => !Object.prototype.hasOwnProperty.call(invalid, name))) {
        fail(invalid, messages.failure);
        locked.current = false;
        return;
      }
    } catch {
      fail({}, messages.failure);
      locked.current = false;
      return;
    }
    if (Object.keys(invalid).length) {
      fail(invalid);
      locked.current = false;
      return;
    }
    setErrors({});
    serverNames.current.clear();
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    let receipt: Receipt | undefined;
    try {
      const result = await onSubmit(data, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (result?.ok === true && result.receipt != null) {
        receipt = result.receipt;
        setSuccess(typeof result.message === 'string' && result.message.trim() ? result.message : messages.success);
      } else {
        // Busy controls are disabled in the DOM; use the pre-submit field names for mapping.
        const supplied = result?.ok === false ? result.fieldErrors ?? {} : {};
        const fields = Object.fromEntries(Object.entries(supplied).filter(([name, message]) => fieldNames.has(name) && typeof message === 'string' && message.trim()));
        const unknown = Object.keys(supplied).some(name => !fieldNames.has(name));
        const message = result?.ok === false && typeof result.formError === 'string' ? result.formError.trim() : undefined;
        fail(fields, message || (unknown || !Object.keys(fields).length ? messages.failure : ''), true);
      }
    } catch {
      if (mounted.current && !controller.signal.aborted) fail({}, messages.failure);
    } finally {
      locked.current = false;
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
    if (receipt !== undefined && mounted.current && !controller.signal.aborted) onSuccess?.(receipt);
  }
  const errorCount = Object.keys(errors).length;
  function revalidate(changedKey: string) {
    const form = formRef.current;
    if (!form || !Object.keys(errors).length) return;
    let corrected: TaskFieldErrors;
    try { corrected = clientErrors(form, validate, new FormData(form)); }
    catch { corrected = errors; }
    const serverKeys = new Set(serverNames.current);
    serverNames.current.delete(changedKey);
    setErrors(previous => {
      const next = { ...previous };
      for (const key of Object.keys(previous)) {
        if (serverKeys.has(key) && key !== changedKey) continue;
        if (Object.prototype.hasOwnProperty.call(corrected, key) && corrected[key]) next[key] = corrected[key];
        else delete next[key];
      }
      return next;
    });
  }
  return <TaskFormContext.Provider value={{ errors, busy, disabled, appearance, revalidate }}>
    <form {...native} ref={formRef} className={cx(appearance === 'task' && 'space-y-4', className)} noValidate aria-busy={busy || undefined}
      onSubmit={event => { event.preventDefault(); void submit(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter ?? null); }}
      onChange={event => {
        setSuccess('');
        const target = event.target;
        const form = event.currentTarget;
        if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) && Object.keys(errors).length) {
          revalidate(target.dataset.fieldName || target.name || target.id || '__unnamed_invalid_control');
        }
        onChange?.(event);
      }}>
      {(errorCount > 0 || formError) && <div role="alert" className="break-words rounded-lg border border-error/30 bg-error-container/30 p-3 text-sm leading-[22px] text-error">{formError}{formError && errorCount > 0 && <br />}{errorCount > 0 && messages.invalid(errorCount)}</div>}
      {busy && <p role="status" className="text-sm text-on-surface-variant">{messages.submitting}</p>}
      {success && <p role="status" className="rounded-lg bg-primary/5 p-3 text-sm text-on-surface">{success}</p>}
      {children}
    </form>
  </TaskFormContext.Provider>;
}

export function TaskSubmitButton({ children, disabled, className, ...native }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'>) {
  const state = useContext(TaskFormContext);
  return <button {...native} type="submit" disabled={disabled || state.busy || state.disabled} className={cx('inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60', className)}>{children}</button>;
}
