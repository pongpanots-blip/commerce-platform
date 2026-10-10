// ui-copy-migration: only literal UI copy and notification templates
import { useState } from 'react';
import { Alert, Button, Checkbox, Empty, Field, Input, Loading, Page, PageHeader, Panel, PanelHead, Segmented, Select, Table, TBody, TD, TH, THead, TR,
  uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { EventAttributeDef, EventAttributeType, EventDefinition, EventDefinitionInput } from '@cp/marketing-workflow';
import { eventsApi } from '../../../lib/api';
import { useAsync } from '../../hooks';

const errorText = (e: unknown) => {
  const d = (e as { details?: { issues?: string[]; users?: string[]; message?: string } })?.details;
  return [d?.message, ...(d?.issues ?? []), ...(d?.users ?? [])].filter(Boolean).join(' · ') || (e instanceof Error ? e.message : String(e));
};
const TYPES: EventAttributeType[] = ['string', 'number', 'boolean', 'date'];
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** /marketing/events: catalog (what ingest accepts), recent events, daily totals (spec §14). */
export function EventsPage() {
  __useUiLocale();
  const [tab, setTab] = useState<'catalog' | 'recent' | 'daily'>('catalog');
  return (
    <Page>
      <PageHeader title={__uiText('Event ลูกค้า')} />
      <Alert tone="info">{__uiText('ห้ามประกาศ attribute ที่เป็นข้อมูลส่วนบุคคล (อีเมล เบอร์โทร ชื่อ ที่อยู่) — ระบบจะปฏิเสธ')}</Alert>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'catalog', label: __uiText('รายการ event') },
        { value: 'recent', label: __uiText('Event ล่าสุด') }, { value: 'daily', label: __uiText('รายวัน') }]} />
      <div className="mt-3">{tab === 'catalog' ? <Catalog /> : tab === 'recent' ? <Recent /> : <Daily />}</div>
    </Page>
  );
}

function Catalog() {
  __useUiLocale();
  const data = useAsync(() => eventsApi.definitions(), []);
  const [editing, setEditing] = useState<EventDefinition | 'new' | null>(null);
  if (data.loading && !data.data) return <Loading />;
  const coverage = data.data?.coverage ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-on-surface-variant">
        {coverage.length ? coverage.map((c) => `${c.platform}: ${__uiText('เริ่มเก็บ')} ${new Date(c.collectingSince).toLocaleDateString()}`).join(' · ')
          : __uiText('ยังไม่มี event เข้ามา')}
      </p>
      {editing ? <DefinitionEditor value={editing === 'new' ? null : editing} onDone={() => { setEditing(null); data.reload(); }} /> : (
        <Panel>
          <PanelHead title={__uiText('รายการ event')} actions={<Button size="sm" icon="add" onClick={() => setEditing('new')}>{__uiText('สร้าง event')}</Button>} />
          <Table>
            <THead><TH>{__uiText('ชื่อ')}</TH><TH>{__uiText('แสดงเป็น')}</TH><TH>{__uiText('Attribute')}</TH><TH>{__uiText('หลักฐาน')}</TH><TH>{__uiText('สถานะ')}</TH><TH kind="actions" /></THead>
            <TBody>{(data.data?.definitions ?? []).map((d) => (
              <TR key={d.name}>
                <TD kind="mono">{d.name}</TD><TD>{d.label}</TD>
                <TD>{d.attributes.filter((a) => !a.archived).map((a) => `${a.key}:${a.type}`).join(', ') || '—'}</TD>
                <TD>{d.evidence === 'browser' ? __uiText('จากหน้าเว็บ / แอป') : __uiText('จากเซิร์ฟเวอร์')}</TD>
                <TD>{d.status === 'active' ? __uiText('ใช้งาน') : __uiText('เก็บถาวร')}</TD>
                <TD kind="actions"><Button size="sm" variant="ghost" onClick={() => setEditing(d)}>{__uiText('แก้ไข')}</Button></TD>
              </TR>
            ))}</TBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}

function DefinitionEditor({ value, onDone }: { value: EventDefinition | null; onDone: () => void }) {
  __useUiLocale();
  const [d, setD] = useState<EventDefinitionInput>(value ?? { name: '', label: '', description: null, evidence: 'browser', attributes: [] });
  const [error, setError] = useState<string | null>(null);
  const known = new Set((value?.attributes ?? []).map((a) => a.key));
  const setAttr = (i: number, patch: Partial<EventAttributeDef>) => setD({ ...d, attributes: d.attributes.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const save = async () => {
    setError(null);
    try { if (value) await eventsApi.updateDefinition(value.name, d); else await eventsApi.createDefinition(d); onDone(); }
    catch (e) { setError(errorText(e)); }
  };
  const archive = async () => { setError(null); try { await eventsApi.archive(value!.name); onDone(); } catch (e) { setError(errorText(e)); } };
  return (
    <Panel>
      <PanelHead title={value ? value.name : __uiText('สร้าง event')} />
      <div className="space-y-3 p-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label={__uiText('ชื่อ (a-z 0-9 _)')}><Input value={d.name} disabled={!!value} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label={__uiText('แสดงเป็น')}><Input value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} /></Field>
        </div>
        <Field label={__uiText('หลักฐาน')}>
          <Select value={d.evidence} onChange={(e) => setD({ ...d, evidence: e.target.value as EventDefinitionInput['evidence'] })}>
            <option value="browser">{__uiText('จากหน้าเว็บ / แอป (ผู้ใช้ปลอมได้ ไม่ใช่หลักฐานการซื้อ)')}</option>
            <option value="server">{__uiText('จากเซิร์ฟเวอร์')}</option>
          </Select>
        </Field>
        <Field label={__uiText('Attribute')}>
          <div className="space-y-2">
            {d.attributes.map((a, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px_1fr_auto] items-center gap-2">
                <Input value={a.key} disabled={known.has(a.key)} placeholder="item_id" onChange={(e) => setAttr(i, { key: e.target.value })} />
                <Select value={a.type} disabled={known.has(a.key)} onChange={(e) => setAttr(i, { type: e.target.value as EventAttributeType })}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
                <Input value={a.label} placeholder={__uiText('แสดงเป็น')} onChange={(e) => setAttr(i, { label: e.target.value })} />
                {known.has(a.key)
                  ? <Checkbox checked={!!a.archived} onChange={(e) => setAttr(i, { archived: e.target.checked })} label={__uiText('เก็บถาวร')} />
                  : <Button size="sm" variant="ghost" icon="close" onClick={() => setD({ ...d, attributes: d.attributes.filter((_, j) => j !== i) })}>{__uiText('ลบ')}</Button>}
              </div>
            ))}
            <Button size="sm" icon="add" onClick={() => setD({ ...d, attributes: [...d.attributes, { key: '', type: 'string', label: '' }] })}>{__uiText('เพิ่ม attribute')}</Button>
          </div>
        </Field>
        <div className="flex gap-2">
          <Button variant="primary" onClick={save}>{__uiText('บันทึก')}</Button>
          <Button onClick={onDone}>{__uiText('ยกเลิก')}</Button>
          {value?.status === 'active' && <Button variant="danger-ghost" onClick={archive}>{__uiText('เก็บถาวร event นี้')}</Button>}
        </div>
      </div>
    </Panel>
  );
}

function Recent() {
  __useUiLocale();
  const [q, setQ] = useState({ deviceId: '', userId: '', name: '', page: 1 });
  const [applied, setApplied] = useState(q);
  const list = useAsync(() => eventsApi.list(applied), [applied]);
  return (
    <Panel>
      <div className="flex flex-wrap items-end gap-2 p-4">
        <Field label={__uiText('Device')}><Input value={q.deviceId} onChange={(e) => setQ({ ...q, deviceId: e.target.value.trim() })} /></Field>
        <Field label={__uiText('User')}><Input value={q.userId} onChange={(e) => setQ({ ...q, userId: e.target.value.trim() })} /></Field>
        <Field label={__uiText('Event')}><Input value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value.trim() })} /></Field>
        <Button onClick={() => setApplied({ ...q, page: 1 })}>{__uiText('ค้นหา')}</Button>
      </div>
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      {list.loading && !list.data ? <Loading /> : list.data?.rows.length ? (
        <Table>
          <THead><TH kind="time">{__uiText('เวลา')}</TH><TH>{__uiText('Event')}</TH><TH>{__uiText('Device')}</TH><TH>{__uiText('User')}</TH><TH>{__uiText('ระบุตัวจาก')}</TH><TH>{__uiText('Attribute')}</TH></THead>
          <TBody>{list.data.rows.map((r) => (
            <TR key={r.eventId}>
              <TD kind="time">{new Date(r.occurredAt).toLocaleString()}</TD><TD kind="mono">{r.name}</TD>
              <TD kind="mono">{r.deviceId.slice(0, 10)} · {r.platform}</TD><TD kind="mono">{r.attributedUserId?.slice(0, 8) ?? '—'}</TD>
              <TD>{r.attribution ?? __uiText('guest')}</TD><TD kind="mono">{JSON.stringify(r.attributes)}</TD>
            </TR>
          ))}</TBody>
        </Table>
      ) : <Empty>{__uiText('ไม่พบ event')}</Empty>}
      {(list.data?.total ?? 0) > 50 && (
        <div className="flex justify-end gap-2 p-3">
          <Button size="sm" disabled={applied.page === 1} onClick={() => setApplied({ ...applied, page: applied.page - 1 })}>{__uiText('ก่อนหน้า')}</Button>
          <Button size="sm" disabled={applied.page * 50 >= (list.data?.total ?? 0)} onClick={() => setApplied({ ...applied, page: applied.page + 1 })}>{__uiText('ถัดไป')}</Button>
        </div>
      )}
    </Panel>
  );
}

function Daily() {
  __useUiLocale();
  const [range, setRange] = useState({ from: day(-14), to: day(-1) });
  const rows = useAsync(() => eventsApi.daily(range.from, range.to), [range]);
  return (
    <Panel>
      <div className="flex items-end gap-2 p-4">
        <Field label={__uiText('ตั้งแต่')}><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label={__uiText('ถึง')}><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
      </div>
      {rows.loading && !rows.data ? <Loading /> : rows.data?.length ? (
        <Table>
          <THead><TH>{__uiText('วันที่')}</TH><TH>{__uiText('Event')}</TH><TH>{__uiText('แพลตฟอร์ม')}</TH><TH kind="num">{__uiText('จำนวน')}</TH><TH kind="num">{__uiText('ลูกค้า')}</TH><TH kind="num">{__uiText('อุปกรณ์')}</TH></THead>
          <TBody>{rows.data.map((r) => (
            <TR key={`${r.date}:${r.name}:${r.platform}`}><TD>{r.date}</TD><TD kind="mono">{r.name}</TD><TD>{r.platform}</TD>
              <TD kind="num">{r.events}</TD><TD kind="num">{r.users}</TD><TD kind="num">{r.devices}</TD></TR>
          ))}</TBody>
        </Table>
      ) : <Empty>{__uiText('ยังไม่มีสรุปรายวันในช่วงนี้ (สรุปทุกคืนตี 3)')}</Empty>}
    </Panel>
  );
}
