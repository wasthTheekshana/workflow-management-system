const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { upload } = require('../../config/multerUpload');
const {
  createTemplateFile,
  listTemplateFiles,
  getTemplateFile,
  addTemplateFileVersion,
  addTemplateFileContentVersion,
} = require('../../services/templateFileService');
const { buildTemplateEditConfig } = require('../../services/documentEditingService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.post('/', async (req, res, next) => {
  try {
    const templateFile = await createTemplateFile(req.user.tenantId, req.body.name, req.body.contentFormat);
    res.status(201).json(templateFile);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const templateFiles = await listTemplateFiles(req.user.tenantId);
    res.status(200).json(templateFiles);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const templateFile = await getTemplateFile(req.user.tenantId, req.params.id);
    res.status(200).json(templateFile);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/versions', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }
    const version = await addTemplateFileVersion(req.user.tenantId, req.params.id, req.user.userId, req.file);
    res.status(201).json(version);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/content-versions', async (req, res, next) => {
  try {
    const version = await addTemplateFileContentVersion(
      req.user.tenantId,
      req.params.id,
      req.user.userId,
      req.body.content,
    );
    res.status(201).json(version);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/edit-config', async (req, res, next) => {
  try {
    const editConfig = await buildTemplateEditConfig(req.user.tenantId, req.params.id, req.user.userId);
    res.status(200).json(editConfig);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
