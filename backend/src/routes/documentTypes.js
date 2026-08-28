const express = require('express');
const { authenticate } = require('../middleware/auth');
const { listDocumentTypes } = require('../services/documentTypeService');

const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const documentTypes = await listDocumentTypes(req.user.tenantId);
    res.status(200).json(documentTypes);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
