import React, { useState } from 'react'
import { BotWorkflow as BotWorkflowEntity, FlowStep } from '@josh/shared-api'
import { StepList } from './StepList'
import { FlowCanvas } from './FlowCanvas'
import { StepForm } from './StepForm'
import styles from './BotFlowEditor.module.css'

interface BotFlowEditorProps {
  workflow: BotWorkflowEntity
  onWorkflowChange: (workflow: BotWorkflowEntity) => void
}

export const BotFlowEditor: React.FC<BotFlowEditorProps> = ({
  workflow,
  onWorkflowChange,
}) => {
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(
    workflow.steps?.[0]?.id
  )

  const handleAddStep = () => {
    const newStepId = `s${(workflow.steps?.length || 0) + 1}`
    const newStep: FlowStep = {
      id: newStepId,
      type: 'message',
      text: '',
    }
    const updated = {
      ...workflow,
      steps: [...(workflow.steps || []), newStep],
    }
    onWorkflowChange(updated)
    setSelectedStepId(newStepId)
  }

  const handleDeleteStep = (stepId: string) => {
    if ((workflow.steps?.length || 0) <= 1) {
      alert('Cannot delete the last step')
      return
    }
    const updated = {
      ...workflow,
      steps: (workflow.steps || []).filter((s) => s.id !== stepId),
    }
    onWorkflowChange(updated)
    if (selectedStepId === stepId) {
      setSelectedStepId(updated.steps[0]?.id)
    }
  }

  const handleSaveStep = (step: FlowStep) => {
    const updated = {
      ...workflow,
      steps: (workflow.steps || []).map((s) => (s.id === step.id ? step : s)),
    }
    onWorkflowChange(updated)
  }

  const selectedStep = workflow.steps?.find((s) => s.id === selectedStepId)

  return (
    <div className={styles.container}>
      <div className={styles.leftPanel}>
        <StepList
          workflow={workflow}
          selectedStepId={selectedStepId}
          onStepSelect={setSelectedStepId}
          onAddStep={handleAddStep}
          onDeleteStep={handleDeleteStep}
        />
      </div>

      <div className={styles.centerPanel}>
        <FlowCanvas
          workflow={workflow}
          selectedStepId={selectedStepId}
          onStepSelect={setSelectedStepId}
        />
      </div>

      <div className={styles.rightPanel}>
        {selectedStep ? (
          <StepForm
            step={selectedStep}
            allSteps={workflow.steps || []}
            onSave={handleSaveStep}
            onCancel={() => {}}
          />
        ) : (
          <div className={styles.empty}>Select a step to edit</div>
        )}
      </div>
    </div>
  )
}
