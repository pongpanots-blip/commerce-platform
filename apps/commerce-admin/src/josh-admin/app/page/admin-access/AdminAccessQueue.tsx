// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-render-cache-locale: refresh memoized UI labels when the language changes
import { getUiLocale as __getUiLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import {
  approveAdminAccessRequest,
  listAdminAccessRequests,
  rejectAdminAccessRequest,
  type AdminAccessRequestItem,
} from '@josh/shared-api';
import { Select, Table, type TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import { getAdminRole } from '../../lib/admin-auth';

// Duplicated from apps/backend/src/app/admin-access/admin-access.constants.ts
// so the UI cannot offer customer-only or seed-only roles in the approve flow.
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale, Alert, Button } from "@cp/ui";
const ASSIGNABLE_ADMIN_ROLES = [
  'platform_admin',
  'cs',
  'marketing',
  'merchandising',
  'dev',
  'sale',
  'sales',
  'manager',
  'admin',
] as const;

type AssignableAdminRole = (typeof ASSIGNABLE_ADMIN_ROLES)[number];

// Display only: the approve request still sends the raw role code.
const ROLE_LABEL: Record<AssignableAdminRole, string> = {
  platform_admin: 'ผู้ดูแลระบบสูงสุด',
  cs: 'ฝ่ายบริการลูกค้า',
  marketing: 'ฝ่ายการตลาด',
  merchandising: 'ฝ่ายจัดการสินค้า',
  dev: 'ทีมพัฒนาระบบ',
  sale: 'ฝ่ายขาย (sale)',
  sales: 'ฝ่ายขาย (sales)',
  manager: 'ผู้จัดการ',
  admin: 'ผู้ดูแลระบบ',
};

type AdminAccessListResponse = {
  data?: AdminAccessRequestItem[];
};

function getErrorMessage(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response &&
    typeof error.response.data === 'object' &&
    error.response.data !== null &&
    'message' in error.response.data &&
    typeof error.response.data.message === 'string'
  ) {
    return error.response.data.message;
  }

  return 'เกิดข้อผิดพลาดในการโหลดคำขอ กรุณาลองใหม่อีกครั้ง';
}

function normalizeRequests(response: AdminAccessRequestItem[] | AdminAccessListResponse) {
  if (Array.isArray(response)) return response;
  return Array.isArray(response.data) ? response.data : [];
}

function formatDateTime(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function AdminAccessQueue() {
  __useUiLocale();
  const adminRole = getAdminRole();
  const [requests, setRequests] = useState<AdminAccessRequestItem[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, AssignableAdminRole>>({});
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const loadRequests = useCallback(async () => {
    if (adminRole !== 'platform_admin') {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setErrorMessage('');
      const response = await listAdminAccessRequests('pending');
      setRequests(normalizeRequests(response));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [adminRole]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const handleApprove = async (request: AdminAccessRequestItem) => {
    const role = selectedRoles[request.id] ?? 'admin';
    if (!window.confirm(__uiText("ยืนยันอนุมัติ {0} ให้ได้สิทธิ์ {1}?", {"0": request.email, "1": __uiText(ROLE_LABEL[role])}))) return;

    try {
      setActionId(request.id);
      setErrorMessage('');
      await approveAdminAccessRequest(request.id, role);
      await loadRequests();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (request: AdminAccessRequestItem) => {
    const reason = window.prompt(__uiText("เหตุผลที่ปฏิเสธ {0} (ไม่บังคับ)", {"0": request.email})) ?? undefined;
    if (reason === undefined) return;
    if (!window.confirm(__uiText("ยืนยันปฏิเสธคำขอของ {0}?", {"0": request.email}))) return;

    try {
      setActionId(request.id);
      setErrorMessage('');
      await rejectAdminAccessRequest(request.id, reason.trim() || undefined);
      await loadRequests();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setActionId(null);
    }
  };

  const columns = useMemo<TableColumn<AdminAccessRequestItem>[]>(
    () => [
      {
        key: 'name',
        label: __uiText("ชื่อ"),
        render: (_value, row) => `${row.first_name} ${row.last_name}`.trim() || '-',
      },
      { key: 'email', label: __uiText("อีเมล") },
      {
        key: 'mobile_phone',
        label: __uiText("เบอร์โทร"),
        render: (value: string | null) => value || '-',
      },
      {
        key: 'created_at',
        label: __uiText("วันที่ส่งคำขอ"),
        render: (value: string) => formatDateTime(value),
      },
      {
        key: 'actions',
        label: __uiText("จัดการ"),
        render: (_value, row) => {
          const busy = actionId === row.id;
          const selectedRole = selectedRoles[row.id] ?? 'admin';

          return (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`admin-access-role-${row.id}`} className="text-xs text-gray-500">
                {__uiText("สิทธิ์")}</label>
              <div className="w-40">
                <Select
                  id={`admin-access-role-${row.id}`}
                  value={selectedRole}
                  disabled={busy}
                  onChange={(event) =>
                    setSelectedRoles((current) => ({
                      ...current,
                      [row.id]: event.target.value as AssignableAdminRole,
                    }))
                  }
                >
                  {ASSIGNABLE_ADMIN_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {__uiText(ROLE_LABEL[role])}
                    </option>
                  ))}
                </Select>
              </div>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void handleApprove(row)}>
                {__uiText("อนุมัติ")}</Button>
              <Button size="sm" variant="danger-ghost" disabled={busy} onClick={() => void handleReject(row)}>
                {__uiText("ปฏิเสธ")}</Button>
            </div>
          );
        },
      },
    ],
    [actionId, selectedRoles, __getUiLocale()],
  );

  if (adminRole !== 'platform_admin') {
    return (
      <div className="cp-management-page">
        <AdminListHeader
          title={__uiText("คำขอใช้งานหลังร้าน")}
          subtitle={__uiText("คำขอใช้งานหลังร้านของร้านค้าที่รออนุมัติ")}
        />
        <Alert tone="danger">
          {__uiText("หน้านี้เปิดได้เฉพาะผู้ดูแลระบบสูงสุด หากต้องการใช้งาน โปรดติดต่อผู้ดูแลระบบ")}</Alert>
      </div>
    );
  }

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <AdminListHeader
        title={__uiText("คำขอใช้งานหลังร้าน")}
        subtitle={__uiText("คำขอใช้งานหลังร้านของร้านค้าที่รออนุมัติ")}
      />

      {errorMessage ? (
        <Alert tone="danger">{__uiText(errorMessage)}</Alert>
      ) : null}

      <Table
        columns={columns}
        data={requests}
        idKey="id"
        loading={loading}
        emptyTitle="ไม่มีคำขอที่รออนุมัติ"
        emptyDescription={__uiText("เมื่อมีคนขอใช้งานหลังร้าน คำขอจะแสดงที่นี่ให้อนุมัติหรือปฏิเสธ")}
      />
    </div>
  );
}
