const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { reassignInstance } = require('../../services/workflowInstanceService');
const { listInstancesForAdmin } = require('../../services/dashboardService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const instances = await listInstancesForAdmin(req.user.tenantId, {
      status: req.query.status,
      documentTypeId: req.query.documentTypeId,
    });
    res.status(200).json(instances);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reassign', async (req, res, next) => {
  try {
    const instance = await reassignInstance(
      req.user.tenantId,
      req.user.userId,
      req.params.id,
      req.body.userId,
      req.body.comment,
    );
    res.status(200).json(instance);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
