// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { setUiLocale } from '@cp/ui';
import { TaskSection } from './TaskSection';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
HTMLDialogElement.prototype.close ??= function () { this.open = false; };
let container: HTMLDivElement, root: Root;
function Location() { const location = useLocation(), navigate = useNavigate(); return <><output>{location.pathname + location.search}</output><button onClick={() => navigate(-1)}>Back test</button><button onClick={() => navigate(1)}>Forward test</button></>; }
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label)!;
async function render(path: string, role = 'merchandising') { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Location /><Routes><Route path="/tasks/:sectionId" element={<TaskSection role={role} />} /></Routes></MemoryRouter>)); }
beforeEach(() => { setUiLocale('en'); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); setUiLocale('th'); });
it('keeps differently scoped catalog features separate and preserves canonical links', async () => { await render('/tasks/catalog'); for (const to of ['/products', '/j/allproducts', '/product-prices', '/stock-moves', '/product-master-queue']) expect(container.querySelector(`a[href="${to}"]`)).not.toBeNull(); expect(container.querySelector('a[href="/josh/suppliers"]')).toBeNull(); expect(container.querySelector('a[href="/j/marketing/competitor-prices"]')).toBeNull(); });
it('denies a restricted direct task index without exposing its feature links', async () => { await render('/tasks/catalog', 'cs'); expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.querySelector('a[href="/products"]')).toBeNull(); expect(container.querySelector('a[href="/home"]')).not.toBeNull(); });
it('preserves a search deep link and lets an empty search recover using back/forward history', async () => { await render('/tasks/catalog?q=no-such-task'); expect(container.textContent).toContain('No tasks match this search'); await act(async () => button('Clear filters').click()); expect(container.querySelector('output')?.textContent).toBe('/tasks/catalog'); expect(container.querySelector('a[href="/products"]')).not.toBeNull(); await act(async () => button('Back test').click()); expect(container.textContent).toContain('No tasks match this search'); await act(async () => button('Forward test').click()); expect(container.querySelector('a[href="/products"]')).not.toBeNull(); });
