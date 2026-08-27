const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const {
  createDocumentType,
  listDocumentTypes,
  getDocumentType,
  updateDocumentType,
  deleteDocumentType,
} = require('../../services/documentTypeService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.post('/', async (req, res, next) => {
  try {
    const documentType = await createDocumentType(req.user.tenantId, req.body);
    res.status(201).json(documentType);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const documentTypes = await listDocumentTypes(req.user.tenantId);
    res.status(200).json(documentTypes);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const documentType = await getDocumentType(req.user.tenantId, req.params.id);
    res.status(200).json(documentType);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const documentType = await updateDocumentType(req.user.tenantId, req.params.id, req.body);
    res.status(200).json(documentType);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteDocumentType(req.user.tenantId, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
