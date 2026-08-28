import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMyTasks, TaskListItem } from '../api/instances';

function TaskCard({ task }: { task: TaskListItem }) {
  return (
    <Link
      to={`/instances/${task.id}`}
      className="block rounded border border-gray-200 bg-white p-4 text-sm hover:border-blue-300"
    >
      <div className="font-medium text-gray-900">{task.document_type_name}</div>
      <div className="mt-1 text-gray-600">
        {task.currentStage ? `Stage: ${task.currentStage.name}` : null} — status: {task.status}
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
