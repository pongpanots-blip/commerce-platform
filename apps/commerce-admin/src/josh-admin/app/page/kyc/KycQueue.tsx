// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { useMemo, useState } from 'react';
import { Table, TableColumn } from '@josh/shared-ui-web';
import AdminListHeader from '../../components/AdminListHeader';
import { useKycQueue } from './kyc-queue.hook';
import { KYC_DOCUMENT_TYPES, KycQueueEntry } from './kyc.types';
import { KycStatusBadge, customerTypeLabel } from './KycStatusBadge';
import KycDocumentModal from './KycDocumentModal';

// ui-copy-migration: only literal UI copy and notification templates
import { Alert, Button, Chip, Loading, Panel, Segmented, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type QueueTab = 'all' | 'pending' | 'approved' | 'rejected';

const TABS: { key: QueueTab; label: string }[] = [
  { key: 'all', get label(){return __uiText("ทั้งหมด");} },
  { key: 'pending', get label(){return __uiText("มีรายการรอตรวจสอบ");} },
  { key: 'approved', get label(){return __uiText("ยืนยันครบทุกเอกสาร");} },
  { key: 'rejected', get label(){return __uiText("มีรายการถูกปฏิเสธ");} },
];

function docTimestamps(entry: KycQueueEntry) {
  const submitted = KYC_DOCUMENT_TYPES.map((t) => entry.documents[t.key].submittedAt).filter(
    (v): v is string => !!v
  );
  const decided = KYC_DOCUMENT_TYPES.map((t) => entry.documents[t.key].decidedAt).filter(
    (v): v is string => !!v
  );
  const latest = (values: string[]) =>
    values.length ? values.reduce((a, b) => (a > b ? a : b)) : null;
  return { latestSubmitted: latest(submitted), latestDecided: latest(decided) };
}

function matchesTab(entry: KycQueueEntry, tab: QueueTab): boolean {
  const statuses = KYC_DOCUMENT_TYPES.map((t) => entry.documents[t.key].status);
  switch (tab) {
    case 'all':
      return true;
    // Filter semantics were not specified upstream — using the mockup's own
    // wording as the spec: "pending"/"rejected" tabs mean "at least one
    // document of the company is in that status", while "approved" means
    // the company's documents are ALL approved (matches the tab label
    // "ยืนยันครบทุกเอกสาร" = "confirmed, all documents").
    case 'pending':
      return statuses.some((s) => s === 'pending');
    case 'rejected':
      return statuses.some((s) => s === 'rejected');
    case 'approved':
      return statuses.every((s) => s === 'approved');
    default:
      return true;
  }
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), { dateStyle: 'medium', timeStyle: 'short' });
}

export default function KycQueue() {
  __useUiLocale();
  const { entries, loading, loadError } = useKycQueue();
  const [activeTab, setActiveTab] = useState<QueueTab>('all');
  const [selectedEntry, setSelectedEntry] = useState<KycQueueEntry | null>(null);

  const filteredEntries = useMemo(
    () => entries.filter((entry) => matchesTab(entry, activeTab)),
    [entries, activeTab]
  );

  const tabCounts = useMemo(
    () =>
      TABS.reduce<Record<QueueTab, number>>((acc, tab) => {
        acc[tab.key] = entries.filter((entry) => matchesTab(entry, tab.key)).length;
        return acc;
      }, {} as Record<QueueTab, number>),
    [entries]
  );

  const columns: TableColumn<KycQueueEntry>[] = [
    {
      key: 'companyName',
      label: __uiText("ร้านค้า"),
      render: (_value, row) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold text-on-surface">{row.companyName}</span>
          <Chip statusCode={row.customerType}>{customerTypeLabel(row.customerType)}</Chip>
        </div>
      ),
    },
    {
      key: 'documents',
      label: __uiText("สถานะเอกสารแต่ละประเภท"),
      render: (_value, row) => (
        <div className="flex flex-col gap-1.5">
          {KYC_DOCUMENT_TYPES.map((docType) => {
            const doc = row.documents[docType.key];
            return (
              <div key={docType.key} className="flex items-center gap-2">
                <span className="w-[78px] flex-none text-[11px] text-on-surface-variant">
                  {docType.thumbnailLabel}
                </span>
                <KycStatusBadge status={doc.status} />
                {doc.status === 'rejected' && doc.rejectionReason && (
                  <span
                    className="max-w-[220px] truncate text-[11px] text-on-surface-variant"
                    title={doc.rejectionReason}
                  >
                    {doc.rejectionReason}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ),
    },
    {
      key: 'latestSubmitted',
      label: __uiText("ส่งล่าสุด"),
      render: (_value, row) => {
        const { latestSubmitted } = docTimestamps(row);
        return <span className="tabular-nums">{formatDate(latestSubmitted) ?? '—'}</span>;
      },
    },
    {
      key: 'latestDecided',
      label: __uiText("ตัดสินล่าสุด"),
      render: (_value, row) => {
        const { latestDecided } = docTimestamps(row);
        return <span className="tabular-nums">{formatDate(latestDecided) ?? '—'}</span>;
      },
    },
    {
      key: 'actions',
      label: __uiText("เอกสาร"),
      render: (_value, row) => (
        <Button size="sm" icon="description" onClick={() => setSelectedEntry(row)}>
          {__uiText("ดูเอกสาร")}</Button>
      ),
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-4">
      <AdminListHeader title={__uiText("ตรวจสอบตัวตนลูกค้า")} subtitle={__uiText("เอกสารยืนยันตัวตนที่ลูกค้าส่งมา แยกตามสถานะการตรวจ")} />

      <Alert tone="info">
        {__uiText("หน้านี้ใช้ดูเอกสารอย่างเดียว การอนุมัติหรือปฏิเสธทำในระบบบริการลูกค้า (CS-CRM)")}</Alert>

      <div className="overflow-x-auto">
        <Segmented
          value={activeTab}
          onChange={setActiveTab}
          options={TABS.map((tab) => ({ value: tab.key, label: tab.label, count: tabCounts[tab.key] ?? 0 }))}
        />
      </div>

      {loadError && (
        <Alert tone="danger">{(typeof loadError === 'string' ? __uiText(loadError) : loadError)}</Alert>
      )}

      <Panel className="overflow-hidden">
        {loading ? (
          <Loading variant="table">{__uiText("กำลังโหลดรายการ...")}</Loading>
        ) : (
          <Table
            columns={columns}
            data={filteredEntries}
            idKey="id"
            emptyTitle={__uiText("ไม่พบรายการในหมวดนี้")}
            emptyDescription={activeTab !== 'all' ? __uiText("ลองเลือกแท็บทั้งหมด") : undefined}
          />
        )}
      </Panel>

      {selectedEntry && (
        <KycDocumentModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
      )}
    </div>
  );
}
