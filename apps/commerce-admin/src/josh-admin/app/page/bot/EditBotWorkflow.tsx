import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@josh/shared-ui-web';
import { BotClient } from '../../lib/api/bot.client';
import { BotFlowEditor } from '../../components/bot/BotFlowEditor';
import { LoadError } from '../../components/LoadError';
import AdminInsertLayout from '../../components/AdminInsertLayout';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { BotWorkflow } from '@josh/shared-api';
import styles from './EditBotWorkflow.module.css';

// ui-copy-migration: only literal UI copy and notification templates
import { Button, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const botClient = new BotClient();

export const EditBotWorkflow: React.FC = () => {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const [workflow, setWorkflow] = useState<BotWorkflow | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => botClient.getWorkflow(id as string),
    enabled: !!id,
    retry: false,
  });

  useEffect(() => {
    if (data) {
      setWorkflow(data);
    }
  }, [data]);

  const handleSave = async () => {
    if (!id || !workflow) return false;
    setIsSaving(true);
    try {
      await botClient.updateWorkflow(id, workflow);
      alert(__uiText("บันทึกลำดับการตอบแล้ว"));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(__uiText("บันทึกไม่สำเร็จ: {0}", {"0": message}));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!id || !workflow) return;
    const message = prompt(__uiText('พิมพ์ข้อความที่จะลองถามแชตบอต'));
    if (!message) return;

    try {
      const result = await botClient.testFlow(id, message);
      alert(__uiText("แชตบอตตอบว่า: {0}", {"0": JSON.stringify(result, null, 2)}));
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      alert(__uiText("ลองถามไม่สำเร็จ: {0}", {"0": errMessage}));
    }
  };

  if (isError || (!isLoading && !data && !workflow)) {
    return <LoadError title={__uiText('แก้ลำดับการตอบของแชตบอต')} error={error ?? __uiMessage('ไม่พบลำดับการตอบนี้')} onRetry={() => { void refetch(); }} />;
  }

  if (isLoading || !workflow) {
    return <div className={styles.loading}>{__uiText("กำลังโหลด...")}</div>;
  }

  return (
    <AdminInsertLayout
      title={`${__uiText("แก้ลำดับการตอบ: ")}${workflow.name}`}
      subtitle={__uiText("ตั้งชื่อ เลือกว่าเริ่มเมื่อไร แล้วจัดขั้นตอนการตอบด้านล่าง")}
      saveLabel="บันทึกลำดับการตอบ"
      saving={isSaving}
      onSave={handleSave}
      backPath={ADMIN_ROUTES.botWorkflows}
      headerActions={<Button variant="secondary" onClick={handleTest} disabled={isSaving}>{__uiText("ลองถามแชตบอต")}</Button>}
    >
      <div className={styles.settings}>
        <div className={styles.settingRow}>
          <label htmlFor="workflow-name">{__uiText("ชื่อลำดับการตอบ")}</label>
          <input
            id="workflow-name"
            type="text"
            value={workflow.name}
            onChange={(e) => setWorkflow({ ...workflow, name: e.target.value })}
          />
        </div>

        <div className={styles.settingRow}>
          <label htmlFor="workflow-trigger-event">{__uiText("เริ่มเมื่อ")}</label>
          <Select
            id="workflow-trigger-event"
            value={workflow.triggerEvent || 'message'}
            onChange={(e) =>
              setWorkflow({
                ...workflow,
                triggerEvent: e.target.value as 'message' | 'chat_open',
              })
            }
          >
            <option value="message">{__uiText("เมื่อลูกค้าส่งข้อความ")}</option>
            <option value="chat_open">{__uiText("เมื่อลูกค้าเปิดแชต")}</option>
          </Select>
        </div>

        <div className={styles.settingRow}>
          <label htmlFor="workflow-active">{__uiText("เปิดใช้งาน")}</label>
          <input
            id="workflow-active"
            type="checkbox"
            checked={workflow.active}
            onChange={(e) => setWorkflow({ ...workflow, active: e.target.checked })}
          />
        </div>
      </div>

      <h2 className={styles.sectionTitle}>{__uiText("ขั้นตอนการตอบ")}</h2>
      {workflow.steps && workflow.steps.length > 0 ? (
        <BotFlowEditor workflow={workflow} onWorkflowChange={setWorkflow} />
      ) : (
        <div className={styles.empty}>{__uiText("ยังไม่มีขั้นตอน — เพิ่มขั้นตอนแรกเพื่อเริ่ม")}</div>
      )}
    </AdminInsertLayout>
  );
};

export default EditBotWorkflow;
