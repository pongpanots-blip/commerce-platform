// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ConfirmHost, confirmLeaveIfDirty, useUnsavedChanges } from '@cp/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.open = false; };
let root: Root;
let container: HTMLDivElement;
function Guard({ dirty }: { dirty: boolean }) { useUnsavedChanges(dirty); return null; }
async function render(first: boolean, second?: boolean) {
  await act(async () => root.render(<><Guard key="first" dirty={first} />{second !== undefined && <Guard key="second" dirty={second} />}<ConfirmHost /></>));
}
async function asksBeforeLeaving() {
  let result: Promise<boolean>;
  await act(async () => { result = confirmLeaveIfDirty(); });
  const dialog = container.querySelector('dialog[open]');
  expect(dialog).not.toBeNull();
  const cancel = dialog?.querySelector('button') as HTMLButtonElement;
  await act(async () => cancel.click());
  await expect(result!).resolves.toBe(false);
}
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('keeps the first form protected when a second clean form mounts', async () => {
  await render(true);
  await render(true, false);
  await asksBeforeLeaving();
});

it('keeps the second form protected when the first form is saved', async () => {
  await render(true, true);
  await render(false, true);
  await asksBeforeLeaving();
});

it('keeps a dirty form protected when another dirty form closes', async () => {
  await render(true, true);
  await render(true);
  await asksBeforeLeaving();
});

it('permits leaving after every form is clean or unmounted', async () => {
  await render(true, true);
  await render(false, false);
  await expect(confirmLeaveIfDirty()).resolves.toBe(true);
  await render(true);
  await act(async () => root.render(<ConfirmHost />));
  await expect(confirmLeaveIfDirty()).resolves.toBe(true);
});
