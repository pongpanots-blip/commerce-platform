// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { getCompanyBilling, getOverdueInvoices, searchBillingCompanies } from '@josh/shared-api';
import { Input, Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { Alert, Button, Chip, KeyValueGrid, Panel, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type CompanySearchRow = {
  id: string;
  name: string;
  register_number: string | null;
  erp_customer_code: string | null;
  credit_limit: number;
  credit_used: number;
};

type CompanySummary = {
  id: string;
  name: string;
  credit_limit: number;
  credit_used: number;
  credit_available: number;
  credit_term_days: number;
  erp_customer_code: string | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  order_number: string | null;
  due_date: string;
  total: number;
  status: 'unpaid' | 'paid' | 'overdue';
  erp_invoice_cancelled?: boolean;
  order_user_email?: string | null;
  download_url: string | null;
};

type OverdueRow = {
  invoice_id: string;
  invoice_number: string;
  due_date: string;
  order?: { order_number?: string; user?: { email?: string } };
};

const STATUS_OPTIONS = [
  { value: '', get label(){return __uiText("ทุกสถานะ");} },
  { value: 'unpaid', get label(){return __uiText("ยังไม่ชำระ");} },
  { value: 'overdue', get label(){return __uiText("เลยกำหนด");} },
  { value: 'paid', get label(){return __uiText("ชำระแล้ว");} },
];

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const message = (err as { response?: { data?: { message?: string } } }).response?.data
      ?.message;
    if (message) return message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function Billing() {
  __useUiLocale();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CompanySearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanySummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [status, setStatus] = useState('');
  const [loadingCompany, setLoadingCompany] = useState(false);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [billingError, setBillingError] = useState('');
  // Overdue invoices of every company, shown until a company is picked (was its own page, /j/invoices).
  const [overdue, setOverdue] = useState<OverdueRow[]>([]);
  const [loadingOverdue, setLoadingOverdue] = useState(true);
  const [overdueError, setOverdueError] = useState('');

  useEffect(() => {
    void getOverdueInvoices()
      .then((res: any) => setOverdue(res?.data?.data ?? []))
      .catch((err: unknown) => setOverdueError(getErrorMessage(err, 'โหลดใบแจ้งหนี้ไม่สำเร็จ')))
      .finally(() => setLoadingOverdue(false));
  }, []);

  const runSearch = useCallback(async (searchQuery: string) => {
    setSearching(true);
    setSearchError('');
    try {
      const res = await searchBillingCompanies(searchQuery);
      setResults(res?.data?.data ?? []);
    } catch (err: unknown) {
      setResults([]);
      setSearchError(getErrorMessage(err, 'ค้นหาบริษัทไม่สำเร็จ'));
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void runSearch(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const loadCompany = useCallback(
    async (companyId: string, status_?: string, invoicesOnly = false) => {
      if (invoicesOnly) {
        setLoadingInvoices(true);
      } else {
        setLoadingCompany(true);
      }
      setBillingError('');
      try {
        const res = await getCompanyBilling(companyId, status_ || undefined);
        const data = res?.data?.data ?? {};
        setCompany(data.company ?? null);
        setInvoices(data.invoices ?? []);
      } catch (err: unknown) {
        if (!invoicesOnly) {
          setCompany(null);
          setInvoices([]);
        }
        setBillingError(getErrorMessage(err, 'โหลดข้อมูล billing ไม่สำเร็จ'));
      } finally {
        if (invoicesOnly) {
          setLoadingInvoices(false);
        } else {
          setLoadingCompany(false);
        }
      }
    },
    [],
  );

  const selectCompany = (row: CompanySearchRow) => {
    setSelectedCompanyId(row.id);
    void loadCompany(row.id, status);
  };

  const onStatusChange = (value: string) => {
    setStatus(value);
    if (company) void loadCompany(company.id, value, true);
  };

  const retryBilling = () => {
    const companyId = company?.id ?? selectedCompanyId;
    if (companyId) void loadCompany(companyId, status, !!company);
  };

  const columns: TableColumn<InvoiceRow>[] = [
    { key: 'invoice_number', label: __uiText("เลขที่ใบแจ้งหนี้"), render: (v) => <span className="font-mono">{v}</span> },
    { key: 'order_number', label: __uiText("เลขที่ออเดอร์"), render: (v) => (v ? <span className="font-mono">{v}</span> : '-') },
    {
      key: 'order_user_email',
      label: __uiText("ลูกค้า"),
      render: (v) => v ?? '-',
    },
    { key: 'due_date', label: __uiText("ครบกำหนด"), render: (v) => new Date(v).toLocaleDateString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) },
    { key: 'total', label: __uiText("มูลค่า"), align: 'right', render: (v) => <span className="tabular-nums">{__uiText("฿")}{Number(v).toLocaleString()}</span> },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (_v, row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip
            tone={row.status === 'paid' ? 'ok' : row.status === 'overdue' ? 'danger' : 'warn'}
            statusCode={row.status}
            dot
          >
            {row.status === 'paid' ? __uiText("ชำระแล้ว") : row.status === 'overdue' ? __uiText("เลยกำหนด") : __uiText("ยังไม่ชำระ")}
          </Chip>
          {row.erp_invoice_cancelled && (
            <Chip tone="muted">{__uiText("ยกเลิกในระบบหลัก (ERP)")}</Chip>
          )}
        </div>
      ),
    },
    {
      key: 'download_url',
      label: __uiText("เอกสาร"),
      render: (v) =>
        v ? (
          <a href={v} target="_blank" rel="noreferrer" className="text-primary underline">
            {__uiText("ดาวน์โหลด")}</a>
        ) : (
          '-'
        ),
    },
  ];

  const overdueColumns: TableColumn<OverdueRow>[] = [
    { key: 'invoice_number', label: __uiText("เลขที่ใบแจ้งหนี้"), render: (v) => <span className="font-mono">{v}</span> },
    { key: 'order', label: __uiText("เลขที่ออเดอร์"), render: (_v, row) => (row.order?.order_number ? <span className="font-mono">{row.order.order_number}</span> : '-') },
    { key: 'order', label: __uiText("ลูกค้า"), render: (_v, row) => row.order?.user?.email ?? '-' },
    { key: 'due_date', label: __uiText("ครบกำหนด"), render: (v) => (v ? new Date(v).toLocaleDateString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) : '-') },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-4">
      <AdminListHeader title={__uiText("วางบิล")} subtitle={__uiText("ค้นหาบริษัท ดูเครดิตและใบแจ้งหนี้ หรือดูใบแจ้งหนี้ค้างชำระของทุกบริษัท")} />

      <div className="max-w-md">
        <Input
          label={__uiText("ค้นหาบริษัท")}
          placeholder={__uiText("ชื่อบริษัท เลขจดทะเบียน หรือรหัสลูกค้าในระบบหลัก (ERP)")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searchError && (
          <div className="mt-2">
            <Alert tone="danger" actions={<Button size="sm" onClick={() => void runSearch(query)}>{__uiText("ลองใหม่")}</Button>}>
              {(typeof (searchError) === 'string' ? __uiText(searchError) : searchError)}
            </Alert>
          </div>
        )}
        {query.trim().length > 0 && (
          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            {searching ? (
              <div className="p-3 text-sm text-gray-400">{__uiText("กำลังค้นหา...")}</div>
            ) : results.length === 0 ? (
              <div className="p-3 text-sm text-gray-400">{__uiText("ไม่พบบริษัท")}</div>
            ) : (
              results.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => selectCompany(row)}
                  className={`block w-full border-b border-gray-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-gray-50 ${
                    company?.id === row.id ? 'bg-primary/5' : ''
                  }`}
                >
                  <div className="font-medium text-gray-800">{row.name}</div>
                  <div className="text-xs text-gray-400">
                    {row.register_number ?? '-'} {row.erp_customer_code ? __uiText("· รหัสลูกค้า (ERP): {0}", {"0": row.erp_customer_code}) : ''}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {billingError && (
        <Alert
          tone="danger"
          actions={(company || selectedCompanyId) ? <Button size="sm" onClick={retryBilling}>{__uiText("ลองใหม่")}</Button> : undefined}
        >
          {(typeof (billingError) === 'string' ? __uiText(billingError) : billingError)}
        </Alert>
      )}

      {loadingCompany && !company && (
        <div className="text-sm text-gray-400">{__uiText("กำลังโหลดข้อมูลบริษัท...")}</div>
      )}

      {company && (
        <>
          <Panel className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-on-surface">{company.name}</h2>
              <Link
                to={ADMIN_ROUTES.companyEdit(company.id)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {__uiText("แก้ไขวงเงินเครดิต")}</Link>
            </div>
            <KeyValueGrid
              items={[
                { label: "วงเงินเครดิต", value: <span className="tabular-nums">{company.credit_limit.toLocaleString()}</span> },
                { label: "ใช้ไปแล้ว", value: <span className="tabular-nums">{company.credit_used.toLocaleString()}</span> },
                { label: "เครดิตคงเหลือ", value: <span className="tabular-nums">{company.credit_available.toLocaleString()}</span> },
                { label: "เครดิตเทอม (วัน)", value: company.credit_term_days },
              ]}
            />
          </Panel>

          <div className="max-w-xs">
            <Select
              label={__uiText("สถานะใบแจ้งหนี้")}
              data={STATUS_OPTIONS}
              value={status}
              onChange={(e) => onStatusChange(e.target.value)}
            />
          </div>

          <Table
            columns={columns}
            data={invoices}
            loading={loadingInvoices || loadingCompany}
            emptyTitle={__uiText("บริษัทนี้ยังไม่มีใบแจ้งหนี้")}
            emptyDescription={__uiText("ลองเลือกสถานะอื่น")}
          />
        </>
      )}

      {!company && !loadingCompany && (
        <>
          <div className="text-sm text-gray-400">
            {__uiText("ค้นหาและเลือกบริษัทเพื่อดูเครดิตและใบแจ้งหนี้")}</div>
          <h2 className="text-[15px] font-semibold text-on-surface">{__uiText("ใบแจ้งหนี้เลยกำหนดชำระ")}</h2>
          {overdueError ? (
            <Alert tone="danger">{__uiText(overdueError)}</Alert>
          ) : (
            <Table
              columns={overdueColumns}
              data={overdue}
              loading={loadingOverdue}
              emptyTitle={__uiText("ไม่มีใบแจ้งหนี้เลยกำหนดชำระ")}
            />
          )}
        </>
      )}
    </div>
  );
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
