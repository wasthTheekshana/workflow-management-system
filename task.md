# Workflow Management System — Task Tracker

Status indicators:
- [x] **Complete**
- [/] **In Progress**
- [ ] **Pending**

---

## 1. Current System Inventory

### Core Platform & Security
- [x] Multi-tenant database foundation (composite foreign keys, tenant isolation)
- [x] Docker Compose setup (PostgreSQL 16, Express API, OnlyOffice DocumentServer)
- [x] JWT authentication (HS256 pinned, secure cookies/headers)
- [x] Role-Based Access Control (Admin, standard users, custom roles)
- [x] Centralized error handling and secure input validation
- [ ] User self-service password reset ("Forgot password" flow)
- [ ] User profile and password management

### Workflow Configuration (Admin)
- [x] Template file library (.docx and Rich-Text templates, immutable versioning)
- [x] Workflow template builder (stages, order, user/role/group assignments)
- [x] Document type management (linking template to workflow template, predefined vs. ad-hoc)
- [x] User management (list users, create new users)
- [x] Role management
- [x] Group management (create, list, rename, delete, add/remove members)
- [x] **User Group Levels & Hierarchy (Lv1, Lv2, etc. member levels)**
- [x] **Assign workflow stages by User Group + Group Level**

### Workflow Execution Engine
- [x] Start instance from predefined template
- [x] Start instance from ad-hoc / self-service upload or rich-text editor
- [x] Ticket number generation (e.g. `WF-000001` / `DOC-2026-0001`)
- [x] Forward transition (auto-completes at last stage)
- [x] Send-back transition (strictly 1 stage backwards)
- [x] Hard reject transition
- [x] Resubmit / clone-after-reject transition
- [x] Role-based and Group-based stage claiming
- [x] **Group level-restricted stage claiming (only members of the specified level can claim)**
- [x] **Task unclaim / release back to pool (users can release claimed tasks; admins can unclaim)**
- [ ] Instance cancel / withdraw / abort by creator or admin
- [x] **Instance cancel / withdraw / abort by creator or admin (with audit trail, creator notifications, and resubmit support)**
- [ ] Flexible send-back to any arbitrary previous stage
- [x] **Flexible send-back to any arbitrary previous stage (with target stage selection, audit trail, and frontend modal)**
- [x] **Parallel stage execution (AND / OR consensus / split & join with individual approval tracking)**

### Document Editing & Collaboration
- [x] Binary file download and versioned re-upload
- [x] In-browser .docx editing via OnlyOffice DocumentServer with callback versioning
- [x] In-browser Rich-Text editor (Quill/HTML) with content versioning
- [x] Instance comments thread with involvement-based email notifications
- [x] Full audit trail (`stage_actions`) and version history inspection
- [x] **Multi-file supporting attachments (quotes, IDs, receipts with upload, download, delete, audit trail)**
- [x] **Visual document version diff / redline viewer (word-level inline redline + side-by-side split view with revision stats)**

### Monitoring & Dashboards
- [x] User "My Tasks" dashboard (Assigned to Me, Waiting on Others, Completed)
- [x] Backend Admin instances endpoint (`GET /admin/instances`, `POST /admin/instances/:id/reassign`)
- [x] **Admin Instances Frontend Page (`AdminInstancesPage.tsx` with stats cards, status/doc filters, search, table, reassignment modal)**
- [x] **Stage SLA tracking and overdue indicators**
- [x] **Operational bottleneck BI and cycle time analytics**
- [x] **In-app notification center (bell icon with unread badges)**

---

## 9. Completed Feature: In-App Notification Center
- [x] **Task 1: Database Migration (Schema Updates)**
  - [x] Created `backend/migrations/022_add_read_status_to_notifications.js` adding `is_read` (boolean, default false), `read_at` (timestamp, nullable), and `recipient_user_id` (foreign key to `users`) with composite indexes on `[tenant_id, recipient_email, is_read]` and `[tenant_id, recipient_user_id, is_read]`.
  - [x] Applied migration to development and test databases (`knex migrate:latest`).
- [x] **Task 2: Backend Service & Route Implementations**
  - [x] Enhanced `notificationService.js`:
    - [x] Updated `resolveStageRecipientEmails` and `enqueueNotification` to associate `recipient_user_id`.
    - [x] Implemented `listNotificationsForUser` joining workflow instances and document types for rich ticket metadata.
    - [x] Implemented `getUnreadCountForUser` for instant badge counts.
    - [x] Implemented `markNotificationAsRead` and `markAllNotificationsAsRead`.
  - [x] Created `backend/src/routes/notifications.js`:
    - [x] `GET /notifications` (lists notifications, supports `unreadOnly` and `limit`).
    - [x] `GET /notifications/unread-count` (returns `{ unreadCount }`).
    - [x] `PATCH /notifications/:id/read` (marks single notification as read).
    - [x] `POST /notifications/mark-all-read` (marks all notifications read).
  - [x] Mounted `/notifications` in `backend/src/app.js` with session authentication.
- [x] **Task 3: Automated Test Suite**
  - [x] Dedicated test suite `tests/inAppNotifications.test.js` (7/7 tests passing covering 401 unauthenticated check, unread count retrieval, notification list querying, marking single item read, multi-user isolation on read mutations, marking all read, and cross-tenant isolation).
  - [x] Full backend test suite: **56 passed, 56 total (239/239 tests passing, 100% green)**.
- [x] **Task 4: Frontend API & Interactive Navbar Bell Component**
  - [x] Created `frontend/src/api/notifications.ts` (`listNotifications`, `getUnreadNotificationCount`, `markNotificationAsRead`, `markAllNotificationsAsRead`).
  - [x] Created `frontend/src/components/NotificationCenter.tsx`:
    - [x] Interactive bell button in navbar with dynamic unread count badge (`9+` formatting) and pulse alert.
    - [x] Floating dropdown popover with outside-click listener.
    - [x] Header with unread count and "Mark all read" button.
    - [x] "All" vs "Unread" filter pills.
    - [x] Notification items with relative timestamps ("5m ago", "2h ago"), unread status dots, ticket badges (`WF-000001 — Purchase Order`), and inline mark-read checkmark.
    - [x] Clicking a notification marks it read and routes straight to `/instances/:id`.
    - [x] Polling interval (15s) for real-time notifications.
  - [x] Added `NotificationCenter` into navbar in `frontend/src/components/Layout.tsx`.
  - [x] Frontend build: **Passed with 0 errors (`tsc -b && vite build` 100% clean)**.

---

## 10. Completed Feature: Parallel Stage Execution (AND / OR Consensus / Split & Join)
- [x] **Task 1: Database Migration (Schema Updates)**
  - [x] Created `backend/migrations/023_add_consensus_and_stage_approvals.js` adding `consensus_type` ('single', 'all', 'any') to `workflow_stages` and creating `instance_stage_approvals` table with composite foreign keys, unique constraint on `[tenant_id, workflow_instance_id, stage_order, user_id]`, and index on `[tenant_id, workflow_instance_id, stage_order]`.
  - [x] Applied migration to development and test databases (`knex migrate:latest`).
- [x] **Task 2: Backend Engine & Consensus Services**
  - [x] Enhanced `workflowTemplateService.js`: validated and persisted `consensusType` in `addWorkflowStage` and `updateWorkflowStage`.
  - [x] Enhanced `workflowInstanceService.js`:
    - [x] Implemented `getEligibleApprovers` querying active eligible approvers across user, role, and group assignments (including level filtering).
    - [x] Implemented `isUserEligibleApprover` authorizing approvers without requiring exclusive claiming.
    - [x] Implemented `getStageApprovals` returning consensus progress, total required, approved count, and approver details.
    - [x] Enhanced `claimInstance`: blocked exclusive claiming on AND consensus stages where multi-approver parallel review is active.
    - [x] Enhanced `forwardInstance`: records individual decisions in `instance_stage_approvals`, advances immediately for OR consensus, accumulates votes for AND consensus, and advances only upon unanimous agreement.
    - [x] Enhanced `sendBackInstance`: resets stage approvals for reverted stages.
    - [x] Enhanced `rejectInstance`: records individual rejection decision and transitions instance status.
    - [x] Enhanced `createAdhocWorkflowTemplate` supporting ad-hoc consensus stages.
  - [x] Enhanced `dashboardService.js`: updated `listMyTasks` to account for parallel review eligibility and individual user approval status.
- [x] **Task 3: Backend Routes & Automated Test Suite**
  - [x] Mounted `GET /instances/:id/stage-approvals` and enriched `GET /instances/:id` with `stageApprovals`.
  - [x] Created `tests/parallelStages.test.js` (11/11 tests passing covering AND consensus accumulation, duplicate approval rejection, non-member 403 barriers, claim prevention, OR consensus fast-track, consensus rejection, send-back approval purging, and tenant isolation).
  - [x] Full backend test suite: **57 passed, 57 total (250/250 tests passing, 100% green)**.
- [x] **Task 4: Frontend UI & API Integration**
  - [x] Updated `frontend/src/api/workflowTemplates.ts` & `frontend/src/api/instances.ts` with `consensus_type`, `StageApprovalsSummary`, and `getStageApprovals`.
  - [x] Updated `WorkflowTemplateDetailPage.tsx`: added "Consensus Policy" selector (Single, AND Consensus, OR Consensus) and consensus badges on stages.
  - [x] Updated `InstanceDetailPage.tsx`: added **Consensus Progress Tracker Card** with progress bar, eligible approvers checklist, timestamped approvals, pending indicators, and dynamic "Approve Stage" button.
  - [x] Updated `MyTasksPage.tsx`: added AND/OR consensus badges and approved pills.
  - [x] Frontend production build: **Passed in 3.66s with 0 TypeScript errors (`tsc -b && vite build` 100% clean)**.

## 11. Completed Feature: Visual Document Version Diff & Redline Viewer
- [x] **Task 1: Backend Diff Algorithm & Service (`documentDiffService.js`)**
  - [x] Implemented `extractText` supporting rich-text JSON nodes, HTML tags, and strings.
  - [x] Implemented `computeWordDiff` using dynamic programming LCS algorithm to highlight added/removed words.
  - [x] Implemented `computeLineDiff` for side-by-side line comparison with line numbering.
  - [x] Implemented `listInstanceVersions` returning version history with uploader emails and timestamps.
  - [x] Implemented `compareInstanceVersions` resolving base and target versions (including v0 initial template), calculating additions/deletions/changes statistics.
- [x] **Task 2: Backend Express Routes (`routes/instances.js`)**
  - [x] Mounted `GET /instances/:id/versions` with multi-tenant isolation.
  - [x] Mounted `GET /instances/:id/diff` with `fromVersion` and `toVersion` query parameters.
- [x] **Task 3: Automated Jest Test Suite (`tests/documentDiff.test.js`)**
  - [x] 9/9 tests passing covering word diff, line diff, HTML extraction, version listing, default comparison, template v0 comparison, 404 validation, and cross-tenant security isolation.
- [x] **Task 4: Frontend API & Interactive Redline Modal (`DocumentDiffViewer.tsx`)**
  - [x] Created `frontend/src/api/diff.ts` (`getInstanceVersions`, `getInstanceDiff`, types `DocumentDiffResult`, `DiffChunk`, `LineDiffItem`).
  - [x] Created `DocumentDiffViewer.tsx`:
    - [x] Version selector dropdowns (`Base: v0..vN` → `Compare with: v1..vN`) with author & timestamp info.
    - [x] Revision statistics badges (`+N added`, `−M removed`).
    - [x] Inline Word-Level Redline view (`<ins>` emerald highlight for additions, `<del>` rose strikethrough for removals).
    - [x] Side-by-Side (Split) 2-column view with synchronized line numbers and author headers.
    - [x] Identical content zero-state message.
  - [x] Integrated into `InstanceDetailPage.tsx`:
    - [x] "Compare Revisions" button in primary action toolbar.
    - [x] "Compare Revisions / Redline Diff" trigger in Version History section.
  - [x] Frontend build: **Passed in 32.90s with 0 errors (`tsc -b && vite build` 100% clean)**.

## 8. Completed Feature: Operational Bottleneck & Cycle Time Analytics
- [x] **Task 1: Backend Analytics Service (`analyticsService.js`)**
  - [x] Computed executive KPIs: `totalInstances`, `inProgressInstances`, `completedInstances`, `rejectedInstances`, `cancelledInstances`, `avgCycleTimeHours`, `medianCycleTimeHours`, `completionRate`, `activeOverdueCount`, `overdueRate`.
  - [x] Computed stage velocity & turnaround metrics: `activeQueueCount`, `activeOverdueCount`, `avgActiveWaitHours`, `completedTransitionsCount`, `avgTurnaroundHours`, `slaBreachCount`, `slaComplianceRate`.
  - [x] Health status classification: `'bottleneck'` (active overdue or high queue exceeding SLA), `'at_risk'`, or `'healthy'`.
  - [x] Computed template-level breakdown: total, in-progress, completed, cycle times, and overdue count per template.
- [x] **Task 2: Backend Route & Admin Authorization**
  - [x] Created `backend/src/routes/admin/analytics.js` mounting `GET /admin/analytics` and `GET /admin/analytics/overview`.
  - [x] Enforces JWT authentication and `requireAdmin` authorization.
  - [x] Supports filtering by `workflowTemplateId`, `startDate`, and `endDate`.
- [x] **Task 3: Automated Test Suite**
  - [x] Dedicated test suite `tests/analytics.test.js` (6/6 tests passing covering 403 authorization, KPI computations, stage turnaround & bottleneck status, template breakdown, filtering, and multi-tenant isolation).
  - [x] Full backend test suite: **55 passed, 55 total (232/232 tests passing, 100% green)**.
- [x] **Task 4: Frontend API & Interactive BI Dashboard**
  - [x] Created `frontend/src/api/analytics.ts` (`getWorkflowAnalytics`, `AnalyticsKPIs`, `StageMetric`, `TemplateMetric`).
  - [x] Created `frontend/src/pages/admin/AnalyticsPage.tsx`:
    - [x] 5 Executive KPI stat cards (Avg Cycle Time, Active Tasks, Active Overdue, Completion Rate, Bottleneck Stage count).
    - [x] Workflow template selector filter dropdown.
    - [x] Stage Diagnosis table with health pills (`Bottleneck`, `At Risk`, `Healthy`), active queue size, overdue count, wait times, turnaround times, and visual SLA compliance progress bars.
    - [x] Health filter pills (`All`, `Bottlenecks`, `At Risk`, `Healthy`).
    - [x] Workflow Template Summary table.
  - [x] Added `Analytics` nav link to `Layout.tsx` and route `/admin/analytics` in `App.tsx`.
  - [x] Frontend build: **Passed with 0 errors (`tsc -b && vite build` 100% clean)**.

---

## 9. Next Up in Queue: Missing Capabilities
- [ ] **In-App Notification Center**: Real-time in-app notification dropdown / bell icon with unread count badges, read/unread state management, and direct link navigation to workflow instances.

---

## 2. Completed Feature: User Group Levels & Hierarchical Stage Assignment
- [x] **Task 1: Database Migration (Schema Updates)**: Added `level` to `user_groups` and `assignee_group_level` to `workflow_stages` (Migration 019).
- [x] **Task 2: Backend Group Service & APIs**: Implemented level support in `groupService.addMember`, added `updateMemberLevel`, and added `PUT /admin/groups/:id/members/:userId`.
- [x] **Task 3: Backend Workflow Stage Assignment & Authorization**: Enforced `stage.assignee_group_level` in `claimInstance`, filtered `listMyTasks` and notifications by group level.
- [x] **Task 4: Frontend Group Management UI**: Added level selector (Levels 1–5) and inline level updater to `GroupDetailPage.tsx`.
- [x] **Task 5: Frontend Workflow Stage Builder UI**: Added "Required Group Level" dropdown in `WorkflowTemplateDetailPage.tsx`, updated `StageBuilder.tsx` and `NewInstancePage.tsx`.
- [x] **Task 6: Verification & Automated Testing**: Added `tests/groupLevels.test.js`.

---

## 3. Completed Feature: Admin Instances Page & Task Unclaim / Release
- [x] **Task 1: Frontend API for Admin Instances & Unclaim**
  - [x] Added `AdminInstanceListItem` interface with creator, claimant, and `currentStage` metadata.
  - [x] Added `listAdminInstances(params: { status?: string; documentTypeId?: string })`.
  - [x] Added `reassignInstance(id: string, userId: string, comment?: string)`.
  - [x] Added `unclaimInstance(id: string)`.
- [x] **Task 2: Admin Instances Overview & Filtering (`AdminInstancesPage.tsx`)**
  - [x] Stat summary cards: Total, In Progress, Completed, Rejected instances.
  - [x] Status filter pills (`all`, `in_progress`, `completed`, `rejected`).
  - [x] Document type selector dropdown filter.
  - [x] Live search input across ticket number, document type name, creator, claimant, and current stage.
  - [x] Data table with ticket link, document type, stage (with group level badge), status badge, submitter, claimant, date, and actions.
- [x] **Task 3: Admin Reassignment Modal**
  - [x] Modal dialog to select target user from all tenant users (`listUsers()`).
  - [x] Reason / comment input for audit trail.
  - [x] Triggers `POST /admin/instances/:id/reassign`, invalidates cache, and records audit trail.
- [x] **Task 4: Task Unclaim / Release Feature**
  - [x] Backend endpoint `POST /instances/:id/unclaim` with role/group checks and audit action (`unclaim`).
  - [x] "Release / Unclaim" action button on `InstanceDetailPage.tsx` for claimant and admins.
  - [x] Dedicated test suite `tests/instances.unclaim.test.js` (4/4 tests passing).
  - [x] Full test suite passing: **51/51 test suites, 206/206 tests passing**. Frontend builds with 0 errors.

---

## 4. Completed Feature: Instance Cancellation / Abort / Withdrawal
- [x] **Task 1: Backend Service & Route (`workflowInstanceService.cancelInstance`)**
  - [x] Allows submitter (`created_by === userId`) or tenant administrator (`isAdmin === true`) to cancel in-progress workflow.
  - [x] Sets status to `'cancelled'`, clears `claimed_by = null`, updates `updated_at`.
  - [x] Records audit trail entry in `stage_actions` with `action_type = 'cancel'`, actor ID, and optional comment.
  - [x] Sends email notification to the submitter if cancelled administratively by an admin.
  - [x] Blocks progression (claim, forward, send back, reject) on cancelled instances.
  - [x] Extended `resubmitInstance` to allow cloning and resubmitting cancelled instances back to stage 1.
  - [x] Included `'cancelled'` in `dashboardService.listMyTasks` completed section.
  - [x] Added `POST /instances/:id/cancel` route.
- [x] **Task 2: Frontend API & Detail Page UI**
  - [x] Added `cancelled` to `WorkflowInstance.status` union.
  - [x] Added `cancelInstance(id: string, comment?: string)` in `instances.ts`.
  - [x] Added "Cancel Workflow" action button and modal dialog on `InstanceDetailPage.tsx`.
  - [x] Enabled "Resubmit" button for cancelled instances so submitters can re-launch.
- [x] **Task 3: Admin Instances Page Integration**
  - [x] Added `'cancelled'` to status filter pills and status count cards.
  - [x] Added "Cancel" button to table row actions with admin cancellation confirmation modal.
- [x] **Task 4: Automated Testing & Build Verification**
  - [x] Added dedicated test suite `tests/instances.cancel.test.js` (3/3 tests passing).
  - [x] Backend test suite: **52 passed, 52 total (209/209 tests passing, 100% green)**.
  - [x] Frontend build: **Passed with 0 errors**.

---

## 5. Completed Feature: Multi-File Supporting Attachments
- [x] **Task 1: Database Migration (Schema Updates)**
  - [x] Created `backend/migrations/020_create_instance_attachments.js` with composite FKs `[tenant_id, workflow_instance_id]`, `file_name`, `file_path`, `file_size_bytes`, `mime_type`, `uploaded_by`.
  - [x] Applied migration to dev and test databases (`knex migrate:latest`).
- [x] **Task 2: Backend Service & Route Implementations**
  - [x] Created `backend/src/services/attachmentService.js` supporting `listAttachments`, `addAttachment` (15MB limit, whitelist extensions), `getAttachmentFile`, and `deleteAttachment` (uploader or admin permission).
  - [x] Records audit trail entries (`add_attachment`, `delete_attachment`) in `stage_actions`.
  - [x] Added Express routes in `backend/src/routes/instances.js`: `GET /instances/:id/attachments`, `POST /instances/:id/attachments` (multer), `GET /instances/:id/attachments/:attachmentId/download`, and `DELETE /instances/:id/attachments/:attachmentId`.
- [x] **Task 3: Automated Test Suite**
  - [x] Added `backend/tests/attachments.test.js` (8/8 tests passing covering upload, list, download, authorization, delete, audit trail, and blocking uploads on closed workflows).
  - [x] Full backend test suite: **53 passed, 53 total (217/217 tests passing, 100% green)**.
- [x] **Task 4: Frontend API & Detail Page UI**
  - [x] Created `frontend/src/api/attachments.ts` with `InstanceAttachment`, `listAttachments`, `uploadAttachment`, `downloadAttachment`, and `deleteAttachment`.
  - [x] Added "Supporting Attachments" card to `InstanceDetailPage.tsx` with dynamic count badge, size formatting (`formatBytes`), download link, uploader details, delete button for uploader/admin, and file picker.
  - [x] Frontend build: **Passed with 0 errors (`tsc -b && vite build` 100% clean)**.

---

## 6. Completed Feature: Flexible Send-Back (N-1 or Arbitrary Previous Stage)
- [x] **Task 1: Backend Transition Engine & Route Updates**
  - [x] Extended `workflowInstanceService.sendBackInstance(tenantId, instanceId, userId, comment, targetStageOrder)`.
  - [x] Validated target stage: integer, $1 \le \text{targetStageOrder} < \text{current\_stage\_order}$, stage must exist in workflow template. Defaults to $N-1$ when omitted.
  - [x] Recorded exact `from_stage_order` and `to_stage_order` in `stage_actions` audit log.
  - [x] Updated `POST /instances/:id/send-back` to parse `targetStageOrder` from request body.
  - [x] Included `workflowStages` in `GET /instances/:id` and `GET /instances/:id/history` responses.
- [x] **Task 2: Automated Testing**
  - [x] Dedicated test suite `tests/instances.sendBack.test.js` (4/4 tests passing: default $N-1$, rejection at stage 1, arbitrary send-back from stage 3 to stage 1, invalid target range validation).
  - [x] Full backend test suite: **53 passed, 53 total (219/219 tests passing, 100% green)**.
- [x] **Task 3: Frontend API & Interactive Modal UI**
  - [x] Updated `frontend/src/api/instances.ts`: added `workflowStages` to `InstanceWithStage` and `InstanceHistory`, updated `sendBackInstance(id, comment, targetStageOrder)`.
  - [x] Added Send-Back modal in `frontend/src/pages/InstanceDetailPage.tsx`: shows dropdown with all prior stages, reason/feedback textarea, and confirm button.
  - [x] Frontend build: **Passed with 0 errors (`tsc -b && vite build` clean)**.

---

## 7. Completed Feature: Stage SLA & Due Date Tracking
- [x] **Task 1: Database Migration (Schema Updates)**
  - [x] Created `backend/migrations/021_add_sla_to_stages_and_instances.js` adding `sla_hours` (integer) to `workflow_stages`, and `stage_entered_at`, `stage_due_at` (timestamps with index `[tenant_id, stage_due_at]`) to `workflow_instances`.
  - [x] Applied migration to dev and test databases (`knex migrate:latest`).
- [x] **Task 2: Backend Engine & API Implementations**
  - [x] `workflowTemplateService.js`: `addWorkflowStage` and `updateWorkflowStage` validate positive integer `slaHours` and persist `sla_hours`.
  - [x] `workflowInstanceService.js`: `calculateStageDueAt(stage, enteredAt)` helper sets `stage_entered_at` and `stage_due_at` on `startInstance`, `startInstanceFromOwnDocument`, `forwardInstance`, `sendBackInstance`, and `resubmitInstance`. Clears `stage_due_at` to null on completion, `rejectInstance`, and `cancelInstance`.
  - [x] `dashboardService.js`: `listMyTasks`, `getInstanceHistory`, and `listInstancesForAdmin` calculate `is_overdue: Boolean(instance.stage_due_at && new Date(instance.stage_due_at) < now && instance.status === 'in_progress')`. `listInstancesForAdmin` supports `isOverdue` filter.
  - [x] Express routes: `routes/admin/workflowTemplates.js` supports updating SLA target via `PUT`/`PATCH`, `routes/instances.js` and `routes/admin/instances.js` expose SLA fields.
- [x] **Task 3: Automated Test Suite**
  - [x] Dedicated test suite `tests/stageSla.test.js` (7/7 tests passing covering SLA stage validation, workflow instance creation, stage due dates on forward/send-back, due date clearing on completion/cancellation, and overdue filtering).
  - [x] Full backend test suite: **54 passed, 54 total (226/226 tests passing, 100% green)**.
- [x] **Task 4: Frontend API & UI Integrations**
  - [x] Extended `WorkflowStage`, `AddStageInput`, `UpdateStageInput`, `WorkflowInstance`, and `StageInfo` with `sla_hours`, `slaHours`, `stage_entered_at`, `stage_due_at`, `is_overdue`.
  - [x] Created SLA helper `frontend/src/utils/sla.ts` (`getSlaBadgeInfo`) computing overdue status, warning badges (<24h), and standard countdowns with color-coded styles.
  - [x] Added SLA target input and stage badges in `WorkflowTemplateDetailPage.tsx` and `StageBuilder.tsx`.
  - [x] Added SLA status badge to `TaskCard` in `MyTasksPage.tsx`.
  - [x] Added Overdue summary card, Overdue filter button, and SLA table indicators in `AdminInstancesPage.tsx`.
  - [x] Added SLA status banner and countdown tracking to `InstanceDetailPage.tsx`.
  - [x] Frontend build: **Passed with 0 errors (`tsc -b && vite build` 100% clean)**.

---

## 8. Next Up in Queue: Missing Capabilities
- [ ] **Operational Bottleneck & Cycle Time Analytics**: Stage turnaround time statistics, average cycle time calculations from `stage_actions`, active bottleneck identification (longest queues, highest overdue counts), and admin BI analytics view.
- [ ] **In-App Notification Center**: Bell icon with unread count and interactive notification panel.
