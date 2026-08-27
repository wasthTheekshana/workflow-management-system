const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const {
  createWorkflowTemplate,
  listWorkflowTemplates,
  getWorkflowTemplate,
} = require('../../services/workflowTemplateService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.post('/', async (req, res, next) => {
  try {
    const workflowTemplate = await createWorkflowTemplate(req.user.tenantId, req.body.name);
    res.status(201).json(workflowTemplate);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const workflowTemplates = await listWorkflowTemplates(req.user.tenantId);
    res.status(200).json(workflowTemplates);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const workflowTemplate = await getWorkflowTemplate(req.user.tenantId, req.params.id);
    res.status(200).json(workflowTemplate);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
