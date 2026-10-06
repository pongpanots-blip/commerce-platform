// Stitch screen: docs/design/stitch/admin-overview.html
import {
  ArrowLink, Button, Chip, Empty, ErrorText, Icon, Loading, Page, PageHeader, Panel, PanelHead, SectionTitle,
  StatGrid, StatTile, StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { AdminStats, Integration, SyncJob, api, webhookApi } from '../../lib/api';
import { useAsync } from '../hooks';

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
  const stats = useAsync(() => api.get<AdminStats>('/admin/stats'));
  const jobs = useAsync(() => api.get<SyncJob[]>('/sync-jobs'));
  const integrations = useAsync(() => api.get<Integration[]>('/integrations'));
  const deliveries = useAsync(() => webhookApi.deliveries());

  const s = stats.data;
  const d = s?.details;
  const integrationName = new Map((integrations.data ?? []).map((i) => [i.id, i.name]));
  const recentJobs = (jobs.data ?? []).slice(0, 6);
  const failures = (deliveries.data ?? []).filter((x) => x.status === 'failed').slice(0, 5);
  const updatedAt = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  function reloadAll() {
    stats.reload();
    jobs.reload();
    integrations.reload();
    deliveries.reload();
  }

  return (
    <Page>
      <PageHeader
        title="Overview"
        subtitle="Commerce Platform health at a glance."
        actions={
          <>
            <span className="flex items-center gap-1.5 text-xs text-outline">
              <Icon name="schedule" size={14} />
              Last updated <span className="tabular-nums">{updatedAt}</span>
            </span>
            <Button icon="refresh" onClick={reloadAll}>Refresh</Button>
          </>
        }
      />
      <div className="border-t border-secondary-container" />

      <ErrorText error={stats.error} />
      {stats.loading && !s ? (
        <Loading />
      ) : s && d ? (
        <>
          <div>
            <SectionTitle note="Active alerts requiring operator action">Needs attention</SectionTitle>
            <StatGrid cols={3}>
              <StatTile
                accent
                tone={s.webhooksPending ? 'warn' : 'ok'}
                icon={s.webhooksPending ? 'hourglass_top' : 'check_circle'}
                label="Webhooks pending"
                value={fmt.num(s.webhooksPending)}
                foot={
                  <>
                    <span>{d.oldestPendingWebhookAt ? `Oldest waiting: ${fmt.ago(d.oldestPendingWebhookAt)}` : 'Queue is empty'}</span>
                    <ArrowLink to="/webhooks" tone={s.webhooksPending ? 'warn' : 'muted'}>View</ArrowLink>
                  </>
                }
              />
              <StatTile
                accent
                tone={s.webhooksFailed ? 'danger' : 'ok'}
                icon={s.webhooksFailed ? 'error' : 'check_circle'}
                label="Inbound webhooks failed"
                value={fmt.num(s.webhooksFailed)}
                foot={
                  <>
                    <span className={s.webhooksFailed ? 'text-[#c2333f]' : 'text-[#157347]'}>{s.webhooksFailed ? 'Needs replay or fix' : 'No failures'}</span>
                    <ArrowLink to="/webhooks" tone={s.webhooksFailed ? 'danger' : 'muted'}>View</ArrowLink>
                  </>
                }
              />
              <StatTile
                accent
                tone={s.outboxBacklog ? 'warn' : 'ok'}
                icon={s.outboxBacklog ? 'outbox' : 'check_circle'}
                label="Outbox backlog"
                value={fmt.num(s.outboxBacklog)}
                foot={
                  <>
                    <span className={s.outboxBacklog ? undefined : 'text-[#157347]'}>{s.outboxBacklog ? 'Events waiting to publish' : 'All channels normalized'}</span>
                    <ArrowLink to="/subscriptions" tone={s.outboxBacklog ? 'warn' : 'muted'}>View</ArrowLink>
                  </>
                }
              />
            </StatGrid>
          </div>

          <div>
            <SectionTitle>Data</SectionTitle>
            <StatGrid cols={5}>
              <StatTile
                to="/integrations"
                icon="hub"
                label="Integrations"
                value={fmt.num(s.integrations)}
                foot={
                  <span className={`inline-flex items-center gap-1 ${d.integrationsActive === s.integrations ? 'text-[#157347]' : 'text-[#b08900]'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {d.integrationsActive === s.integrations ? 'All connected' : `${d.integrationsActive} of ${s.integrations} active`}
                  </span>
                }
              />
              <StatTile
                to="/sync-jobs"
                icon="sync"
                label="Sync jobs (24h)"
                value={fmt.num(d.syncJobs24h.total)}
                foot={`${pct(d.syncJobs24h.completed, d.syncJobs24h.total)} success rate`}
              />
              <StatTile to="/customers" icon="group" label="Customers" value={fmt.num(s.customers)} foot={`+${fmt.num(d.customersNew7d)} this week`} />
              <StatTile to="/products" icon="inventory_2" label="Products" value={fmt.num(s.products)} foot={`Across ${fmt.num(d.warehouses)} warehouse${d.warehouses === 1 ? '' : 's'}`} />
              <StatTile
                to="/inventory"
                icon="stacks"
                label="Inventory levels"
                value={fmt.num(s.inventoryLevels)}
                foot={d.inventoryUpdatedAt ? `Updated ${fmt.ago(d.inventoryUpdatedAt)}` : 'No stock yet'}
              />
            </StatGrid>
          </div>
        </>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4">
        <Panel className="overflow-hidden">
          <PanelHead title="Recent sync jobs" badge={<Chip tone="muted">Live Feed</Chip>} actions={<ArrowLink to="/sync-jobs">View all jobs</ArrowLink>} />
          <ErrorText error={jobs.error} />
          <Table>
            <THead>
              <TH>Job</TH>
              <TH>Platform</TH>
              <TH>Status</TH>
              <TH>Started</TH>
              <TH right>Duration</TH>
            </THead>
            <TBody>
              {recentJobs.map((j) => (
                <TR key={j.id}>
                  <TD>
                    <span className="inline-flex items-center gap-2 font-medium">
                      <Icon name="sync_alt" size={16} className="text-outline" />
                      {j.operation}
                    </span>
                  </TD>
                  <TD kind="muted">{integrationName.get(j.integrationId) ?? j.integrationId.slice(0, 8)}</TD>
                  <TD><StatusChip status={j.status} /></TD>
                  <TD kind="time">{new Date(j.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</TD>
                  <TD kind="num">{duration(j)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {jobs.loading && !jobs.data ? <Loading /> : recentJobs.length === 0 && <Empty icon="sync">No sync jobs yet</Empty>}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHead
            title={
              <span className="inline-flex items-center gap-2">
                Recent webhook failures
                {failures.length > 0 && <span className="w-2 h-2 rounded-full bg-rose-500" />}
              </span>
            }
            actions={<ArrowLink to="/erp/webhook-dead-letter">Open dead letter</ArrowLink>}
          />
          <ErrorText error={deliveries.error} />
          {deliveries.loading && !deliveries.data ? (
            <Loading />
          ) : failures.length === 0 ? (
            <Empty icon="task_alt">No failed deliveries</Empty>
          ) : (
            <ul className="divide-y divide-secondary-container/70">
              {failures.map((f) => (
                <li key={f.id} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold text-[#c2333f] bg-[#fdecee] border border-[#f5c2c7] rounded px-1.5 py-0.5">{f.eventType}</span>
                    <span className="text-[11px] text-on-surface-variant whitespace-nowrap">
                      {host(f.targetUrl)} <span className="text-outline font-mono">{fmt.ago(f.createdAt)}</span>
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-on-surface-variant truncate" title={f.error ?? undefined}>
                    {f.statusCode ? `HTTP ${f.statusCode} ` : ''}{f.error ?? 'Delivery failed'}
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
