import { useEffect, useId, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { joshAdmin } from '../../../lib/api';
import { useAsync } from '../../hooks';
import type {
  MarketingWorkflow,
  MarketingTriggerType,
  MarketingTriggerConfig,
  MarketingStep,
  MarketingWorkflowSchedule,
  MarketingGoalConfig,
  UserSegmentListItem,
  UpdateMarketingWorkflowPayload,
} from './marketing.types';
import { defaultTriggerConfigFor, TRIGGER_TYPE_CARDS } from './helpers';
import { WorkflowCanvas } from './Canvas';

type CouponOption = { id: string; coupon_code: string; title: string };

const STATUS_LABEL: Record<MarketingWorkflow['status'], string> = {
  draft: 'ร่าง (Draft)',
  active: 'ใช้งานอยู่ (Active)',
  paused: 'หยุดชั่วคราว (Paused)',
};

const STATUS_CLASS: Record<MarketingWorkflow['status'], string> = {
  draft: 'badge muted',
  active: 'badge ok',
  paused: 'badge warn',
};

function CreateWorkflowScreen() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<MarketingTriggerType>('cart_idle');
  const [triggerConfig, setTriggerConfig] = useState<MarketingTriggerConfig>(
    defaultTriggerConfigFor('cart_idle'),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputId = useId();

  const handleSelectTrigger = (type: MarketingTriggerType) => {
    setTriggerType(type);
    setTriggerConfig(defaultTriggerConfigFor(type));
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('กรุณาระบุชื่อ workflow');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const seedSteps =
        triggerType === 'first_visit' || triggerType === 'first_login' || triggerType === 'custom'
          ? [
              {
                id: crypto.randomUUID(),
                type: 'action' as const,
                action: {
                  kind: 'show_offer' as const,
                  displayOnly: true,
                  hideCode: true,
                  title:
                    triggerType === 'first_visit'
                      ? 'ยินดีต้อนรับ'
                      : triggerType === 'custom'
                        ? (triggerConfig as { label?: string }).label?.trim() || 'ข้อเสนอพิเศษ'
                        : 'ยินดีต้อนรับสมาชิกใหม่',
                  body: 'ดูข้อเสนอพิเศษจากเราได้ที่นี่',
                },
              },
            ]
          : undefined;

      const response = await joshAdmin.call<{ data: { id: string } }>(
        'POST',
        '/marketing-workflows',
        {
          name: name.trim(),
          trigger_type: triggerType,
          trigger_config: triggerConfig,
          ...(seedSteps ? { steps: seedSteps } : {}),
        },
      );
      const workflowId = response.data.id;
      navigate(`/marketing/workflows/${workflowId}/edit`, { replace: true });
    } catch (err: any) {
      setError(err?.message || 'สร้าง workflow ไม่สำเร็จ');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>สร้าง Marketing Workflow ใหม่</h1>
          <p>ตั้งชื่อ แล้วสร้างเงื่อนไขเริ่มต้น</p>
        </div>
      </div>

      <div className="panel">
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label htmlFor={nameInputId} className="field" style={{ display: 'block', marginBottom: '8px' }}>
              ชื่อ Workflow
            </label>
            <input
              id={nameInputId}
              type="text"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="เช่น ตะกร้าค้าง 30 นาที + แจกคูปอง"
              style={{
                width: '100%',
                padding: '7px 10px',
                border: '1px solid var(--line)',
                borderRadius: '6px',
                font: 'inherit',
              }}
            />
          </div>

          <div>
            <h3 style={{ margin: '0 0 12px', fontSize: '13px' }}>เลือกประเภท Trigger</h3>
            <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              {TRIGGER_TYPE_CARDS.map((card) => (
                <button
                  key={card.type}
                  onClick={() => handleSelectTrigger(card.type)}
                  style={{
                    padding: '12px',
                    border: triggerType === card.type ? '2px solid var(--accent)' : '1px solid var(--line)',
                    borderRadius: '6px',
                    background: triggerType === card.type ? 'var(--chip)' : '#fff',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <strong>{card.title}</strong>
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                    {card.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {error && <div className="err">{error}</div>}
          <button
            className="btn"
            onClick={handleCreate}
            disabled={creating}
            style={{ alignSelf: 'flex-start' }}
          >
            {creating ? 'กำลังสร้าง...' : 'สร้าง Workflow'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditWorkflowScreen({ id }: { id: string }) {
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState<MarketingWorkflow | null>(null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<MarketingWorkflow['status']>('draft');
  const [triggerType, setTriggerType] = useState<MarketingTriggerType>('cart_idle');
  const [triggerConfig, setTriggerConfig] = useState<MarketingTriggerConfig>({ idleHours: 24 });
  const [steps, setSteps] = useState<MarketingStep[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: loaded, loading, error: loadError } = useAsync(() =>
    joshAdmin.get<{ data: MarketingWorkflow }>('/marketing-workflows/' + id),
  );

  useEffect(() => {
    if (loaded?.data) {
      const wf = loaded.data;
      setWorkflow(wf);
      setName(wf.name);
      setStatus(wf.status);
      setTriggerType(wf.trigger_type);
      setTriggerConfig(wf.trigger_config ?? defaultTriggerConfigFor(wf.trigger_type));
      setSteps(wf.steps ?? []);
    }
  }, [loaded]);

  const handleSave = async () => {
    if (!workflow) return;
    setSaving(true);
    setError(null);
    try {
      const payload: UpdateMarketingWorkflowPayload = {
        name,
        trigger_type: triggerType,
        trigger_config: triggerConfig,
        steps,
      };
      await joshAdmin.call('PATCH', '/marketing-workflows/' + id, payload);
      setWorkflow((w) => (w ? { ...w, name, trigger_type: triggerType, trigger_config: triggerConfig, steps } : null));
    } catch (err: any) {
      setError(err?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    if (!workflow) return;
    setSaving(true);
    try {
      await joshAdmin.call('POST', `/marketing-workflows/${id}/activate`, {});
      setStatus('active');
      setWorkflow((w) => (w ? { ...w, status: 'active' } : null));
    } catch (err: any) {
      setError(err?.message || 'เปิดใช้งานไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handlePause = async () => {
    if (!workflow) return;
    setSaving(true);
    try {
      await joshAdmin.call('POST', `/marketing-workflows/${id}/pause`, {});
      setStatus('paused');
      setWorkflow((w) => (w ? { ...w, status: 'paused' } : null));
    } catch (err: any) {
      setError(err?.message || 'หยุดใช้งานไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="empty">กำลังโหลด...</div>;
  if (loadError) return <div className="err">{loadError}</div>;
  if (!workflow) return <div className="empty">ไม่พบ workflow</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{name || 'Workflow (ไม่มีชื่อ)'}</h1>
          <p style={{ margin: '4px 0 0' }}>
            <span className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn ghost sm" onClick={handleSave} disabled={saving}>
            {saving ? 'บันทึก...' : 'บันทึก'}
          </button>
          {status === 'draft' && (
            <button className="btn sm" onClick={handleActivate} disabled={saving}>
              เปิดใช้งาน
            </button>
          )}
          {status === 'active' && (
            <button className="btn ghost sm" onClick={handlePause} disabled={saving}>
              หยุด
            </button>
          )}
        </div>
      </div>

      {error && <div className="err" style={{ margin: '16px 0' }}>{error}</div>}

      <div className="panel">
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '12px', color: 'var(--muted)' }}>
              ชื่อ
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 10px',
                border: '1px solid var(--line)',
                borderRadius: '6px',
                font: 'inherit',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '12px', color: 'var(--muted)' }}>
              เงื่อนไขเริ่มต้น (Trigger)
            </label>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
              {triggerType}
            </p>
          </div>
        </div>
      </div>

      <div style={{ margin: '16px 0 0' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '13px' }}>Workflow Flow</h3>
        <WorkflowCanvas
          steps={steps}
          selectedStepId={selectedStepId}
          onSelectStep={setSelectedStepId}
          onAddStepAfter={() => {
            // Simple add logic
            const newStep: MarketingStep = {
              id: crypto.randomUUID(),
              type: 'action',
              action: { kind: 'show_offer' },
            };
            setSteps([...steps, newStep]);
          }}
          onDeleteStep={(stepId) => {
            setSteps(steps.filter((s) => s.id !== stepId));
          }}
        />
      </div>

      <p style={{ margin: '16px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
        ℹ️ การแก้ไข workflow ครบถ้วน (ทั้ง trigger rules, steps detail) อยู่ระหว่างการพัฒนา
      </p>
    </div>
  );
}

export function WorkflowEditor() {
  const { id } = useParams<{ id?: string }>();
  if (!id) return <CreateWorkflowScreen />;
  return <EditWorkflowScreen id={id} />;
}
