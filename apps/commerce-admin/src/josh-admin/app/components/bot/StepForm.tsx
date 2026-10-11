import React, { useState } from 'react'
import { FlowStep } from '@josh/shared-api'
import { Select } from '@josh/shared-ui-web'
import { BranchEditor } from './BranchEditor'
import styles from './StepForm.module.css'

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
interface StepFormProps {
  step?: FlowStep
  allSteps: FlowStep[]
  onSave: (step: FlowStep) => void
  onCancel: () => void
}

export const StepForm: React.FC<StepFormProps> = ({
  step,
  allSteps,
  onSave,
  onCancel,
}) => {
  __useUiLocale();
  const [formData, setFormData] = useState<FlowStep>(
    step || {
      id: `s${Date.now()}`,
      type: 'message',
      text: '',
    }
  )

  const stepIds = allSteps.map((s) => s.id).filter((id) => id !== formData.id)

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  return (
    <form className={styles.form}>
      <div className={styles.section}>
        <label htmlFor="step-type">{__uiText("ประเภทขั้นตอน (Step Type) *")}</label>
        <Select
          id="step-type"
          value={formData.type}
          onChange={(e) => handleChange('type', e.target.value)}
        >
          <option value="message">{__uiText("Message")}</option>
          <option value="question">{__uiText("Question")}</option>
          <option value="tool">{__uiText("Tool")}</option>
          <option value="escalate">{__uiText("Escalate")}</option>
        </Select>
      </div>

      <div className={styles.section}>
        <label htmlFor="step-id">{__uiText("รหัสขั้นตอน (Step ID, แก้ไขไม่ได้)")}</label>
        <input id="step-id" type="text" value={formData.id} disabled />
      </div>

      {(formData.type === 'message' ||
        formData.type === 'question' ||
        formData.type === 'escalate') && (
        <div className={styles.section}>
          <label htmlFor="step-text">{__uiText("ข้อความ (Text) *")}</label>
          <textarea
            id="step-text"
            value={formData.text || ''}
            onChange={(e) => handleChange('text', e.target.value)}
            placeholder={__uiText("Message text...")}
            rows={4}
          />
        </div>
      )}

      {formData.type === 'question' && (
        <div className={styles.section}>
          <label htmlFor="step-options">{__uiText("ตัวเลือก (พิมพ์บรรทัดละ 1 ตัวเลือก)")}</label>
          <textarea
            id="step-options"
            value={(formData.options || []).join('\n')}
            onChange={(e) =>
              handleChange('options', e.target.value.split('\n').filter((x) => x))
            }
            placeholder={__uiText("Option 1&#10;Option 2&#10;...")}
            rows={4}
          />
        </div>
      )}

      {formData.type === 'tool' && (
        <>
          <div className={styles.section}>
            <label htmlFor="step-tool-name">{__uiText("เครื่องมือที่ใช้ (Tool) *")}</label>
            <Select
              id="step-tool-name"
              value={formData.toolName || ''}
              onChange={(e) => handleChange('toolName', e.target.value)}
            >
              <option value="">{__uiText("-- เลือกข้อมูลที่จะค้น --")}</option>
              <option value="order_lookup">{__uiText("ค้นคำสั่งซื้อ")}</option>
              <option value="product_search">{__uiText("ค้นสินค้า")}</option>
              <option value="product_recommend">{__uiText("แนะนำสินค้า")}</option>
              <option value="faq">{__uiText("คำถามที่พบบ่อย")}</option>
            </Select>
          </div>

          <div className={styles.section}>
            <label htmlFor="step-template-id">{__uiText("รหัส Template (Template ID) *")}</label>
            <input
              id="step-template-id"
              type="text"
              value={formData.templateId || ''}
              onChange={(e) => handleChange('templateId', e.target.value)}
              placeholder={__uiText("UUID of response template...")}
            />
          </div>

          <div className={styles.section}>
            <label htmlFor="step-intro-text">{__uiText("ข้อความนำ (ไม่บังคับ)")}</label>
            <input
              id="step-intro-text"
              type="text"
              value={formData.introText || ''}
              onChange={(e) => handleChange('introText', e.target.value)}
              placeholder={__uiText("Text before card(s)...")}
            />
          </div>

          <div className={styles.section}>
            <label htmlFor="step-empty-text">{__uiText("ข้อความเมื่อไม่พบผลลัพธ์ (ไม่บังคับ)")}</label>
            <input
              id="step-empty-text"
              type="text"
              value={formData.emptyText || ''}
              onChange={(e) => handleChange('emptyText', e.target.value)}
              placeholder={__uiText("Text when no results...")}
            />
          </div>
        </>
      )}

      {formData.type !== 'escalate' && (
        <>
          <div className={styles.section}>
            <label htmlFor="step-next-step-id">{__uiText("ขั้นตอนถัดไป (ไม่บังคับ)")}</label>
            <Select
              id="step-next-step-id"
              value={formData.nextStepId || ''}
              onChange={(e) => handleChange('nextStepId', e.target.value || null)}
            >
              <option value="">{__uiText("-- End Flow --")}</option>
              {stepIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </Select>
          </div>

          {(formData.type === 'question' || formData.type === 'tool') && (
            <BranchEditor
              branches={formData.branches}
              stepIds={stepIds}
              onChange={(branches) => handleChange('branches', branches)}
            />
          )}
        </>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.save}
          onClick={() => onSave(formData)}
        >
          {__uiText("Save")}</button>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          {__uiText("Cancel")}</button>
      </div>
    </form>
  )
}
