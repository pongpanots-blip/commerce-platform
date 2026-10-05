import React from 'react'
import { BotWorkflow, FlowStep } from '@josh/shared-api'
import styles from './StepList.module.css'

interface StepListProps {
  workflow: BotWorkflow
  selectedStepId?: string
  onStepSelect: (stepId: string) => void
  onAddStep: () => void
  onDeleteStep: (stepId: string) => void
}

const stepTypeIcons = {
  message: '💬',
  question: '❓',
  tool: '🔧',
  escalate: '🚪',
}

export const StepList: React.FC<StepListProps> = ({
  workflow,
  selectedStepId,
  onStepSelect,
  onAddStep,
  onDeleteStep,
}) => {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>Steps ({workflow.steps?.length || 0})</h3>
        <button className={styles.addBtn} onClick={onAddStep}>
          + Add Step
        </button>
      </div>

      <div className={styles.list}>
        {workflow.steps && workflow.steps.length > 0 ? (
          workflow.steps.map((step) => (
            <div
              key={step.id}
              className={`${styles.item} ${
                selectedStepId === step.id ? styles.selected : ''
              }`}
              onClick={() => onStepSelect(step.id)}
            >
              <div className={styles.itemContent}>
                <span className={styles.icon}>{stepTypeIcons[step.type]}</span>
                <span className={styles.id}>{step.id}</span>
                <span className={styles.preview}>
                  {step.text?.substring(0, 20) || step.toolName || '...'}
                </span>
              </div>
              <button
                className={styles.deleteBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteStep(step.id)
                }}
              >
                ✕
              </button>
            </div>
          ))
        ) : (
          <div className={styles.empty}>No steps yet</div>
        )}
      </div>
    </div>
  )
}
