const express = require('express');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { upload } = require('../config/multerUpload');
const {
  startInstance,
  startInstanceFromOwnDocument,
  getInstanceDetail,
  claimInstance,
  unclaimInstance,
  addInstanceVersion,
  addInstanceContentVersion,
  getCurrentContent,
  getCurrentFilePath,
  forwardInstance,
  sendBackInstance,
  rejectInstance,
  resubmitInstance,
  cancelInstance,
  getStageApprovals,
} = require('../services/workflowInstanceService');
const { listComments, addComment } = require('../services/commentService');
const {
  listAttachments,
  addAttachment,
  getAttachmentFile,
  deleteAttachment,
} = require('../services/attachmentService');
const { listMyTasks, getInstanceHistory } = require('../services/dashboardService');
const { buildInstanceEditConfig } = require('../services/documentEditingService');
const { listInstanceVersions, compareInstanceVersions } = require('../services/documentDiffService');

const router = express.Router();

router.use(authenticate);

router.get('/my-tasks', async (req, res, next) => {
  try {
    const tasks = await listMyTasks(req.user.tenantId, req.user.userId);
    res.status(200).json(tasks);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const instance = await startInstance(
      req.user.tenantId,
      req.user.userId,
      req.user.isAdmin,
      req.body.documentTypeId,
      req.body.stages,
    );
    res.status(201).json(instance);
  } catch (err) {
    next(err);
  }
});

router.post('/from-document', upload.single('file'), async (req, res, next) => {
  let stages;
  try {
    stages = req.body.stages ? JSON.parse(req.body.stages) : undefined;
  } catch {
    return res.status(400).json({ error: 'stages must be valid JSON' });
  }
  let content;
  try {
    content = req.body.content ? JSON.parse(req.body.content) : undefined;
  } catch {
    return res.status(400).json({ error: 'content must be valid JSON' });
  }

  try {
    const instance = await startInstanceFromOwnDocument(req.user.tenantId, req.user.userId, req.user.isAdmin, {
      name: req.body.name,
      contentFormat: req.body.contentFormat,
      file: req.file,
      content,
      stages,
    });
    res.status(201).json(instance);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { instance, stage, documentType } = await getInstanceDetail(req.user.tenantId, req.params.id);
    const workflowStages = await db('workflow_stages')
      .where({ tenant_id: req.user.tenantId, workflow_template_id: instance.workflow_template_id })
      .orderBy('stage_order', 'asc');
    const isOverdue = Boolean(
      instance.stage_due_at &&
      new Date(instance.stage_due_at) < new Date() &&
      instance.status === 'in_progress'
    );
    const stageApprovals = await getStageApprovals(
      req.user.tenantId,
      req.params.id,
      instance.current_stage_order,
    );
    res.status(200).json({
      ...instance,
      is_overdue: isOverdue,
      currentStage: stage,
      contentFormat: documentType.content_format,
      workflowStages,
      stageApprovals,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/stage-approvals', async (req, res, next) => {
  try {
    const approvals = await getStageApprovals(
      req.user.tenantId,
      req.params.id,
      req.query.stageOrder,
    );
    res.status(200).json(approvals);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/claim', async (req, res, next) => {
  try {
    const instance = await claimInstance(req.user.tenantId, req.user.userId, req.params.id);
    res.status(200).json(instance);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/unclaim', async (req, res, next) => {
  try {
    const instance = await unclaimInstance(req.user.tenantId, req.user.userId, req.params.id, req.user.isAdmin);
    res.status(200).json(instance);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const instance = await cancelInstance(
      req.user.tenantId,
      req.user.userId,
      req.user.isAdmin,
      req.params.id,
      req.body.comment,
    );
    res.status(200).json(instance);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/versions', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }
    const version = await addInstanceVersion(req.user.tenantId, req.user.userId, req.params.id, req.file);
    res.status(201).json(version);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/current-file', async (req, res, next) => {
  try {
    const absolutePath = await getCurrentFilePath(req.user.tenantId, req.params.id);
    res.download(absolutePath);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/content-versions', async (req, res, next) => {
  try {
    const version = await addInstanceContentVersion(
      req.user.tenantId,
      req.user.userId,
      req.params.id,
      req.body.content,
    );
    res.status(201).json(version);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/current-content', async (req, res, next) => {
  try {
    const content = await getCurrentContent(req.user.tenantId, req.params.id);
    res.status(200).json({ content });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/forward', async (req, res, next) => {
  try {
    const instance = await forwardInstance(req.user.tenantId, req.user.userId, req.params.id, req.body.comment);
    res.status(200).json(instance);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/send-back', async (req, res, next) => {
  try {
    const instance = await sendBackInstance(
      req.user.tenantId,
      req.user.userId,
      req.params.id,
      req.body.comment,
      req.body.targetStageOrder,
    );
    res.status(200).json(instance);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    const instance = await rejectInstance(req.user.tenantId, req.user.userId, req.params.id, req.body.comment);
    res.status(200).json(instance);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/resubmit', async (req, res, next) => {
  try {
    const instance = await resubmitInstance(req.user.tenantId, req.user.userId, req.params.id);
    res.status(201).json(instance);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/comments', async (req, res, next) => {
  try {
    const comments = await listComments(req.user.tenantId, req.user.userId, req.user.isAdmin, req.params.id);
    res.status(200).json(comments);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/comments', async (req, res, next) => {
  try {
    const comment = await addComment(
      req.user.tenantId,
      req.user.userId,
      req.user.isAdmin,
      req.params.id,
      req.body.body,
    );
    res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/attachments', async (req, res, next) => {
  try {
    const attachments = await listAttachments(req.user.tenantId, req.params.id);
    res.status(200).json(attachments);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/attachments', upload.single('file'), async (req, res, next) => {
  try {
    const attachment = await addAttachment(
      req.user.tenantId,
      req.user.userId,
      req.params.id,
      req.file,
    );
    res.status(201).json(attachment);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/attachments/:attachmentId/download', async (req, res, next) => {
  try {
    const { attachment, absolutePath } = await getAttachmentFile(
      req.user.tenantId,
      req.params.id,
      req.params.attachmentId,
    );
    res.download(absolutePath, attachment.file_name);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/attachments/:attachmentId', async (req, res, next) => {
  try {
    await deleteAttachment(
      req.user.tenantId,
      req.user.userId,
      req.user.isAdmin,
      req.params.id,
      req.params.attachmentId,
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get('/:id/history', async (req, res, next) => {
  try {
    const history = await getInstanceHistory(req.user.tenantId, req.params.id);
    res.status(200).json(history);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/edit-config', async (req, res, next) => {
  try {
    const editConfig = await buildInstanceEditConfig(req.user.tenantId, req.params.id, req.user.userId);
    res.status(200).json(editConfig);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/versions', async (req, res, next) => {
  try {
    const versions = await listInstanceVersions(req.user.tenantId, req.params.id);
    res.status(200).json(versions);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/diff', async (req, res, next) => {
  try {
    const { fromVersion, toVersion } = req.query;
    const diff = await compareInstanceVersions(
      req.user.tenantId,
      req.params.id,
      fromVersion !== undefined ? Number(fromVersion) : undefined,
      toVersion !== undefined ? Number(toVersion) : undefined,
    );
    res.status(200).json(diff);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
