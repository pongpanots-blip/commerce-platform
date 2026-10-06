import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert, ArrowLink, Button, Checkbox, Chip, Empty, ErrorText, Field, Icon, Input, Loading, Page,
  PageHeader, Panel, PanelHead, SearchInput, Segmented, StatGrid, StatTile, Table, TBody, TD,
  TH, THead, TR, Textarea, fmt,
} from '@cp/ui';
import { CompetitorCatalogProduct, CompetitorPriceComparison, CompetitorPriceInput, CompetitorSkuSuggestion, competitorPricesApi } from '../../lib/api';
import { useAsync } from '../hooks';

const blank: CompetitorPriceInput = { sku: '', ourWeightKg: 1, sourceUrl: '', competitorName: '', competitorSku: '', competitorWeightKg: 1,
  sourceContext: '', vatIncluded: false, collectionAllowed: false, autoRefresh: false };
const weightLabels: Record<CompetitorSkuSuggestion['weightMatch'], string> = { same: 'น้ำหนักตรง', different: 'น้ำหนักต่างกัน', unknown: 'ไม่ทราบน้ำหนัก', per_kg: 'เราขายต่อกก.' };
const localNow = () => { const n = new Date(); return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };
const shopOf = (row: CompetitorPriceComparison) => { try { return new URL(row.sourceUrl).hostname.toLowerCase().replace(/^www\./, ''); } catch { return `ไม่ทราบร้าน (${row.id})`; } };
const finitePrice = (price: number | null): price is number => typeof price === 'number' && Number.isFinite(price);
const comparable = (row: CompetitorPriceComparison) => row.comparisonReady && row.verified && finitePrice(row.competitorPricePerKgIncVat) && finitePrice(row.differencePerKgIncVat);
type SkuComparison = { sku: string; name: string; offers: CompetitorPriceComparison[]; ourPrice: number | null; ourReason: string | null };

function PriceOffer({ offer, ourReason, selectedId, onSelect }: { offer: CompetitorPriceComparison; ourReason: string | null; selectedId: string | null; onSelect: (id: string) => void }) {
  const ready = !ourReason && comparable(offer);
  const gap = offer.differencePerKgIncVat;
  return <Button className="w-full min-h-11 flex-col items-start whitespace-normal! text-left" aria-label={`ดูคู่ ${offer.ourProduct.sku} กับ ${offer.sourceName} ${offer.sourceContext}`} aria-pressed={selectedId === offer.id} onClick={() => onSelect(offer.id)}>
    <span className="font-semibold break-words">{offer.competitorName}</span>
    <span className="text-xs text-on-surface-variant break-words">{offer.sourceName} · {offer.sourceContext || 'ยังไม่ระบุเงื่อนไขราคา'}</span>
    <span className="text-xs text-on-surface-variant">พบเมื่อ {offer.observedAt ? fmt.when(offer.observedAt) : 'ยังไม่มีเวลาที่พบราคา'}</span>
    {ready ? <><span className="text-sm font-semibold">{fmt.baht(offer.competitorPricePerKgIncVat)}/กก.</span><span className="text-xs">{gap === 0 ? 'ราคาเท่ากัน' : `${(gap ?? 0) > 0 ? 'เราถูกกว่า' : 'เราแพงกว่า'} ${fmt.baht(Math.abs(gap ?? 0))}/กก.`}</span></> : <span className="text-xs text-error">{ourReason || offer.comparisonReason || (!offer.verified ? 'รอตรวจและยืนยันคู่สินค้า' : null) || 'ข้อมูลราคายังไม่ครบ'}</span>}
  </Button>;
}

function PriceMatrix({ groups, shops, selectedId, onSelect }: { groups: SkuComparison[]; shops: string[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const ownPrice = (group: SkuComparison) => group.ourReason ? <span className="text-xs text-error">{group.ourReason}</span> : <span className="font-semibold">{fmt.baht(group.ourPrice)}/กก.</span>;
  const offers = (group: SkuComparison, shop: string) => {
    const items = group.offers.filter((offer) => shopOf(offer) === shop);
    return items.length ? <div className="space-y-2">{items.map((offer) => <PriceOffer key={offer.id} offer={offer} ourReason={group.ourReason} selectedId={selectedId} onSelect={onSelect} />)}</div> : <p className="text-xs text-on-surface-variant">ยังไม่มีคู่สินค้าร้านนี้</p>;
  };
  return <>
    <div className="hidden md:block min-w-0" role="region" aria-label="ตารางราคาหลายร้าน"><Table className="max-w-full"><THead>
      <th scope="col" className="w-44 min-w-44 max-w-44 px-3 py-3 font-semibold sticky left-0 z-20 bg-surface-container-low">สินค้าของเรา</th><th scope="col" className="w-40 min-w-40 px-3 py-3 font-semibold sticky left-44 z-20 bg-surface-container-low">เรา · บาท/กก.</th>
      {shops.map((shop) => <th scope="col" key={shop} className="min-w-60 px-3 py-3 font-semibold break-all">{shop}</th>)}
    </THead><TBody>{groups.map((group) => <TR key={group.sku}>
      <th scope="row" className="w-44 min-w-44 max-w-44 px-3 py-3 align-top text-left sticky left-0 z-10 bg-surface-container-lowest break-words"><span className="block font-semibold">{group.name}</span><span className="block font-mono text-xs text-on-surface-variant">{group.sku}</span></th>
      <TD className="w-40 min-w-40 align-top py-3 sticky left-44 z-10 bg-surface-container-lowest">{ownPrice(group)}</TD>{shops.map((shop) => <TD key={shop} className="align-top py-3">{offers(group, shop)}</TD>)}
    </TR>)}</TBody></Table></div>
    <div className="md:hidden divide-y divide-secondary-container">{groups.map((group) => <article key={group.sku} className="p-4 space-y-4 min-w-0 break-words" aria-label={`ราคาของ ${group.sku}`}>
      <div className="space-y-1"><h3 className="text-sm font-semibold">{group.name}</h3><p className="font-mono text-xs text-on-surface-variant">{group.sku}</p><p className="text-sm">เรา · {ownPrice(group)}</p></div>
      {shops.map((shop) => <section key={shop} className="space-y-2"><h4 className="text-sm font-semibold break-all">{shop}</h4>{offers(group, shop)}</section>)}
    </article>)}</div>
  </>;
}

/** Competitor price comparison (MER) — moved from josh web-admin; same rules and data. */
export function CompetitorPrices() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const catalogItemId = params.get('catalogItem');
  const rows = useAsync(() => competitorPricesApi.list(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'review' | 'ready'>('all');
  const [view, setView] = useState<'matrix' | 'pairs'>('matrix');
  const detail = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<CompetitorPriceInput | null>(null);
  const [editId, setEditId] = useState<string>();
  const [preview, setPreview] = useState<CompetitorCatalogProduct | null>(null);
  const [suggestions, setSuggestions] = useState<CompetitorSkuSuggestion[] | null>(null);
  const [panel, setPanel] = useState<'review' | 'price' | null>(null);
  const [matchNote, setMatchNote] = useState('');
  const [price, setPrice] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const all = rows.data ?? [];
  const selected = all.find((r) => r.id === selectedId) ?? (view === 'pairs' ? all[0] : undefined);

  useEffect(() => {
    if (!catalogItemId) return;
    let active = true;
    competitorPricesApi.catalogItem(catalogItemId).then((item) => {
      if (!active) return;
      setEditId(undefined);
      setPreview(null);
      setForm({ ...blank, catalogItemId: item.id, sourceUrl: item.url, competitorName: item.name, competitorSku: item.sku,
        competitorWeightKg: item.weightKg || 0, sourceContext: item.source.config.priceContext,
        vatIncluded: !!item.source.config.vatIncluded, collectionAllowed: !!item.source.config.collectionAllowed });
    }).catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    setSuggestions(null);
    competitorPricesApi.suggestions(catalogItemId).then((r) => { if (active) setSuggestions(r.suggestions); })
      .catch((e) => { if (active) { setSuggestions([]); setError(e instanceof Error ? e.message : String(e)); } });
    return () => { active = false; };
  }, [catalogItemId]);

  useEffect(() => { setPanel(null); setMatchNote(''); setPrice(''); }, [selected?.id, selected?.revision, selected?.ourProductVersion]);
  useEffect(() => { if (selectedId) { detail.current?.focus(); detail.current?.scrollIntoView({ block: 'start' }); } }, [selectedId]);

  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      rows.reload();
      setBusy(false);
    }
  }

  function edit(row?: CompetitorPriceComparison) {
    setPanel(null);
    setEditId(row?.id);
    setPreview(row?.ourProduct ?? null);
    setForm(row ? { revision: row.revision, sku: row.ourProduct.sku, ourWeightKg: row.ourWeightKg, sourceUrl: row.sourceUrl,
      competitorName: row.competitorName, competitorSku: row.competitorSku, competitorWeightKg: row.competitorWeightKg,
      sourceContext: row.sourceContext, vatIncluded: row.vatIncluded, collectionAllowed: row.collectionAllowed, autoRefresh: row.autoRefresh } : { ...blank });
  }

  function openPanel(kind: 'review' | 'price') {
    setForm(null);
    setPanel(kind);
    setMatchNote(selected?.matchNote ?? '');
    setPrice('');
    setObservedAt(localNow());
  }

  const matchesSearch = (r: CompetitorPriceComparison) => `${r.ourProduct.sku} ${r.ourProduct.name} ${r.competitorName} ${r.sourceName} ${r.sourceUrl} ${r.sourceContext}`.toLowerCase().includes(search.trim().toLowerCase());
  const visible = all.filter((r) => (filter === 'all' || (filter === 'review' ? !r.verified : r.comparisonReady)) && matchesSearch(r));
  const grouped = new Map<string, CompetitorPriceComparison[]>();
  for (const row of all) { const offers = grouped.get(row.ourProduct.sku) ?? []; offers.push(row); grouped.set(row.ourProduct.sku, offers); }
  const groups: SkuComparison[] = [...grouped.entries()].map(([sku, offers]) => {
    const rates = offers.map((offer) => offer.ourPricePerKgIncVat), prices = [...new Set(rates.filter(finitePrice))];
    const ourPrice = prices.length === 1 && rates.every(finitePrice) ? prices[0] : null;
    return { sku, name: offers[0].ourProduct.name, offers, ourPrice, ourReason: prices.length > 1 ? 'ราคาของเราต่อกก.ไม่ตรงกัน · ตรวจน้ำหนักและราคา' : ourPrice === null ? 'ยังยืนยันราคาของเราต่อกก.ไม่ได้' : null };
  });
  const shops = [...new Set(all.map(shopOf))].sort();
  const visibleGroups = groups.filter((group) => group.offers.some(matchesSearch) && (filter === 'all' || (filter === 'review' ? !!group.ourReason || group.offers.some((offer) => !offer.verified) : !group.ourReason && group.offers.some(comparable))));
  const selectedReason = view === 'matrix' ? groups.find((group) => group.sku === selected?.ourProduct.sku)?.ourReason : null;
  const selectedReady = !!selected && comparable(selected) && !selectedReason;
  const selectOffer = (id: string) => { setSelectedId(id); setPanel(null); setForm(null); };
  const pending = all.filter((r) => !r.verified).length;

  return (
    <Page>
      <PageHeader
        title="เทียบราคาคู่แข่ง"
        subtitle="เทียบราคาต่อกิโลกับแค็ตตาล็อก Josh · รวม VAT ไม่รวมค่าส่ง"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button icon="open_in_new" onClick={() => navigate('/marketing/scraped-catalog')} variant="ghost">เลือกจากคลังเว็บ</Button>
            <Button icon="refresh" onClick={rows.reload} variant="ghost">Refresh</Button>
            <Button icon="add" onClick={() => edit()}>เพิ่มคู่สินค้า</Button>
          </div>
        }
      />

      <ErrorText error={error || rows.error} />

      {rows.loading ? (
        <Loading />
      ) : (
        <StatGrid cols={3}>
          <StatTile label="สินค้าที่ติดตาม" value={fmt.num(groups.length)} foot={`${fmt.num(all.length)} คู่สินค้า`} />
          <StatTile label="ร้านคู่แข่ง" value={fmt.num(shops.length)} foot="รวมหน้าราคาจากโดเมนเดียวกัน" />
          <StatTile label="รอยืนยันคู่สินค้า" value={fmt.num(pending)} accent tone="warn" icon="pending_actions" />
        </StatGrid>
      )}

      {form && (
        <Panel>
          <PanelHead title={editId ? 'แก้ไขคู่สินค้า' : 'เพิ่มคู่สินค้า'} sub="เปลี่ยน SKU ลิงก์ น้ำหนัก จะล้างราคาเดิม" />
          <form aria-label="เพิ่มหรือแก้ไขคู่สินค้า" onSubmit={(e: FormEvent) => { e.preventDefault(); void action(async () => {
          const saved = await competitorPricesApi.save(form, editId);
          setSelectedId(saved.id);
          setForm(null);
        }); }}>
          <div className="space-y-4 p-4">
            {form.catalogItemId && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">SKU ของเราที่น่าจะตรงกับ "{form.competitorName}"</h3>
                {suggestions == null ? (
                  <p className="text-[11px] text-on-surface-variant">กำลังหา SKU ที่ชื่อใกล้เคียง…</p>
                ) : !suggestions.length ? (
                  <p className="text-[11px] text-on-surface-variant">ไม่พบ SKU ที่ชื่อใกล้เคียง กรอก SKU เองด้านล่าง</p>
                ) : (
                  <Table>
                    <TBody>
                      {suggestions.map((s) => (
                        <TR key={s.sku}>
                          <TD>
                            <div className="font-medium">{s.name}</div>
                            <div className="text-[10px] font-mono text-on-surface-variant">
                              {s.sku} · {s.brand || 'ไม่ระบุแบรนด์'} · {fmt.baht(s.sellingUnitPriceIncVat)}/{s.sellingUnit || 'หน่วย'}
                            </div>
                          </TD>
                          <TD>
                            <Chip tone="muted">ชื่อคล้าย {s.similarityPercent}%</Chip>
                            <Chip tone={s.weightMatch === 'different' ? 'warn' : s.weightMatch === 'unknown' ? 'muted' : 'ok'} className="ml-1">
                              {weightLabels[s.weightMatch]}
                            </Chip>
                          </TD>
                          <TD kind="actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy || form.sku === s.sku}
                              onClick={() => { setForm({ ...form, sku: s.sku, ourWeightKg: s.ourWeightKg ?? form.ourWeightKg }); setPreview(s); }}
                            >
                              {form.sku === s.sku ? 'เลือกแล้ว' : 'ใช้ SKU นี้'}
                            </Button>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="SKU ของเรา">
                <Input required maxLength={100} value={form.sku} onChange={(e) => { setForm({ ...form, sku: e.target.value }); setPreview(null); }} />
              </Field>
              <Field label="น้ำหนักต่อหน่วยขายของเรา (กก.)">
                <Input type="number" min="0.0001" max="100000" step="0.0001" required value={form.ourWeightKg} onChange={(e) => setForm({ ...form, ourWeightKg: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="button" icon="check" variant="ghost" disabled={busy || !form.sku.trim()} onClick={() => void action(async () => setPreview(await competitorPricesApi.catalog(form.sku)))}>
                ตรวจ SKU
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="ชื่อสินค้าคู่แข่ง"><Input required maxLength={500} value={form.competitorName} onChange={(e) => setForm({ ...form, competitorName: e.target.value })} /></Field>
              <Field label="SKU คู่แข่ง (ถ้ามี)"><Input maxLength={100} value={form.competitorSku} onChange={(e) => setForm({ ...form, competitorSku: e.target.value })} /></Field>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="ลิงก์หน้าสินค้า"><Input type="url" required maxLength={2000} placeholder="https://…" value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value, catalogItemId: undefined })} /></Field>
              <Field label="น้ำหนักสุทธิต่อแพ็กคู่แข่ง (กก.)"><Input type="number" min="0.0001" max="100000" step="0.0001" required value={form.competitorWeightKg} onChange={(e) => setForm({ ...form, competitorWeightKg: Number(e.target.value) })} /></Field>
            </div>
            <Field label="เงื่อนไขราคา / สาขา / โปรโมชั่น"><Textarea aria-label="เงื่อนไขราคา / สาขา / โปรโมชั่น" required maxLength={1000} value={form.sourceContext} onChange={(e) => setForm({ ...form, sourceContext: e.target.value })} /></Field>
            <div className="space-y-2">
              <Checkbox label="ตรวจแล้วว่าราคาคู่แข่งรวม VAT" checked={form.vatIncluded} onChange={(e) => setForm({ ...form, vatIncluded: e.target.checked, autoRefresh: e.target.checked && form.autoRefresh })} />
              <Checkbox label="มีสิทธิ์ดึงข้อมูลอัตโนมัติ" checked={form.collectionAllowed} onChange={(e) => setForm({ ...form, collectionAllowed: e.target.checked, autoRefresh: e.target.checked && form.autoRefresh })} />
              <Checkbox label="ดึงราคาอัตโนมัติวันละครั้ง" disabled={!form.vatIncluded || !form.collectionAllowed} checked={form.autoRefresh} onChange={(e) => setForm({ ...form, autoRefresh: e.target.checked })} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>บันทึก</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setForm(null)}>ยกเลิก</Button>
            </div>
          </div>
            </form>
        </Panel>
      )}

      {selected && (
        <div ref={detail} tabIndex={-1} aria-label="รายละเอียดคู่สินค้า"><Panel>
          <PanelHead title={selected.ourProduct.name} sub={`SKU ${selected.ourProduct.sku}`} />
          <div className="space-y-4 p-4">
            <p className="text-sm break-words">{selected.competitorName} · {selected.sourceName} · {selected.sourceContext} · พบเมื่อ {selected.observedAt ? fmt.when(selected.observedAt) : 'ยังไม่มีราคา'}</p>
            <StatGrid cols={3}>
              <StatTile label="ราคาของเรา (Josh)" value={selectedReason || fmt.baht(selected.ourPricePerKgIncVat) + '/กก.'} />
              <StatTile label={selected.sourceName} value={fmt.baht(selected.competitorPricePerKgIncVat) + '/กก.'} />
              <StatTile
                label={!selectedReady ? 'ยังคำนวณไม่ได้' : selected.differencePerKgIncVat === 0 ? 'ราคาเท่ากัน' : (selected.differencePerKgIncVat ?? 0) > 0 ? 'เราถูกกว่า' : 'เราแพงกว่า'}
                value={selectedReady ? fmt.baht(Math.abs(selected.differencePerKgIncVat ?? 0)) + '/กก.' : (selectedReason || selected.comparisonReason || 'ข้อมูลราคายังไม่ครบ')}
                tone={!selectedReady ? 'muted' : (selected.differencePerKgIncVat ?? 0) >= 0 ? 'ok' : 'danger'}
              />
            </StatGrid>
            <div className="flex flex-wrap gap-2">
              <Button icon="edit" variant="ghost" disabled={busy} onClick={() => edit(selected)}>แก้ไขคู่สินค้า</Button>
              <Button icon="check_circle" variant="ghost" type="button" disabled={busy} onClick={() => openPanel('review')}>ตรวจคู่สินค้า</Button>
              <Button icon="edit" variant="ghost" type="button" disabled={busy || !selected.vatIncluded} onClick={() => openPanel('price')}>บันทึกราคา</Button>
              <Button icon="refresh" type="button" disabled={busy || !selected.canRefresh} title={selected.refreshReason ?? undefined} onClick={() => void action(() => competitorPricesApi.refresh(selected.id))}>ดึงราคา</Button>
            </div>
          </div>
        </Panel></div>
      )}

      {panel === 'review' && selected && (
        <Panel>
          <form aria-label="ตรวจคู่สินค้า" onSubmit={(e: FormEvent) => { e.preventDefault(); void action(async () => { await competitorPricesApi.verify(selected, matchNote); setPanel(null); }); }}>
          <PanelHead title="ตรวจว่าเป็นสินค้าเทียบเคียงกัน" actions={<Button icon="close" variant="ghost" size="sm" type="button" onClick={() => setPanel(null)}>ปิด</Button>} />
          <div className="space-y-4 p-4">
            <Field label="เหตุผลและสเปกที่ตรงกัน">
              <Textarea aria-label="เหตุผลและสเปกที่ตรงกัน" required minLength={10} maxLength={1000} value={matchNote} onChange={(e) => setMatchNote(e.target.value)} placeholder="ระบุชนิด เกรด ประเทศ สภาพการเก็บรักษา" />
            </Field>
            <Checkbox label="ตรวจสเปกแล้ว" required onChange={() => {}} />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy} icon={busy ? 'progress_activity' : 'check'}>ยืนยัน</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setPanel(null)}>ปิด</Button>
            </div>
          </div>
            </form>
        </Panel>
      )}

      {panel === 'price' && selected && (
        <Panel>
          <form aria-label="บันทึกราคา" onSubmit={(e: FormEvent) => { e.preventDefault(); void action(async () => { await competitorPricesApi.capture(selected, Number(price), new Date(observedAt).toISOString()); setPanel(null); }); }}>
          <PanelHead title={`บันทึกราคาที่พบจาก ${selected.sourceName}`} actions={<Button icon="close" variant="ghost" size="sm" type="button" onClick={() => setPanel(null)}>ปิด</Button>} />
          <div className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={`ราคาเต็มแพ็ก ${selected.competitorWeightKg} กก. (บาท รวม VAT)`}>
                <Input type="number" required min="0.01" max="9999999999.99" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
              </Field>
              <Field label="เวลาที่พบราคา">
                <Input type="datetime-local" step="1" required value={observedAt} onChange={(e) => setObservedAt(e.target.value)} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy} icon={busy ? 'progress_activity' : 'save'}>บันทึก</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setPanel(null)}>ปิด</Button>
            </div>
          </div>
            </form>
        </Panel>
      )}

      <Panel>
        <PanelHead title="สินค้าที่ติดตาม" sub={`${groups.length} SKU · ${shops.length} ร้าน · ${all.length} คู่สินค้า`} actions={<Segmented<'matrix' | 'pairs'> options={[{ value: 'matrix', label: 'หลายร้านต่อ SKU' }, { value: 'pairs', label: 'คู่สินค้า / จัดการ' }]} value={view} onChange={setView} />} />
        <div className="space-y-3 p-4 border-b border-secondary-container">
          <div className="grid gap-3 md:grid-cols-2">
            <SearchInput aria-label="ค้นหา SKU หรือร้าน" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา SKU / ชื่อสินค้า / ร้าน" />
            <Segmented<'all' | 'review' | 'ready'>
              options={[
                { value: 'all', label: 'ทั้งหมด' },
                { value: 'review', label: 'รอยืนยัน' },
                { value: 'ready', label: 'เทียบได้' },
              ]}
              value={filter}
              onChange={(v) => setFilter(v)}
            />
          </div>
          {view === 'matrix' && <p className="text-xs text-on-surface-variant">ค้นหาหรือกรองสถานะแล้วแสดงทุกร้านของ SKU ที่ตรง · แสดงทุกข้อเสนอแยกตามเงื่อนไขราคา</p>}
        </div>
        {rows.loading ? (
          <Loading />
        ) : !(view === 'matrix' ? visibleGroups.length : visible.length) ? (
          <Empty>{all.length ? 'ไม่พบคู่สินค้า' : 'ยังไม่มีคู่สินค้า'}</Empty>
        ) : view === 'matrix' ? (
          <PriceMatrix groups={visibleGroups} shops={shops} selectedId={selectedId} onSelect={selectOffer} />
        ) : (
          <Table>
            <THead>
              <TH>สินค้าของเรา</TH>
              <TH>คู่แข่ง / แหล่งที่มา</TH>
              <TH right>เรา / กก.</TH>
              <TH right>คู่แข่ง / กก.</TH>
              <TH right>ส่วนต่าง</TH>
              <TH>สถานะ</TH>
              <TH right />
            </THead>
            <TBody>
              {visible.map((r) => (
                <TR key={r.id} selected={selected?.id === r.id} onClick={() => selectOffer(r.id)}>
                  <TD>
                    <div className="font-medium">{r.ourProduct.name}</div>
                    <div className="text-[10px] font-mono text-on-surface-variant">{r.ourProduct.sku}</div>
                  </TD>
                  <TD>
                    <ArrowLink to={r.sourceUrl} tone="primary">{r.sourceName}</ArrowLink>
                    <div className="text-[10px] text-on-surface-variant">{r.competitorName}</div>
                  </TD>
                  <TD kind="money">{fmt.baht(r.ourPricePerKgIncVat)}</TD>
                  <TD kind="money">{fmt.baht(r.competitorPricePerKgIncVat)}</TD>
                  <TD kind="money" className={r.differencePerKgIncVat && r.differencePerKgIncVat > 0 ? 'text-[#157347]' : 'text-[#c2333f]'}>
                    {r.comparisonReady ? fmt.baht(r.differencePerKgIncVat) : '—'}
                  </TD>
                  <TD className="text-[11px]">{r.comparisonReady ? 'ยืนยัน' : r.comparisonReason}</TD>
                  <TD kind="actions">
                    <Button size="sm" variant="danger-ghost" disabled={busy} onClick={(e) => { e.stopPropagation(); if (window.confirm(`ลบคู่ ${r.ourProduct.sku}?`)) void action(async () => { await competitorPricesApi.remove(r.id); if (selectedId === r.id) setSelectedId(null); }); }}>
                      ลบ
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}
