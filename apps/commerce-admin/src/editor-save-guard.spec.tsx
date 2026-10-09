// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ConfirmHost, confirmLeaveIfDirty } from '@cp/ui';
import { AdminInsertLayout } from './josh-admin/app/components/AdminInsertLayout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.open = false; };
let root: Root;
let container: HTMLDivElement;

async function render(saved: boolean, revision = 0) {
  await act(async () => root.render(<MemoryRouter><AdminInsertLayout title="Fixture editor" saveLabel="Save fixture" onSave={async () => saved} savedRevision={revision}>
    <input aria-label="Draft" />
  </AdminInsertLayout><ConfirmHost /></MemoryRouter>));
}
async function editAndSave() {
  await act(async () => {
    const input = container.querySelector('input')!;
    input.value = 'Unsaved fixture';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    [...container.querySelectorAll('button')].find(button => button.textContent === 'Save fixture')!.click();
    await new Promise(resolve => window.setTimeout(resolve, 10));
  });
}
async function stillAsks() {
  let leave: Promise<boolean>;
  await act(async () => { leave = confirmLeaveIfDirty(); });
  const dialog = container.querySelector('dialog[open]');
  expect(dialog).not.toBeNull();
  await act(async () => (dialog!.querySelector('button') as HTMLButtonElement).click());
  await expect(leave!).resolves.toBe(false);
}
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('keeps edits protected when the awaited save fails', async () => {
  await render(false);
  await editAndSave();
  await stillAsks();
});

it('clears protection after the awaited save succeeds', async () => {
  await render(true);
  await editAndSave();
  await expect(confirmLeaveIfDirty()).resolves.toBe(true);
});

it('waits for a separate confirmed save to finish before clearing edits', async () => {
  await render(false);
  await editAndSave();
  await stillAsks();
  await render(false, 1);
  await expect(confirmLeaveIfDirty()).resolves.toBe(true);
});
