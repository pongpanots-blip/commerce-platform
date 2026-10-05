import { useMemo, useState } from 'react';
import { Table, TableColumn } from '@josh/shared-ui-web';
import AdminListHeader from '../../components/AdminListHeader';
import { useKycQueue } from './kyc-queue.hook';
import { KYC_DOCUMENT_TYPES, KycQueueEntry } from './kyc.types';
import { KycStatusBadge } from './KycStatusBadge';
import KycDocumentModal from './KycDocumentModal';

type QueueTab = 'all' | 'pending' | 'approved' | 'rejected';

const TABS: { key: QueueTab; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'pending', label: 'มีรายการรอตรวจสอบ' },
  { key: 'approved', label: 'ยืนยันครบทุกเอกสาร' },
  { key: 'rejected', label: 'มีรายการถูกปฏิเสธ' },
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
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function KycQueue() {
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
      label: 'ร้านค้า',
      render: (_value, row) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-800">{row.companyName}</span>
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
              row.customerType === 'B2B' ? 'bg-cyan-50 text-cyan-700' : 'bg-indigo-50 text-indigo-700'
            }`}
          >
            {row.customerType}
          </span>
        </div>
      ),
    },
    {
      key: 'documents',
      label: 'สถานะเอกสารแต่ละประเภท',
      render: (_value, row) => (
        <div className="flex flex-col gap-1.5">
          {KYC_DOCUMENT_TYPES.map((docType) => {
            const doc = row.documents[docType.key];
            return (
              <div key={docType.key} className="flex items-center gap-2">
                <span className="w-[78px] flex-none text-[11px] text-gray-400">
                  {docType.thumbnailLabel}
                </span>
                <KycStatusBadge status={doc.status} />
                {doc.status === 'rejected' && doc.rejectionReason && (
                  <span
                    className="max-w-[220px] truncate text-[11px] text-gray-400"
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
      label: 'ส่งล่าสุด',
      render: (_value, row) => {
        const { latestSubmitted } = docTimestamps(row);
        return formatDate(latestSubmitted) ?? <span className="text-gray-300">—</span>;
      },
    },
    {
      key: 'latestDecided',
      label: 'ตัดสินล่าสุด',
      render: (_value, row) => {
        const { latestDecided } = docTimestamps(row);
        return formatDate(latestDecided) ?? <span className="text-gray-300">—</span>;
      },
    },
    {
      key: 'actions',
      label: 'เอกสาร',
      render: (_value, row) => (
        <button
          type="button"
          className="text-xs font-semibold text-primary hover:underline"
          onClick={() => setSelectedEntry(row)}
        >
          ดูเอกสาร
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 p-4">
      <AdminListHeader title="KYC — ยืนยันตัวตน" subtitle="คิวคำขอยืนยันตัวตนของลูกค้าทั้งหมด" />

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        หน้านี้เป็น <strong>read-only ในเวอร์ชันแรก</strong> — การอนุมัติ/ปฏิเสธคำขอจริงทำผ่านระบบ CS-CRM
        แยกต่างหาก แถวในตารางจึงไม่มีปุ่ม action นอกจาก &quot;ดูเอกสาร&quot;
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`px-3.5 py-2 text-sm ${
              activeTab === tab.key
                ? 'border-b-2 border-primary font-semibold text-primary'
                : 'border-b-2 border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label} <span className="text-gray-400">({tabCounts[tab.key] ?? 0})</span>
          </button>
        ))}
      </div>

      {loadError && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{loadError}</div>
      )}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          กำลังโหลดคิว KYC...
        </div>
      ) : !loadError && filteredEntries.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          ไม่พบรายการในหมวดนี้
        </div>
      ) : (
        <Table columns={columns} data={filteredEntries} idKey="id" />
      )}

      {selectedEntry && (
        <KycDocumentModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
      )}
    </div>
  );
}
