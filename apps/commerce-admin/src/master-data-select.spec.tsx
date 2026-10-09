// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { ConfirmHost, FormPanel, MasterDataSelect, confirmLeaveIfDirty } from '@cp/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.open = false; };

function Example({ required = false }: { required?: boolean }) {
  const [brand, setBrand] = useState('');
  return <><FormPanel title="Product" onSubmit={() => false}>
    <MasterDataSelect required={required} aria-label="Brand" options={[{ value: 'b1', label: 'Acme' }]} value={brand} onChange={value => setBrand(String(value))} />
  </FormPanel><ConfirmHost /></>;
}

it('protects a loaded option chosen by mouse without typing into the picker', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Example />));
    await expect(confirmLeaveIfDirty()).resolves.toBe(true);
    const input = container.querySelector('input[role="combobox"]') as HTMLInputElement;
    await act(async () => input.focus());
    const option = container.querySelector('[role="option"]') as HTMLElement;
    expect(option.textContent).toBe('Acme');
    await act(async () => option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(input.value).toBe('Acme');
    let leave: Promise<boolean>;
    await act(async () => { leave = confirmLeaveIfDirty(); });
    const dialog = container.querySelector('dialog[open]');
    expect(dialog).not.toBeNull();
    await act(async () => (dialog!.querySelector('button') as HTMLButtonElement).click());
    await expect(leave!).resolves.toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('keeps a required picker invalid until an actual option is selected', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Example required />));
    const input = container.querySelector('input[role="combobox"]') as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.checkValidity()).toBe(false);
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Unknown');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('Unknown');
    expect(input.checkValidity()).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => (container.querySelector('[role="option"]') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(input.value).toBe('Acme');
    expect(input.checkValidity()).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
