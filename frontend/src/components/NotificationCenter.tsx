import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  InAppNotification,
} from '../api/notifications';

function formatTimeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays}d ago`;
}

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [filterUnread, setFilterUnread] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Query unread count with a 15-second polling interval
  const { data: countData } = useQuery({
    queryKey: ['notificationsUnreadCount'],
    queryFn: getUnreadNotificationCount,
    refetchInterval: 15000,
  });

  // Query notification list when popover is open
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notificationsList', filterUnread],
    queryFn: () => listNotifications({ unreadOnly: filterUnread, limit: 40 }),
    enabled: isOpen,
    refetchInterval: isOpen ? 10000 : false,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationsUnreadCount'] });
      queryClient.invalidateQueries({ queryKey: ['notificationsList'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationsUnreadCount'] });
      queryClient.invalidateQueries({ queryKey: ['notificationsList'] });
    },
  });

  const unreadCount = countData?.unreadCount ?? 0;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleNotificationClick = (notification: InAppNotification) => {
    if (!notification.is_read) {
      markReadMutation.mutate(notification.id);
    }
    setIsOpen(false);
    if (notification.workflow_instance_id) {
      navigate(`/instances/${notification.workflow_instance_id}`);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Notifications"
        className="relative rounded-full p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-gray-200 bg-white shadow-xl ring-1 ring-black/5 z-50 overflow-hidden">
          {/* Panel Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 bg-gray-50/70">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-gray-900">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                  {unreadCount} new
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllReadMutation.mutate()}
                  disabled={markAllReadMutation.isPending}
                  className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex border-b border-gray-100 px-4 py-1.5 gap-2 bg-white text-xs">
            <button
              onClick={() => setFilterUnread(false)}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                !filterUnread ? 'bg-gray-200 text-gray-800 font-semibold' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterUnread(true)}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                filterUnread ? 'bg-blue-600 text-white font-semibold' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              Unread {unreadCount > 0 && `(${unreadCount})`}
            </button>
          </div>

          {/* Notifications List */}
          <div className="max-h-96 overflow-y-auto divide-y divide-gray-100">
            {isLoading ? (
              <div className="p-6 text-center text-xs text-gray-400">Loading notifications...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500 space-y-1">
                <div className="text-xl">🔔</div>
                <div className="font-medium text-gray-700">No notifications</div>
                <div className="text-gray-400">You're all caught up!</div>
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`group relative flex items-start gap-3 p-3.5 text-left transition-colors cursor-pointer ${
                    notif.is_read ? 'bg-white hover:bg-gray-50' : 'bg-blue-50/40 hover:bg-blue-50/70'
                  }`}
                >
                  {/* Unread indicator dot */}
                  <div className="pt-1 flex-shrink-0">
                    {!notif.is_read ? (
                      <span className="block h-2 w-2 rounded-full bg-blue-600 ring-2 ring-blue-200"></span>
                    ) : (
                      <span className="block h-2 w-2 rounded-full bg-gray-200"></span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <div className="text-xs font-semibold text-gray-900 truncate">
                        {notif.subject}
                      </div>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">
                        {formatTimeAgo(notif.created_at)}
                      </span>
                    </div>

                    <p className="mt-0.5 text-xs text-gray-600 line-clamp-2">{notif.body}</p>

                    {notif.ticket_number && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
                          WF-{String(notif.ticket_number).padStart(6, '0')}
                        </span>
                        {notif.document_type_name && (
                          <span className="text-[10px] text-gray-500 truncate">
                            {notif.document_type_name}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Mark as read button */}
                  {!notif.is_read && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        markReadMutation.mutate(notif.id);
                      }}
                      title="Mark as read"
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 p-1 rounded transition-opacity"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

