import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@josh/shared-ui-web';
import { BotClient } from '../../lib/api/bot.client';
import { BotFlowEditor } from '../../components/bot/BotFlowEditor';
import { LoadError } from '../../components/LoadError';
import { BotWorkflow } from '@josh/shared-api';
import styles from './EditBotWorkflow.module.css';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
    if (!id || !workflow) return;
    setIsSaving(true);
    try {
      await botClient.updateWorkflow(id, workflow);
      alert(__uiText("Workflow saved!"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(__uiText("Error saving workflow: {0}", {"0": message}));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!id || !workflow) return;
    const message = prompt(__uiText('Enter test message:'));
    if (!message) return;

    try {
      const result = await botClient.testFlow(id, message);
      alert(__uiText("Test result: {0}", {"0": JSON.stringify(result, null, 2)}));
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      alert(__uiText("Error testing flow: {0}", {"0": errMessage}));
    }
  };

  if (isError || (!isLoading && !data && !workflow)) {
    return <LoadError title={__uiText('แก้ไขเวิร์กโฟลว์บอต')} error={error ?? __uiMessage('ไม่พบเวิร์กโฟลว์บอตนี้')} onRetry={() => { void refetch(); }} />;
  }

  if (isLoading || !workflow) {
    return <div className={styles.loading}>{__uiText("Loading...")}</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>{__uiText("Edit Workflow: ")}{workflow.name}</h1>
        <div className={styles.actions}>
          <button onClick={handleTest} className={styles.testBtn}>
            {__uiText("Test Flow")}</button>
          <button onClick={handleSave} disabled={isSaving} className={styles.saveBtn}>
            {isSaving ? __uiText("Saving...") : __uiText("Save")}
          </button>
        </div>
      </div>

      <div className={styles.settings}>
        <div className={styles.settingRow}>
          <label htmlFor="workflow-name">{__uiText("ชื่อ Workflow")}</label>
          <input
            id="workflow-name"
            type="text"
            value={workflow.name}
            onChange={(e) => setWorkflow({ ...workflow, name: e.target.value })}
          />
        </div>

        <div className={styles.settingRow}>
          <label htmlFor="workflow-trigger-event">{__uiText("เริ่มทำงานเมื่อ (Trigger Event)")}</label>
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
            <option value="message">{__uiText("มีข้อความเข้ามา (Message)")}</option>
            <option value="chat_open">{__uiText("เปิดหน้าแชท (Chat Open)")}</option>
          </Select>
        </div>

        <div className={styles.settingRow}>
          <label htmlFor="workflow-active">{__uiText("เปิดใช้งาน (Active)")}</label>
          <input
            id="workflow-active"
            type="checkbox"
            checked={workflow.active}
            onChange={(e) => setWorkflow({ ...workflow, active: e.target.checked })}
          />
        </div>
      </div>

      <h2>{__uiText("Flow Design")}</h2>
      {workflow.steps && workflow.steps.length > 0 ? (
        <BotFlowEditor workflow={workflow} onWorkflowChange={setWorkflow} />
      ) : (
        <div className={styles.empty}>{__uiText("No steps yet. Add one to get started.")}</div>
      )}
    </div>
  );
};

export default EditBotWorkflow;
