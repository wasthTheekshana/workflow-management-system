const express = require('express');
const path = require('path');
const AppError = require('../utils/AppError');
const { verifyDownloadToken } = require('../utils/downloadToken');
const { STORAGE_ROOT } = require('../services/fileStorageService');

const router = express.Router();

router.get('/signed-download', (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) {
      throw new AppError(400, 'token is required');
    }
    const { filePath } = verifyDownloadToken(token);
    res.sendFile(path.join(STORAGE_ROOT, filePath));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
