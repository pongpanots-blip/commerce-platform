import React from 'react'
import { FlowBranch } from '@josh/shared-api'
import { Select } from '@josh/shared-ui-web'
import styles from './BranchEditor.module.css'

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
      <h4>Branches</h4>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>ประเภทการจับคู่</th>
            <th>ค่า</th>
            <th>ขั้นตอนถัดไป</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {branches.map((branch, idx) => (
            <tr key={idx}>
              <td>
                <Select
                  aria-label={`ประเภทเงื่อนไข (Match Type) แถวที่ ${idx + 1}`}
                  value={branch.match.type}
                  onChange={(e) => updateBranch(idx, 'matchType', e.target.value)}
                >
                  <option value="option">option</option>
                  <option value="keyword">keyword</option>
                  <option value="regex">regex</option>
                  <option value="default">default</option>
                </Select>
              </td>
              <td>
                <input
                  aria-label={`ค่าที่จับคู่ (Value) แถวที่ ${idx + 1}`}
                  type="text"
                  value={branch.match.value || ''}
                  onChange={(e) => updateBranch(idx, 'matchValue', e.target.value)}
                  disabled={branch.match.type === 'default'}
                  placeholder={branch.match.type === 'default' ? 'N/A' : '...'}
                />
              </td>
              <td>
                <Select
                  aria-label={`ขั้นตอนถัดไป (Next Step) แถวที่ ${idx + 1}`}
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
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className={styles.addBtn} onClick={addBranch}>
        + Add Branch
      </button>
    </div>
  )
}
