import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@josh/shared-ui-web';
import { BotClient } from '../../lib/api/bot.client';
import { BotFlowEditor } from '../../components/bot/BotFlowEditor';
import { BotWorkflow } from '@josh/shared-api';
import styles from './EditBotWorkflow.module.css';

const botClient = new BotClient();

export const EditBotWorkflow: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [workflow, setWorkflow] = useState<BotWorkflow | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => botClient.getWorkflow(id as string),
    enabled: !!id,
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
      alert('Workflow saved!');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`Error saving workflow: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!id || !workflow) return;
    const message = prompt('Enter test message:');
    if (!message) return;

    try {
      const result = await botClient.testFlow(id, message);
      alert(`Test result: ${JSON.stringify(result, null, 2)}`);
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      alert(`Error testing flow: ${errMessage}`);
    }
  };

  if (isLoading || !workflow) {
    return <div className={styles.loading}>Loading...</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Edit Workflow: {workflow.name}</h1>
        <div className={styles.actions}>
          <button onClick={handleTest} className={styles.testBtn}>
            Test Flow
          </button>
          <button onClick={handleSave} disabled={isSaving} className={styles.saveBtn}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className={styles.settings}>
        <div className={styles.settingRow}>
          <label htmlFor="workflow-name">ชื่อ Workflow</label>
          <input
            id="workflow-name"
            type="text"
            value={workflow.name}
            onChange={(e) => setWorkflow({ ...workflow, name: e.target.value })}
          />
        </div>

        <div className={styles.settingRow}>
          <label htmlFor="workflow-trigger-event">เริ่มทำงานเมื่อ (Trigger Event)</label>
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
            <option value="message">มีข้อความเข้ามา (Message)</option>
            <option value="chat_open">เปิดหน้าแชท (Chat Open)</option>
          </Select>
        </div>

        <div className={styles.settingRow}>
          <label htmlFor="workflow-active">เปิดใช้งาน (Active)</label>
          <input
            id="workflow-active"
            type="checkbox"
            checked={workflow.active}
            onChange={(e) => setWorkflow({ ...workflow, active: e.target.checked })}
          />
        </div>
      </div>

      <h2>Flow Design</h2>
      {workflow.steps && workflow.steps.length > 0 ? (
        <BotFlowEditor workflow={workflow} onWorkflowChange={setWorkflow} />
      ) : (
        <div className={styles.empty}>No steps yet. Add one to get started.</div>
      )}
    </div>
  );
};

export default EditBotWorkflow;
