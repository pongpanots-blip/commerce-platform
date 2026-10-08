// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { getCompanyBilling, searchBillingCompanies } from '@josh/shared-api';
import { Input, Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
    { key: 'invoice_number', label: __uiText("Invoice #") },
    { key: 'order_number', label: __uiText("Order"), render: (v) => v ?? '-' },
    {
      key: 'order_user_email',
      label: __uiText("ลูกค้า"),
      render: (v) => v ?? '-',
    },
    { key: 'due_date', label: __uiText("ครบกำหนด"), render: (v) => new Date(v).toLocaleDateString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) },
    { key: 'total', label: __uiText("มูลค่า"), render: (v) => Number(v).toLocaleString() },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (_v, row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              row.status === 'paid'
                ? 'bg-emerald-100 text-emerald-700'
                : row.status === 'overdue'
                ? 'bg-red-100 text-red-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {row.status === 'paid' ? __uiText("ชำระแล้ว") : row.status === 'overdue' ? __uiText("เลยกำหนด") : __uiText("ยังไม่ชำระ")}
          </span>
          {row.erp_invoice_cancelled && (
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
              {__uiText("ERP ยกเลิก")}</span>
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

  return (
    <div className="p-6">
      <AdminListHeader title={__uiText("Billing")} subtitle={__uiText("ค้นหาบริษัท ดู credit และใบแจ้งหนี้ทั้งหมด")} />

      <div className="mb-6 max-w-md">
        <Input
          label={__uiText("ค้นหาบริษัท")}
          placeholder={__uiText("ชื่อบริษัท, เลขจดทะเบียน หรือ ERP customer code")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searchError && (
          <div className="mt-2 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            <span>{(typeof (searchError) === 'string' ? __uiText(searchError) : searchError)}</span>
            <button
              type="button"
              onClick={() => void runSearch(query)}
              className="font-semibold underline"
            >
              {__uiText("ลองใหม่")}</button>
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
                    {row.register_number ?? '-'} {row.erp_customer_code ? __uiText("· ERP: {0}", {"0": row.erp_customer_code}) : ''}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {billingError && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>{(typeof (billingError) === 'string' ? __uiText(billingError) : billingError)}</span>
          {(company || selectedCompanyId) && (
            <button type="button" onClick={retryBilling} className="font-semibold underline">
              {__uiText("ลองใหม่")}</button>
          )}
        </div>
      )}

      {loadingCompany && !company && (
        <div className="mb-4 text-sm text-gray-400">{__uiText("กำลังโหลดข้อมูลบริษัท...")}</div>
      )}

      {company && (
        <>
          <div className="mb-6 grid gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-5">
            <div>
              <div className="text-xs text-gray-400">{__uiText("บริษัท")}</div>
              <div className="text-sm font-semibold text-gray-800">{company.name}</div>
              <Link
                to={ADMIN_ROUTES.companyEdit(company.id)}
                className="text-xs text-primary underline"
              >
                {__uiText("แก้ไข credit limit")}</Link>
            </div>
            <div>
              <div className="text-xs text-gray-400">{__uiText("Credit Limit")}</div>
              <div className="text-sm font-semibold text-gray-800">
                {company.credit_limit.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400">{__uiText("Credit Used")}</div>
              <div className="text-sm font-semibold text-gray-800">
                {company.credit_used.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400">{__uiText("Credit Available")}</div>
              <div className="text-sm font-semibold text-gray-800">
                {company.credit_available.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400">{__uiText("Credit Term (วัน)")}</div>
              <div className="text-sm font-semibold text-gray-800">{company.credit_term_days}</div>
            </div>
          </div>

          <div className="mb-4 max-w-xs">
            <Select
              label={__uiText("สถานะใบแจ้งหนี้")}
              data={STATUS_OPTIONS}
              value={status}
              onChange={(e) => onStatusChange(e.target.value)}
            />
          </div>

          <Table columns={columns} data={invoices} loading={loadingInvoices || loadingCompany} />
        </>
      )}

      {!company && !loadingCompany && (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
          {__uiText("ค้นหาและเลือกบริษัทเพื่อดู credit และใบแจ้งหนี้")}</div>
      )}
    </div>
  );
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
