const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { getWorkflowAnalytics } = require('../../services/analyticsService');

const router = express.Router();

router.use(authenticate, requireAdmin);

async function handleGetAnalytics(req, res, next) {
  try {
    const analytics = await getWorkflowAnalytics(req.user.tenantId, {
      workflowTemplateId: req.query.workflowTemplateId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.status(200).json(analytics);
  } catch (err) {
    next(err);
  }
}

router.get('/', handleGetAnalytics);
router.get('/overview', handleGetAnalytics);

module.exports = router;

