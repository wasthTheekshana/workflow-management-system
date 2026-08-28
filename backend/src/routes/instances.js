const express = require('express');
const { authenticate } = require('../middleware/auth');
const { upload } = require('../config/multerUpload');
const {
  startInstance,
  getInstanceDetail,
  claimInstance,
  addInstanceVersion,
  getCurrentFilePath,
  forwardInstance,
  sendBackInstance,
  rejectInstance,
  resubmitInstance,
} = require('../services/workflowInstanceService');
const { listMyTasks } = require('../services/dashboardService');

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
    const instance = await startInstance(req.user.tenantId, req.user.userId, req.body.documentTypeId);
    res.status(201).json(instance);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { instance, stage } = await getInstanceDetail(req.user.tenantId, req.params.id);
    res.status(200).json({ ...instance, currentStage: stage });
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
    const instance = await sendBackInstance(req.user.tenantId, req.user.userId, req.params.id, req.body.comment);
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

module.exports = router;
