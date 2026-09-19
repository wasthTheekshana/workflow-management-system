import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMyTasks, TaskListItem } from '../api/instances';
import { getSlaBadgeInfo } from '../utils/sla';

function TaskCard({ task }: { task: TaskListItem }) {
  const sla = getSlaBadgeInfo(task.stage_due_at, task.is_overdue, task.status);

  return (
    <Link
      to={`/instances/${task.id}`}
      className="block rounded border border-gray-200 bg-white p-4 text-sm hover:border-blue-300 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-gray-900">
          WF-{String(task.ticket_number).padStart(6, '0')} — {task.document_type_name}
        </div>
        {sla && (
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${sla.className}`}>
            {sla.label}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-gray-600">
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{task.currentStage ? `Stage: ${task.currentStage.name}` : null} — status: {task.status}</span>
          {task.currentStage?.consensus_type === 'all' && (
            <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-semibold text-purple-700 border border-purple-200">
              AND Consensus
            </span>
          )}
          {task.currentStage?.consensus_type === 'any' && (
            <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-[11px] font-semibold text-cyan-700 border border-cyan-200">
              OR Consensus
            </span>
          )}
          {task.has_approved && (
            <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-semibold text-green-700 border border-green-200">
              ✓ Approved
            </span>
          )}
        </div>
        {task.currentStage?.sla_hours && (
          <span className="text-xs text-gray-400">
            SLA target: {task.currentStage.sla_hours}h
          </span>
        )}
      </div>
    </Link>
  );
}

function TaskSection({ title, tasks }: { title: string; tasks: TaskListItem[] }) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">
        {title} ({tasks.length})
      </h2>
      {tasks.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing here.</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MyTasksPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['myTasks'], queryFn: getMyTasks });

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">My Tasks</h1>
        <Link
          to="/instances/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Start new document
        </Link>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">Failed to load your tasks.</p>}

      {data && (
        <>
          <TaskSection title="Assigned to Me" tasks={data.assignedToMe} />
          <TaskSection title="Waiting on Others" tasks={data.waitingOnOthers} />
          <TaskSection title="Completed" tasks={data.completed} />
        </>
      )}
    </div>
  );
}
