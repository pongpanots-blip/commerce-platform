// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
// Stitch screen: docs/design/stitch/admin-overview.html
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLink, Button, Chip, Empty, ErrorText, Icon, Loading, PageHeader, Panel, PanelHead, SectionTitle,
  StatGrid, StatTile, StatusChip, TBody, TD, TH, THead, TR, Table, fmt, useNavigation,
} from '@cp/ui';
import { AdminStats, Integration, SyncJob, api, webhookApi } from '../../lib/api';
import { useAsync } from '../hooks';
import { SECTIONS } from '../navigation';
import { CommercePage as Page } from '../CommercePage';
import { commerceText as text } from '../commerce-copy';
import { WorkspaceMetric, WorkspaceLink } from '../WorkspaceParts';
import { operationLabel } from './SyncJobs';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

function duration(job: SyncJob): string {
  if (!job.updatedAt || job.status === 'pending' || job.status === 'running') return '—';
  const s = Math.max(0, Math.round((new Date(job.updatedAt).getTime() - new Date(job.createdAt).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

const host = (url: string) => {
  try { return new URL(url).host; } catch { return url; }
};

export function Dashboard() {
  __useUiLocale();
  const stats = useAsync(() => api.get<AdminStats>('/admin/stats'));
  const jobs = useAsync(() => api.get<SyncJob[]>('/sync-jobs'));
  const integrations = useAsync(() => api.get<Integration[]>('/integrations'));
  const deliveries = useAsync(() => webhookApi.deliveries());

  const s = stats.data;
  const d = s?.details;
  const integrationName = new Map((integrations.data ?? []).map((i) => [i.id, i.name]));
  const recentJobs = (jobs.data ?? []).slice(0, 6);
  const failures = (deliveries.data ?? []).filter((x) => x.status === 'failed').slice(0, 5);
  const nav = useNavigation();
  const [updatedAt, setUpdatedAt] = useState('—');
  useEffect(() => { if (stats.data) setUpdatedAt(new Date().toLocaleTimeString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), { hour: '2-digit', minute: '2-digit' })); }, [stats.data]);

  function reloadAll() {
    stats.reload();
    jobs.reload();
    integrations.reload();
    deliveries.reload();
  }

  return (
    <Page>
      <PageHeader
        title={__uiText("ภาพรวมการทำงาน")}
        subtitle={__uiText("เริ่มจากงานที่ต้องทำ แล้วติดตามรายการที่ต้องดูแลในวันนี้")}
        actions={
          <>
            <span className="flex items-center gap-1.5 text-xs text-outline">
              <Icon name="schedule" size={14} />
              {__uiText("อัปเดตล่าสุด ")}<span className="tabular-nums">{updatedAt}</span>
            </span>
            <Button icon="refresh" onClick={reloadAll} disabled={stats.loading}>{__uiText("รีเฟรชข้อมูล")}</Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[['การพยายามชำระ', 'Payment attempts'], ['รับเงินเข้าบัญชี', 'Settlement'], ['คืนเงิน', 'Refund records'], ['ข้อพิพาท', 'Disputes']].map(([th, en]) => <WorkspaceMetric key={en} label={text(th, en)} reason={text('ภาพรวมนี้ยังไม่มีตัวเลขสรุปเรื่องนี้ เปิดรายการที่เกี่ยวข้องเพื่อดูรายละเอียด', 'This overview has no summary for this yet. Open the related records for details.')} />)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2"><WorkspaceLink to="/j/payment-transactions">{text('ตรวจการพยายามชำระและข้อจำกัดของข้อมูลรับเงิน', 'Inspect payment attempts and settlement data gaps')}</WorkspaceLink><WorkspaceLink to="/j/refunds">{text('ตรวจรายการคืนสินค้าและคืนเงิน', 'Inspect return and refund records')}</WorkspaceLink></div>
      <section aria-label={__uiText("เลือกหมวดงาน")}>
        <div className="mb-3 flex items-center gap-2"><h2 className="font-semibold">{__uiText("เลือกหมวดงาน")}</h2><span className="text-xs text-on-surface-variant">{__uiText("ทุกเครื่องมือ จัดตามงานที่คุณทำ")}</span></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SECTIONS.map(section => ({ section, links: nav.find(group => group.group === section.title)?.links ?? [] })).filter(({ links }) => links.length > 0).map(({ section }) => <Link key={section.id} to={`/tasks/${section.id}`} className="group rounded-xl border border-secondary-container bg-surface-container-lowest p-4 shadow-card transition-[color,background-color,border-color,box-shadow] hover:border-primary/50 hover:shadow-raised focus-visible:outline-2 focus-visible:outline-primary">
            <div className="flex items-center justify-between"><span className="flex size-9 items-center justify-center rounded-lg bg-surface-container-low text-primary"><Icon name={section.icon} size={21} /></span><Icon name="arrow_forward" size={17} className="text-outline group-hover:text-primary" /></div>
            <h3 className="mt-3 text-sm font-semibold">{__uiText(section.title)}</h3><p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{__uiText(section.description)}</p>
          </Link>)}
        </div>
      </section>

      <ErrorText error={stats.error} onRetry={stats.reload} />
      {stats.loading && !s ? (
        <Loading />
      ) : s && d ? (
        <>
          <div>
            <SectionTitle note={__uiText("รายการจากระบบที่ต้องติดตาม")}>{__uiText("งานที่ต้องดูแล")}</SectionTitle>
            <StatGrid cols={3}>
              <StatTile
                accent
                tone={s.webhooksPending ? 'warn' : 'ok'}
                icon={s.webhooksPending ? 'hourglass_top' : 'check_circle'}
                label={__uiText("Webhooks pending")}
                value={fmt.num(s.webhooksPending)}
                foot={
                  <>
                    <span>{d.oldestPendingWebhookAt ? __uiText("Oldest waiting: {0}", {"0": fmt.ago(d.oldestPendingWebhookAt)}) : __uiText("Queue is empty")}</span>
                    <ArrowLink to="/webhooks" tone={s.webhooksPending ? 'warn' : 'muted'}>{__uiText("View")}</ArrowLink>
                  </>
                }
              />
              <StatTile
                accent
                tone={s.webhooksFailed ? 'danger' : 'ok'}
                icon={s.webhooksFailed ? 'error' : 'check_circle'}
                label={__uiText("Inbound webhooks failed")}
                value={fmt.num(s.webhooksFailed)}
                foot={
                  <>
                    <span className={s.webhooksFailed ? 'text-danger' : 'text-ok'}>{s.webhooksFailed ? __uiText("Needs replay or fix") : __uiText("No failures")}</span>
                    <ArrowLink to="/webhooks" tone={s.webhooksFailed ? 'danger' : 'muted'}>{__uiText("View")}</ArrowLink>
                  </>
                }
              />
              <StatTile
                accent
                tone={s.outboxBacklog ? 'warn' : 'ok'}
                icon={s.outboxBacklog ? 'outbox' : 'check_circle'}
                label={__uiText("Outbox backlog")}
                value={fmt.num(s.outboxBacklog)}
                foot={
                  <>
                    <span className={s.outboxBacklog ? undefined : 'text-ok'}>{s.outboxBacklog ? __uiText("Events waiting to publish") : __uiText("All channels normalized")}</span>
                    <ArrowLink to="/subscriptions" tone={s.outboxBacklog ? 'warn' : 'muted'}>{__uiText("View")}</ArrowLink>
                  </>
                }
              />
            </StatGrid>
          </div>

          <div>
            <SectionTitle note={__uiText("ข้อมูลจริงจากแพลตฟอร์ม")}>{__uiText("ข้อมูลการทำงาน")}</SectionTitle>
            <StatGrid cols={5}>
              <StatTile
                to="/integrations"
                icon="hub"
                label={__uiText("Integrations")}
                value={fmt.num(s.integrations)}
                foot={
                  <span className={`inline-flex items-center gap-1 ${d.integrationsActive === s.integrations ? 'text-ok' : 'text-warn'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {d.integrationsActive === s.integrations ? __uiText("All connected") : __uiText("{0} of {1} active", {"0": d.integrationsActive, "1": s.integrations})}
                  </span>
                }
              />
              <StatTile
                to="/sync-jobs"
                icon="sync"
                label={__uiText("Sync jobs (24h)")}
                value={fmt.num(d.syncJobs24h.total)}
                foot={__uiText("{0} success rate",{'0':pct(d.syncJobs24h.completed, d.syncJobs24h.total)})}
              />
              <StatTile to="/customers" icon="group" label={__uiText("Customers")} value={fmt.num(s.customers)} foot={__uiText("+{0} this week",{'0':fmt.num(d.customersNew7d)})} />
              <StatTile to="/products" icon="inventory_2" label={__uiText("Products")} value={fmt.num(s.products)} foot={__uiText(d.warehouses === 1 ? 'Across {0} warehouse' : 'Across {0} warehouses', { '0': fmt.num(d.warehouses) })} />
              <StatTile
                to="/inventory"
                icon="stacks"
                label={__uiText("Inventory levels")}
                value={fmt.num(s.inventoryLevels)}
                foot={d.inventoryUpdatedAt ? __uiText("Updated {0}",{'0':fmt.ago(d.inventoryUpdatedAt)}) : __uiText("No stock yet")}
              />
            </StatGrid>
          </div>
        </>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4">
        <Panel className="overflow-hidden">
          <PanelHead title={__uiText("Recent sync jobs")} actions={<ArrowLink to="/sync-jobs">{__uiText("View all jobs")}</ArrowLink>} />
          <ErrorText error={jobs.error} onRetry={jobs.reload} />
          <Table>
            <THead>
              <TH>{__uiText("Job")}</TH>
              <TH>{__uiText("Platform")}</TH>
              <TH>{__uiText("Status")}</TH>
              <TH>{__uiText("Started")}</TH>
              <TH right>{__uiText("Duration")}</TH>
            </THead>
            <TBody>
              {recentJobs.map((j) => (
                <TR key={j.id}>
                  <TD>
                    <span className="inline-flex items-center gap-2 font-medium">
                      <Icon name="sync_alt" size={16} className="text-outline" />
                      {operationLabel(j.operation)}
                    </span>
                  </TD>
                  <TD kind="muted">{integrationName.get(j.integrationId) ?? j.integrationId.slice(0, 8)}</TD>
                  <TD><StatusChip status={j.status} /></TD>
                  <TD kind="time">{new Date(j.createdAt).toLocaleTimeString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</TD>
                  <TD kind="num">{duration(j)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {jobs.loading && !jobs.data ? <Loading /> : !jobs.error && jobs.data && recentJobs.length === 0 && <Empty icon="sync">{__uiText("No sync jobs yet")}</Empty>}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHead
            title={
              <span className="inline-flex items-center gap-2">
                {__uiText("Recent webhook failures")}{failures.length > 0 && <span className="w-2 h-2 rounded-full bg-danger" />}
              </span>
            }
            actions={<ArrowLink to="/erp/webhook-dead-letter">{__uiText("Open dead letter")}</ArrowLink>}
          />
          <ErrorText error={deliveries.error} onRetry={deliveries.reload} />
          {deliveries.loading && !deliveries.data ? (
            <Loading />
          ) : !deliveries.error && deliveries.data && failures.length === 0 ? (
            <Empty icon="task_alt">{__uiText("No failed deliveries")}</Empty>
          ) : (
            <ul className="divide-y divide-secondary-container/70">
              {failures.map((f) => (
                <li key={f.id} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Chip className="font-mono">{f.eventType}</Chip>
                    <span className="text-[11px] text-on-surface-variant whitespace-nowrap">
                      {host(f.targetUrl)} <span className="text-outline font-mono">{fmt.ago(f.createdAt)}</span>
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-on-surface-variant truncate" title={f.error ?? undefined}>
                    {f.statusCode ? __uiText("HTTP {0} ", {"0": f.statusCode}) : ''}{f.error ?? __uiText("Delivery failed")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Page>
  );
}
