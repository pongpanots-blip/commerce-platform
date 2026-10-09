// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { setUiLocale } from '@cp/ui';
import { api } from '../../lib/api';
import { MarketingHomeSummary, marketingHomeMetrics } from './MarketingHomeSummary';
vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root;
const metric = (key: string, value: number | null, reason: string | null = null) => ({ key, value, reason, availability: value === null ? 'unavailable' : 'available', definition: 'Observed report definition.' });
const answer = () => ({ schemaVersion: 1, role: 'marketing', metrics: [metric('priced_records', 7), metric('sessions', 0), metric('recorded_sent', 4), metric('roas', null, 'Spend and attributed sales are unavailable.')] });
beforeEach(() => { vi.resetAllMocks(); setUiLocale('en'); vi.mocked(api.get).mockResolvedValue(answer()); node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(() => { act(() => root.unmount()); node.remove(); setUiLocale('th'); });
it('preserves zero, uses the authorized home endpoint and leaves ROAS unavailable', async () => {
  await act(async () => root.render(<MarketingHomeSummary />)); expect(api.get).toHaveBeenCalledWith('/reports/home?period=this_month');
  expect(node.textContent).toContain('Visits this month0'); expect(node.textContent).toContain('Spend and attributed sales are unavailable.');
});
it('shows loading, preserves no successful claim on failure and retries', async () => {
  let reject!: (e: Error) => void; vi.mocked(api.get).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await act(async () => root.render(<MarketingHomeSummary />)); expect(node.querySelector('[aria-busy="true"]')).not.toBeNull();
  await act(async () => reject(new Error('Summary reader unavailable'))); expect(node.textContent).toContain('Summary reader unavailable');
  expect(node.textContent).not.toContain('Visits this month0');
  await act(async () => [...node.querySelectorAll('button')].find(b => b.textContent === 'Try again')!.click()); expect(node.textContent).toContain('Visits this month0');
});
it('rejects role leakage, duplicate keys and inconsistent evidence instead of inventing zero', () => {
  for (const bad of [{ ...answer(), role: 'admin' }, { ...answer(), metrics: [metric('x', 0), metric('x', 1)] },
    { ...answer(), metrics: [{ ...metric('x', null), availability: 'available' }] }, { ...answer(), metrics: [{ ...metric('x', 1), value: '1' }] }, {}]) expect(() => marketingHomeMetrics(bad)).toThrow('could not be verified');
});
it('retains independent evidence on a source failure and offers a working retry', async () => {
  const partial = answer(); partial.metrics[1] = metric('sessions', null, 'Source unavailable');
  vi.mocked(api.get).mockResolvedValueOnce({ ...partial, failedSources: ['traffic'] });
  await act(async () => root.render(<MarketingHomeSummary />));
  expect(node.textContent).toContain('Products with a selling price7'); expect(node.textContent).toContain('Some summary sources could not be read');
  expect(node.textContent).not.toContain('Visits this month0');
  await act(async () => [...node.querySelectorAll('button')].find(b => b.textContent === 'Try again')!.click());
  expect(node.textContent).toContain('Visits this month0'); expect(node.textContent).not.toContain('Some summary sources could not be read');
});
it('uses plain Thai explanations and keeps partial coverage visible without exposing the API definition', async () => {
  setUiLocale('th'); const partial = answer(); partial.metrics[0] = { ...metric('priced_records', 7), availability: 'partial' };
  vi.mocked(api.get).mockResolvedValueOnce(partial); await act(async () => root.render(<MarketingHomeSummary />));
  expect(node.textContent).toContain('นับราคาที่มากกว่า 0'); expect(node.textContent).toContain('รายงานยังไม่ครบ'); expect(node.textContent).not.toContain('Observed report definition.');
});
