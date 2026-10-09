import { TableViewport } from '@cp/ui';
import React from 'react'
import { FlowBranch } from '@josh/shared-api'
import { Select } from '@josh/shared-ui-web'
import styles from './BranchEditor.module.css'

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
interface BranchEditorProps {
  branches?: FlowBranch[]
  stepIds: string[]
  onChange: (branches: FlowBranch[]) => void
}

export const BranchEditor: React.FC<BranchEditorProps> = ({
  branches = [],
  stepIds,
  onChange,
}) => {
  __useUiLocale();
  const addBranch = () => {
    const newBranch: FlowBranch = {
      match: { type: 'keyword', value: '' },
      nextStepId: stepIds[0] || '',
    }
    onChange([...branches, newBranch])
  }

  const updateBranch = (idx: number, field: string, value: any) => {
    const updated = [...branches]
    if (field === 'matchType') {
      updated[idx].match.type = value
    } else if (field === 'matchValue') {
      updated[idx].match.value = value
    } else if (field === 'nextStepId') {
      updated[idx].nextStepId = value
    }
    onChange(updated)
  }

  const deleteBranch = (idx: number) => {
    onChange(branches.filter((_, i) => i !== idx))
  }

  return (
    <div className={styles.container}>
      <h4>{__uiText("Branches")}</h4>
      <TableViewport><table className={'cp-data-table ' + (styles.table ?? '')}>
        <thead>
          <tr>
            <th scope="col">{__uiText("ประเภทการจับคู่")}</th>
            <th scope="col">{__uiText("ค่า")}</th>
            <th scope="col">{__uiText("ขั้นตอนถัดไป")}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          {branches.map((branch, idx) => (
            <tr key={idx}>
              <td>
                <Select
                  aria-label={__uiText("ประเภทเงื่อนไข (Match Type) แถวที่ {0}", {"0": idx + 1})}
                  value={branch.match.type}
                  onChange={(e) => updateBranch(idx, 'matchType', e.target.value)}
                >
                  <option value="option">{__uiText("option")}</option>
                  <option value="keyword">{__uiText("keyword")}</option>
                  <option value="regex">{__uiText("regex")}</option>
                  <option value="default">{__uiText("default")}</option>
                </Select>
              </td>
              <td>
                <input
                  aria-label={__uiText("ค่าที่จับคู่ (Value) แถวที่ {0}", {"0": idx + 1})}
                  type="text"
                  value={branch.match.value || ''}
                  onChange={(e) => updateBranch(idx, 'matchValue', e.target.value)}
                  disabled={branch.match.type === 'default'}
                  placeholder={branch.match.type === 'default' ? __uiText("N/A") : '...'}
                />
              </td>
              <td>
                <Select
                  aria-label={__uiText("ขั้นตอนถัดไป (Next Step) แถวที่ {0}", {"0": idx + 1})}
                  value={branch.nextStepId}
                  onChange={(e) => updateBranch(idx, 'nextStepId', e.target.value)}
                >
                  {stepIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </Select>
              </td>
              <td>
                <button
                  className={styles.deleteBtn}
                  onClick={() => deleteBranch(idx)}
                >
                  {__uiText("Delete")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></TableViewport>
      <button className={styles.addBtn} onClick={addBranch}>
        {__uiText("+ Add Branch")}</button>
    </div>
  )
}
