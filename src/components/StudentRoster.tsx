import type { Group, Student } from '../types'
import { Icon } from './Icon'

type Props = {
  students: Student[]
  groups: Group[]
  selectedIds?: string[]
  allSelected?: boolean
  partiallySelected?: boolean
  onSelectAll?: (checked:boolean)=>void
  onToggle?: (id: string) => void
  onRemove?: (id: string) => Promise<void>
}
export function StudentRoster({students, groups, selectedIds, allSelected, partiallySelected, onSelectAll, onToggle, onRemove}: Props) {
  const remove = (student: Student) => {
    if (onRemove && window.confirm(`Remove ${student.name} from this session? Their saved student record and group membership will be deleted.`)) void onRemove(student.id).catch(()=>{})
  }
  return <div className={`student-table student-roster${onRemove ? '' : ' student-roster-without-actions'}`}>
    <div className="student-table-row header"><span>Status</span><span className="student-name-cell">{onSelectAll && <input type="checkbox" aria-label="Select all students" title="Select all students, including students hidden by search" checked={allSelected ?? false} ref={node=>{if(node)node.indeterminate=partiallySelected ?? false}} onChange={event=>onSelectAll(event.target.checked)} />}<span>Student name</span></span><span>Current group</span>{onRemove && <span aria-hidden="true" />}</div>
    {students.map(student => {
      const group = groups.find(group=>group.id===student.groupId)
      const groupIndex = groups.findIndex(group=>group.id===student.groupId)
      return <div className="student-table-row" key={student.id}>
        <span className={`student-presence ${student.status}`}><span className={`status-dot ${student.status}`}/>{student.status==='online'?'Online':student.status==='away'?'Away':'Offline'}</span>
        <span className="student-name-cell">
          {onToggle && <input type="checkbox" aria-label={`Select ${student.name}`} checked={selectedIds?.includes(student.id) ?? false} onChange={()=>onToggle(student.id)} />}
          <span className="student-name-text" title={student.name}>{student.name}</span>
        </span>
        <span className={`group-tag ${group ? `group-color-${groupIndex % 4 + 1}` : 'group-color-none'}`} title={group?.name ?? 'Unassigned'}>{group ? group.name.replace('Group ','G') : 'Unassigned'}</span>
        {onRemove && <button className="student-delete-btn" aria-label={`Remove ${student.name} from session`} title="Delete student from session" onClick={()=>remove(student)}><Icon name="trash" size={14} /></button>}
      </div>
    })}
  </div>
}
