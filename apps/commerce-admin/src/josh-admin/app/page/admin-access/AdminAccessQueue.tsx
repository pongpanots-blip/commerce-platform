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
  return date.toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function AdminAccessQueue() {
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
    if (!window.confirm(`ยืนยันอนุมัติ ${request.email} ด้วย role ${role}?`)) return;

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
    const reason = window.prompt(`เหตุผลที่ปฏิเสธ ${request.email} (ไม่บังคับ)`) ?? undefined;
    if (reason === undefined) return;
    if (!window.confirm(`ยืนยันปฏิเสธคำขอของ ${request.email}?`)) return;

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
        label: 'ชื่อ',
        render: (_value, row) => `${row.first_name} ${row.last_name}`.trim() || '-',
      },
      { key: 'email', label: 'อีเมล' },
      {
        key: 'mobile_phone',
        label: 'เบอร์โทร',
        render: (value: string | null) => value || '-',
      },
      {
        key: 'created_at',
        label: 'วันที่ส่งคำขอ',
        render: (value: string) => formatDateTime(value),
      },
      {
        key: 'actions',
        label: 'จัดการ',
        render: (_value, row) => {
          const busy = actionId === row.id;
          const selectedRole = selectedRoles[row.id] ?? 'admin';

          return (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`admin-access-role-${row.id}`} className="text-xs text-gray-500">
                สิทธิ์ (Role)
              </label>
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
                      {role}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="button"
                className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => void handleApprove(row)}
              >
                อนุมัติ
              </button>
              <button
                type="button"
                className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 disabled:opacity-50"
                disabled={busy}
                onClick={() => void handleReject(row)}
              >
                ปฏิเสธ
              </button>
            </div>
          );
        },
      },
    ],
    [actionId, selectedRoles],
  );

  if (adminRole !== 'platform_admin') {
    return (
      <div className="p-6">
        <AdminListHeader
          title="คำขอ Admin"
          subtitle="เฉพาะ platform_admin เท่านั้นที่เข้าถึงหน้านี้ได้"
        />
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          คุณไม่มีสิทธิ์เข้าถึงหน้าคำขอ Admin
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      <AdminListHeader
        title="คำขอ Admin"
        subtitle="ตรวจสอบคำขอสมัครใช้งาน web-admin ที่รออนุมัติ"
      />

      {errorMessage ? (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          กำลังโหลดคำขอ Admin...
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          ไม่มีคำขอ Admin ที่รออนุมัติ
        </div>
      ) : (
        <Table columns={columns} data={requests} idKey="id" />
      )}
    </div>
  );
}
