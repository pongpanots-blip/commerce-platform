// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Table, type TableColumn } from './Table';
import { TableViewBar, useTableViews } from './TableViews';

const columns: TableColumn<{ id: number; name: string; city: string }>[] = [
  { key: 'name', label: 'zz-col-name' },
  { key: 'city', label: 'zz-col-city' },
];

function Harness() {
  const [status, setStatus] = useState('all');
  const views = useTableViews('spec-page', { status }, (v) => setStatus(v.status ?? 'all'));
  return (
    <div>
      <output>{status}</output>
      <button type="button" onClick={() => setStatus('paid')}>set-paid</button>
      <TableViewBar views={views} columns={columns} />
      <Table columns={columns} data={[{ id: 1, name: 'A', city: 'BKK' }]} hiddenKeys={views.hidden} />
    </div>
  );
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const mount = () => act(() => { root = createRoot(host); root.render(<Harness />); });
const $ = (sel: string) => host.querySelector(sel) as HTMLElement;
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
const headers = () => [...host.querySelectorAll('thead th')].map((th) => th.textContent);

beforeEach(() => { localStorage.clear(); host = document.createElement('div'); document.body.append(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('saves the current filters as a named view and puts them back', () => {
  mount();
  act(() => button('set-paid').click());
  vi.spyOn(window, 'prompt').mockReturnValue('  Paid only ');
  act(() => button('บันทึกมุมมอง').click());
  act(() => root.unmount());
  mount();
  expect($('output').textContent).toBe('all');
  const select = $('select') as HTMLSelectElement;
  act(() => { select.value = 'Paid only'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect($('output').textContent).toBe('paid');
});

it('hides a column, remembers it, and never hides the last one', () => {
  mount();
  const [name, city] = [...host.querySelectorAll('details input')] as HTMLInputElement[];
  act(() => city.click());
  expect(headers()).toEqual(['zz-col-name']);
  expect(name.disabled).toBe(true);
  act(() => root.unmount());
  mount();
  expect(headers()).toEqual(['zz-col-name']);
});

it('ignores corrupt stored data', () => {
  localStorage.setItem('cp-views:anon:spec-page:views', '{not json');
  localStorage.setItem('cp-views:anon:spec-page:hidden', '[1,2]');
  mount();
  expect(headers()).toEqual(['zz-col-name', 'zz-col-city']);
  expect(($('select') as HTMLSelectElement).options.length).toBe(1);
});
