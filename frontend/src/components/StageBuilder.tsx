import { VisibleUser } from '../api/users';
import { VisibleGroup } from '../api/groups';

export interface StageRow {
  name: string;
  assigneeType: 'user' | 'group';
  assigneeId: string;
}

export function emptyStageRow(): StageRow {
  return { name: '', assigneeType: 'user', assigneeId: '' };
}

interface StageBuilderProps {
  stageRows: StageRow[];
  visibleUsers?: VisibleUser[];
  visibleGroups?: VisibleGroup[];
  onUpdateRow: (index: number, patch: Partial<StageRow>) => void;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
}

export function StageBuilder({
  stageRows,
  visibleUsers,
  visibleGroups,
  onUpdateRow,
  onAddRow,
  onRemoveRow,
}: StageBuilderProps) {
  return (
    <div className="space-y-3 rounded border border-gray-200 bg-gray-50 p-3">
      <p className="text-sm font-medium text-gray-700">Build the approval steps</p>
      {stageRows.map((row, index) => (
        <div key={index} className="space-y-2 rounded border border-gray-200 bg-white p-2">
          <label className="block text-xs">
            Stage {index + 1} name
            <input
              type="text"
              required
              value={row.name}
              onChange={(e) => onUpdateRow(index, { name: e.target.value })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name={`stage-${index}-assignee-type`}
                checked={row.assigneeType === 'user'}
                onChange={() => onUpdateRow(index, { assigneeType: 'user', assigneeId: '' })}
              />
              Person
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name={`stage-${index}-assignee-type`}
                checked={row.assigneeType === 'group'}
                onChange={() => onUpdateRow(index, { assigneeType: 'group', assigneeId: '' })}
              />
              Group
            </label>
          </div>
          <select
            required
            value={row.assigneeId}
            onChange={(e) => onUpdateRow(index, { assigneeId: e.target.value })}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">{row.assigneeType === 'user' ? 'Select a person' : 'Select a group'}</option>
            {row.assigneeType === 'user'
              ? visibleUsers?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.email}
                  </option>
                ))
              : visibleGroups?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
          </select>
          {stageRows.length > 1 && (
            <button
              type="button"
              onClick={() => onRemoveRow(index)}
              className="text-xs text-red-700 hover:underline"
            >
              Remove stage
            </button>
          )}
        </div>
      ))}
      <button type="button" onClick={onAddRow} className="text-sm text-blue-700 hover:underline">
        + Add stage
      </button>
    </div>
  );
}
