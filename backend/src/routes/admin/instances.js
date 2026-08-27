const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { reassignInstance } = require('../../services/workflowInstanceService');

const router = express.Router();

router.use(authenticate, requireAdmin);

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
