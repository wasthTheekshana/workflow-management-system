const express = require('express');
const { authenticate } = require('../middleware/auth');
const { startInstance, getInstanceDetail } = require('../services/workflowInstanceService');

const router = express.Router();

router.use(authenticate);

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

module.exports = router;
