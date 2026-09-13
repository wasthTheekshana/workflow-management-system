import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addWorkflowStage,
  getWorkflowTemplate,
  updateWorkflowStage,
  WorkflowStage,
} from '../../api/workflowTemplates';
import { listUsers } from '../../api/users';
import { listRoles } from '../../api/roles';
import { listGroups } from '../../api/groups';
import { ApiError } from '../../api/client';

const ALL_ACTIONS = ['forward', 'send_back', 'reject'] as const;

export function WorkflowTemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: workflowTemplate, isLoading } = useQuery({
    queryKey: ['workflowTemplate', id],
    queryFn: () => getWorkflowTemplate(id!),
    enabled: Boolean(id),
  });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const { data: groups } = useQuery({ queryKey: ['groups'], queryFn: listGroups });

  const [editingStageOrder, setEditingStageOrder] = useState<number | null>(null);
  const [stageOrder, setStageOrder] = useState(1);
  const [stageName, setStageName] = useState('');
  const [assigneeType, setAssigneeType] = useState<'user' | 'role' | 'group'>('user');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [assigneeRoleId, setAssigneeRoleId] = useState('');
  const [assigneeGroupId, setAssigneeGroupId] = useState('');
  const [allowedActions, setAllowedActions] = useState<string[]>([...ALL_ACTIONS]);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setEditingStageOrder(null);
    setStageName('');
    setAssigneeType('user');
    setAssigneeUserId('');
    setAssigneeRoleId('');
    setAssigneeGroupId('');
    setAllowedActions([...ALL_ACTIONS]);
  }

  const addStageMutation = useMutation({
    mutationFn: () =>
      addWorkflowStage(id!, {
        stageOrder,
        name: stageName,
        assigneeType,
        assigneeUserId: assigneeType === 'user' ? assigneeUserId : undefined,
        assigneeRoleId: assigneeType === 'role' ? assigneeRoleId : undefined,
        assigneeGroupId: assigneeType === 'group' ? assigneeGroupId : undefined,
        allowedActions,
      }),
    onSuccess: () => {
      resetForm();
      setStageOrder((workflowTemplate?.stages.length ?? 0) + 2);
      queryClient.invalidateQueries({ queryKey: ['workflowTemplate', id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to add stage'),
  });

  const updateStageMutation = useMutation({
    mutationFn: () =>
      updateWorkflowStage(id!, editingStageOrder!, {
        name: stageName,
        assigneeType,
        assigneeUserId: assigneeType === 'user' ? assigneeUserId : undefined,
        assigneeRoleId: assigneeType === 'role' ? assigneeRoleId : undefined,
        assigneeGroupId: assigneeType === 'group' ? assigneeGroupId : undefined,
        allowedActions,
      }),
    onSuccess: () => {
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['workflowTemplate', id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to update stage'),
  });

  function toggleAction(action: string) {
    setAllowedActions((current) =>
      current.includes(action) ? current.filter((a) => a !== action) : [...current, action],
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (editingStageOrder !== null) {
      updateStageMutation.mutate();
    } else {
      addStageMutation.mutate();
    }
  }

  function startEditingStage(stage: WorkflowStage) {
    setError(null);
    setEditingStageOrder(stage.stage_order);
    setStageName(stage.name);
    setAssigneeType(stage.assignee_type);
    setAssigneeUserId(stage.assignee_user_id ?? '');
    setAssigneeRoleId(stage.assignee_role_id ?? '');
    setAssigneeGroupId(stage.assignee_group_id ?? '');
    setAllowedActions(stage.allowed_actions);
  }

  function assigneeLabel(stage: WorkflowStage): string {
    if (stage.assignee_type === 'user') {
      const user = users?.find((u) => u.id === stage.assignee_user_id);
      return user ? `user: ${user.full_name || user.email}` : 'assigned user';
    }
    if (stage.assignee_type === 'role') {
      const role = roles?.find((r) => r.id === stage.assignee_role_id);
      return role ? `role: ${role.name}` : 'assigned role';
    }
    const group = groups?.find((g) => g.id === stage.assignee_group_id);
    return group ? `group: ${group.name}` : 'assigned group';
  }

  const isSaving = addStageMutation.isPending || updateStageMutation.isPending;

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!workflowTemplate) return <p className="text-sm text-red-700">Workflow template not found.</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">{workflowTemplate.name}</h1>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Stages</h2>
      <ul className="mb-6 divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {workflowTemplate.stages.map((stage) => (
          <li key={stage.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>
              <span className="font-medium">
                {stage.stage_order}. {stage.name}
              </span>{' '}
              — {assigneeLabel(stage)} — actions: {stage.allowed_actions.join(', ')}
            </span>
            <button onClick={() => startEditingStage(stage)} className="text-sm text-blue-700 hover:underline">
              Edit
            </button>
          </li>
        ))}
        {workflowTemplate.stages.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-500">No stages configured yet.</li>
        )}
      </ul>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">
        {editingStageOrder !== null ? `Edit stage ${editingStageOrder}` : 'Add stage'}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        {editingStageOrder === null && (
          <label className="block text-sm">
            Stage order
            <input
              type="number"
              min={1}
              required
              value={stageOrder}
              onChange={(e) => setStageOrder(Number(e.target.value))}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
        )}
        <label className="block text-sm">
          Stage name
          <input
            type="text"
            required
            value={stageName}
            onChange={(e) => setStageName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="assigneeType"
              checked={assigneeType === 'user'}
              onChange={() => setAssigneeType('user')}
            />
            Assign to user
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="assigneeType"
              checked={assigneeType === 'role'}
              onChange={() => setAssigneeType('role')}
            />
            Assign to role
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="assigneeType"
              checked={assigneeType === 'group'}
              onChange={() => setAssigneeType('group')}
            />
            Assign to group
          </label>
        </div>
        {assigneeType === 'user' ? (
          <label className="block text-sm">
            User
            <select
              required
              value={assigneeUserId}
              onChange={(e) => setAssigneeUserId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select a user</option>
              {users?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name ? `${user.full_name} (${user.email})` : user.email}
                </option>
              ))}
            </select>
          </label>
        ) : assigneeType === 'role' ? (
          <label className="block text-sm">
            Role
            <select
              required
              value={assigneeRoleId}
              onChange={(e) => setAssigneeRoleId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select a role</option>
              {roles?.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block text-sm">
            Group
            <select
              required
              value={assigneeGroupId}
              onChange={(e) => setAssigneeGroupId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select a group</option>
              {groups?.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">Allowed actions</legend>
          {ALL_ACTIONS.map((action) => (
            <label key={action} className="mr-4 inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={allowedActions.includes(action)}
                onChange={() => toggleAction(action)}
              />
              {action}
            </label>
          ))}
        </fieldset>
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {editingStageOrder !== null ? 'Save changes' : 'Add stage'}
          </button>
          {editingStageOrder !== null && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                resetForm();
              }}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
