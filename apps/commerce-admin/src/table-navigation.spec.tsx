// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { PaginationControls, setUiLocale } from '@cp/ui';
import { Table } from './josh-admin/libs/shared-ui-web/lib/Table/Table';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => setUiLocale('th'));

async function render(element: React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    root,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it('jumps within bounds without submitting an enclosing editor form', async () => {
  const onPage = vi.fn(),
    submit = vi.fn((event) => event.preventDefault());
  const view = await render(
    <form onSubmit={submit}>
      <PaginationControls page={2} pages={12} onPage={onPage} />
    </form>,
  );
  try {
    expect(view.container.querySelectorAll('form')).toHaveLength(1);
    const input = view.container.querySelector('input')!;
    input.value = '13';
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onPage).not.toHaveBeenCalled();
    input.value = '7';
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onPage).toHaveBeenCalledWith(7);
    expect(submit).not.toHaveBeenCalled();
  } finally {
    await view.close();
  }
});

it('disables navigation at the ends and during loading', async () => {
  setUiLocale('en');
  const view = await render(
    <PaginationControls page={1} pages={1} onPage={vi.fn()} />,
  );
  try {
    expect(
      (
        view.container.querySelector(
          '[aria-label="Previous"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (view.container.querySelector('[aria-label="Next"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () =>
      view.root.render(
        <PaginationControls page={3} pages={12} disabled onPage={vi.fn()} />,
      ),
    );
    expect(
      [...view.container.querySelectorAll('button')].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    expect(view.container.querySelector('input')?.disabled).toBe(true);
  } finally {
    await view.close();
  }
});

it('selects eligible records only and exposes partial selection to assistive technology', async () => {
  const select = vi.fn();
  const view = await render(
    <Table
      columns={[{ key: 'name', label: 'Name' }]}
      data={[
        { id: 0, name: 'Pending' },
        { id: 1, name: 'Pending too' },
        { id: 2, name: 'Approved' },
      ]}
      selectedIds={[0]}
      onSelectRow={select}
      onSelectAll={vi.fn()}
      isRowSelectable={(row) => row.id !== 2}
    />,
  );
  try {
    const boxes = view.container.querySelectorAll<HTMLInputElement>('input');
    expect(boxes[0].indeterminate).toBe(true);
    expect(boxes[0].getAttribute('aria-checked')).toBe('mixed');
    expect(boxes[1].checked).toBe(true);
    expect(boxes[3].disabled).toBe(true);
    await act(async () => boxes[2].click());
    expect(select).toHaveBeenCalledWith(1);
  } finally {
    await view.close();
  }
});

it('shows loading separately from an empty list and removes stale selectable rows', async () => {
  const view = await render(
    <Table
      columns={[{ key: 'name', label: 'Name' }]}
      data={[{ id: 1, name: 'Stale product' }]}
      loading
      onSelectRow={vi.fn()}
      onSelectAll={vi.fn()}
      currentPage={1}
      totalPages={2}
      onPageChange={vi.fn()}
    />,
  );
  try {
    expect(view.container.textContent).not.toContain('Stale product');
    expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(
      [...view.container.querySelectorAll<HTMLInputElement>('input')].every(
        (input) => input.disabled,
      ),
    ).toBe(true);
    expect(
      [
        ...view.container.querySelectorAll<HTMLButtonElement>('nav button'),
      ].every((button) => button.disabled),
    ).toBe(true);
  } finally {
    await view.close();
  }
});
