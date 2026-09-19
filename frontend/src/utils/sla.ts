export interface SlaBadgeInfo {
  label: string;
  isOverdue: boolean;
  isApproaching: boolean;
  className: string;
}

export function getSlaBadgeInfo(
  stageDueAt?: string | null,
  isOverdue?: boolean,
  status?: string,
): SlaBadgeInfo | null {
  if (status && status !== 'in_progress') {
    return null;
  }
  if (!stageDueAt) {
    return null;
  }

  const dueTime = new Date(stageDueAt).getTime();
  if (isNaN(dueTime)) {
    return null;
  }

  const now = Date.now();
  const diffMs = dueTime - now;

  if (isOverdue || diffMs <= 0) {
    const hoursOverdue = Math.max(1, Math.round(Math.abs(diffMs) / (3600 * 1000)));
    const label =
      hoursOverdue >= 24
        ? `Overdue by ${Math.floor(hoursOverdue / 24)}d ${hoursOverdue % 24}h`
        : `Overdue by ${hoursOverdue}h`;

    return {
      label,
      isOverdue: true,
      isApproaching: false,
      className: 'bg-red-100 text-red-800 border border-red-200 font-semibold',
    };
  }

  const hoursRemaining = Math.max(1, Math.round(diffMs / (3600 * 1000)));
  if (hoursRemaining <= 24) {
    return {
      label: `Due in ${hoursRemaining}h`,
      isOverdue: false,
      isApproaching: true,
      className: 'bg-amber-100 text-amber-800 border border-amber-200 font-medium',
    };
  }

  const daysRemaining = Math.round(hoursRemaining / 24);
  return {
    label: `Due in ${daysRemaining}d (${hoursRemaining}h)`,
    isOverdue: false,
    isApproaching: false,
    className: 'bg-blue-50 text-blue-700 border border-blue-200 font-medium',
  };
}

