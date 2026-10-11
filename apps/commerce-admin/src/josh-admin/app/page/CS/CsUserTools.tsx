import {
  assignCsSalesRep,
  createCsBranch,
  getCsUserSearchHistory,
  mergeCsAccounts,
  updateCsBranch,
  updateCsUser,
} from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import { RevealPiiButton } from '../../components/RevealPiiButton';
import CsPlaceOrderPanel from './CsPlaceOrderPanel';

// ui-copy-migration: only literal UI copy and notification templates
import { Alert, Button, Panel, PanelHead, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Branch = {
  id: string;
  name: string;
  delivery_address: string | null;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  phone?: string | null;
  recipient_name?: string | null;
};

type Props = {
  userId: string;
  companyId?: string | null;
  email: string;
  firstName: string;
  lastName: string;
  mobilePhone: string | null;
  branches: Branch[];
  onUpdated?: () => void;
};

export function CsUserTools({
  userId,
  companyId,
  email,
  firstName,
  lastName,
  mobilePhone,
  branches,
  onUpdated,
}: Props) {
  __useUiLocale();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    mobile_phone: '',
  });
  const [searchHistory, setSearchHistory] = useState<
    Array<{ query_text: string; result_count: number; created_at: string }>
  >([]);
  const [salesUserId, setSalesUserId] = useState('');
  const [duplicateUserId, setDuplicateUserId] = useState('');
  const [branchForm, setBranchForm] = useState({
    name: '',
    delivery_address: '',
    delivery_latitude: '',
    delivery_longitude: '',
    phone: '',
    recipient_name: '',
  });
  const [branchEdits, setBranchEdits] = useState<
    Record<
      string,
      { address: string; lat: string; lng: string; phone: string; recipient: string }
    >
  >(() =>
    Object.fromEntries(
      branches.map((branch) => [
        branch.id,
        {
          address: branch.delivery_address ?? '',
          lat:
            branch.delivery_latitude != null
              ? String(branch.delivery_latitude)
              : '',
          lng:
            branch.delivery_longitude != null
              ? String(branch.delivery_longitude)
              : '',
          phone: branch.phone ?? '',
          recipient: branch.recipient_name ?? '',
        },
      ]),
    ),
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    setBranchEdits(
      Object.fromEntries(
        branches.map((branch) => [
          branch.id,
          {
            address: branch.delivery_address ?? '',
            lat:
              branch.delivery_latitude != null
                ? String(branch.delivery_latitude)
                : '',
            lng:
              branch.delivery_longitude != null
                ? String(branch.delivery_longitude)
                : '',
            phone: branch.phone ?? '',
            recipient: branch.recipient_name ?? '',
          },
        ]),
      ),
    );
  }, [branches]);

  useEffect(() => {
    void getCsUserSearchHistory(userId).then((res: any) => {
      setSearchHistory(res?.data?.data ?? []);
    });
  }, [userId]);

  const saveUser = async () => {
    // Only send fields the operator actually typed — the fields are seeded
    // blank (not from the masked props) so an untouched field must never be
    // sent as an empty string, which would blank the real record.
    const payload: {
      first_name?: string;
      last_name?: string;
      email?: string;
      mobile_phone?: string;
    } = {};
    if (form.first_name.trim()) payload.first_name = form.first_name.trim();
    if (form.last_name.trim()) payload.last_name = form.last_name.trim();
    if (form.email.trim()) payload.email = form.email.trim();
    if (form.mobile_phone.trim()) payload.mobile_phone = form.mobile_phone.trim();

    if (Object.keys(payload).length === 0) {
      setMessage('ไม่มีข้อมูลที่แก้ไข');
      return;
    }

    await updateCsUser(userId, payload);
    setForm({ first_name: '', last_name: '', email: '', mobile_phone: '' });
    setMessage('อัปเดตข้อมูลผู้ใช้แล้ว');
    onUpdated?.();
  };

  const saveBranch = async (branchId: string) => {
    const edit = branchEdits[branchId];
    if (!edit) return;
    await updateCsBranch(branchId, {
      delivery_address: edit.address,
      delivery_latitude: edit.lat ? Number(edit.lat) : undefined,
      delivery_longitude: edit.lng ? Number(edit.lng) : undefined,
      phone: edit.phone || undefined,
      recipient_name: edit.recipient || undefined,
    });
    setMessage('อัปเดตที่อยู่สาขาแล้ว');
    onUpdated?.();
  };

  const addBranch = async () => {
    await createCsBranch({
      user_id: userId,
      name: branchForm.name,
      delivery_address: branchForm.delivery_address,
      delivery_latitude: branchForm.delivery_latitude
        ? Number(branchForm.delivery_latitude)
        : undefined,
      delivery_longitude: branchForm.delivery_longitude
        ? Number(branchForm.delivery_longitude)
        : undefined,
      phone: branchForm.phone || undefined,
      recipient_name: branchForm.recipient_name || undefined,
    });
    setBranchForm({
      name: '',
      delivery_address: '',
      delivery_latitude: '',
      delivery_longitude: '',
      phone: '',
      recipient_name: '',
    });
    setMessage('เพิ่มสาขาแล้ว');
    onUpdated?.();
  };

  return (
    <Panel className="overflow-hidden">
      <PanelHead icon="support_agent" title={__uiText("เครื่องมือบริการลูกค้า")} />
      <div className="space-y-6 p-4">
      {message && <Alert tone="ok" onClose={() => setMessage('')}>{__uiText(message)}</Alert>}

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{__uiText("แก้ไขข้อมูลลูกค้า")}</h4>
        <div className="rounded-lg border border-secondary-container bg-surface-container-low p-3">
          <p className="mb-2 text-xs text-on-surface-variant">{__uiText("ข้อมูลปัจจุบัน (ปิดบางส่วนเพื่อความเป็นส่วนตัว)")}</p>
          <div className="flex flex-wrap gap-4">
            <RevealPiiButton subjectType="user" subjectId={userId} field="email" masked={email} label={__uiText("อีเมล:")} />
            <RevealPiiButton
              subjectType="user"
              subjectId={userId}
              field="mobile_phone"
              masked={mobilePhone}
              label={__uiText("เบอร์โทร:")}
            />
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Input
            label={__uiText("ชื่อ")}
            value={form.first_name}
            placeholder={__uiText("กรอกเพื่อแก้ไข")}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
          />
          <Input
            label={__uiText("นามสกุล")}
            value={form.last_name}
            placeholder={__uiText("กรอกเพื่อแก้ไข")}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
          />
          <Input
            label={__uiText("อีเมล")}
            value={form.email}
            placeholder={__uiText("กรอกเพื่อแก้ไข")}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            label={__uiText("เบอร์โทร")}
            value={form.mobile_phone}
            placeholder={__uiText("กรอกเพื่อแก้ไข")}
            onChange={(e) => setForm({ ...form, mobile_phone: e.target.value })}
          />
        </div>
        <p className="text-xs text-on-surface-variant">
          {__uiText("ช่องที่ปล่อยว่างจะไม่ถูกแก้ไข ระบบไม่บันทึกทับด้วยค่าว่าง")}</p>
        <Button size="sm" variant="primary" onClick={() => void saveUser()}>
          {__uiText("บันทึก")}</Button>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{__uiText("ประวัติค้นหาสินค้า")}</h4>
        {searchHistory.length === 0 ? (
          <p className="text-sm text-on-surface-variant">{__uiText("ยังไม่มีข้อมูล")}</p>
        ) : (
          <ul className="text-sm text-on-surface space-y-1">
            {searchHistory.slice(0, 10).map((row) => (
              <li key={`${row.created_at}-${row.query_text}`}>
                {row.query_text} ({row.result_count} {__uiText(" ผลลัพธ์)")}</li>
            ))}
          </ul>
        )}
      </section>

      {companyId && (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">{__uiText("กำหนดพนักงานขาย")}</h4>
          <Input
            label={__uiText("รหัสผู้ใช้ของพนักงานขาย")}
            value={salesUserId}
            onChange={(e) => setSalesUserId(e.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              void assignCsSalesRep({ company_id: companyId, sales_user_id: salesUserId || null }).then(
                () => setMessage('กำหนดพนักงานขายแล้ว'),
              )
            }
          >
            {__uiText("บันทึก")}</Button>
        </section>
      )}

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{__uiText("รวมบัญชีซ้ำ")}</h4>
        <p className="text-xs text-on-surface-variant">
          {__uiText("ย้ายออเดอร์และสาขาจากบัญชีที่ซ้ำเข้าบัญชีนี้ แล้วปิดอีเมลและเบอร์ของบัญชีที่ซ้ำ")}</p>
        <Input
          label={__uiText("รหัสผู้ใช้ของบัญชีที่ซ้ำ *")}
          value={duplicateUserId}
          onChange={(e) => setDuplicateUserId(e.target.value)}
        />
        <Button
          size="sm"
          variant="danger-ghost"
          icon="merge"
          onClick={() => {
            if (!duplicateUserId.trim()) {
              alert(__uiText("ใส่รหัสผู้ใช้ของบัญชีที่ซ้ำ"));
              return;
            }
            if (
              !window.confirm(
                __uiText("รวม {0} เข้าบัญชีนี้ ({1})?\nการกระทำนี้ย้อนกลับยาก", {"0": duplicateUserId.trim(), "1": userId}),
              )
            ) {
              return;
            }
            void mergeCsAccounts({
              primary_user_id: userId,
              duplicate_user_id: duplicateUserId.trim(),
            })
              .then(() => {
                setMessage('รวมบัญชีแล้ว');
                setDuplicateUserId('');
                onUpdated?.();
              })
              .catch((err: any) => {
                alert(
                  err?.response?.data?.message ??
                    err.message ??
                    __uiText("รวมบัญชีไม่สำเร็จ"),
                );
              });
          }}
        >
          {__uiText("รวมเข้าบัญชีนี้")}</Button>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{__uiText("สาขา ที่อยู่จัดส่ง และพิกัด")}</h4>
        {branches.map((branch) => {
          const edit = branchEdits[branch.id];
          if (!edit) return null;
          return (
            <div key={branch.id} className="rounded-lg border border-secondary-container p-3 space-y-2">
              <p className="text-sm font-medium">{branch.name}</p>
              <Input
                label={__uiText("ที่อยู่")}
                value={edit.address}
                onChange={(e) =>
                  setBranchEdits({
                    ...branchEdits,
                    [branch.id]: { ...edit, address: e.target.value },
                  })
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label={__uiText("โทรสาขา")}
                  value={edit.phone}
                  onChange={(e) =>
                    setBranchEdits({
                      ...branchEdits,
                      [branch.id]: { ...edit, phone: e.target.value },
                    })
                  }
                />
                <Input
                  label={__uiText("ชื่อผู้รับ")}
                  value={edit.recipient}
                  onChange={(e) =>
                    setBranchEdits({
                      ...branchEdits,
                      [branch.id]: { ...edit, recipient: e.target.value },
                    })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label={__uiText("ละติจูด (Latitude)")}
                  value={edit.lat}
                  placeholder="13.7563"
                  onChange={(e) =>
                    setBranchEdits({
                      ...branchEdits,
                      [branch.id]: { ...edit, lat: e.target.value },
                    })
                  }
                />
                <Input
                  label={__uiText("ลองจิจูด (Longitude)")}
                  value={edit.lng}
                  placeholder="100.5018"
                  onChange={(e) =>
                    setBranchEdits({
                      ...branchEdits,
                      [branch.id]: { ...edit, lng: e.target.value },
                    })
                  }
                />
              </div>
              <Button
                size="sm"
                onClick={() => void saveBranch(branch.id)}
              >
                {__uiText("บันทึกสาขานี้")}</Button>
            </div>
          );
        })}
        <div className="rounded-lg border border-dashed border-secondary-container p-3 space-y-2">
          <p className="text-xs text-on-surface-variant">{__uiText("เพิ่มสาขาใหม่")}</p>
          <Input label={__uiText("ชื่อสาขา")} value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} />
          <Input label={__uiText("ที่อยู่")} value={branchForm.delivery_address} onChange={(e) => setBranchForm({ ...branchForm, delivery_address: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input
              label={__uiText("โทรสาขา")}
              value={branchForm.phone}
              onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
            />
            <Input
              label={__uiText("ชื่อผู้รับ")}
              value={branchForm.recipient_name}
              onChange={(e) =>
                setBranchForm({ ...branchForm, recipient_name: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label={__uiText("ละติจูด (Latitude)")}
              value={branchForm.delivery_latitude}
              placeholder="13.7563"
              onChange={(e) => setBranchForm({ ...branchForm, delivery_latitude: e.target.value })}
            />
            <Input
              label={__uiText("ลองจิจูด (Longitude)")}
              value={branchForm.delivery_longitude}
              placeholder="100.5018"
              onChange={(e) => setBranchForm({ ...branchForm, delivery_longitude: e.target.value })}
            />
          </div>
          <Button size="sm" icon="add" onClick={() => void addBranch()}>
            {__uiText("เพิ่มสาขา")}</Button>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{__uiText("สั่งซื้อแทนลูกค้า")}</h4>
        <CsPlaceOrderPanel
          userId={userId}
          branches={branches}
          onMessage={setMessage}
        />
      </section>
      </div>
    </Panel>
  );
}

export default CsUserTools;
