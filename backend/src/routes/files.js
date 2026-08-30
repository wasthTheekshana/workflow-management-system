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

    // Defense-in-depth: the token is signed by us and filePath always comes
    // from our own DB, never user input — but a resolved-path check costs
    // nothing and keeps this endpoint safe even if that ever changes.
    const resolvedPath = path.resolve(STORAGE_ROOT, filePath);
    if (!resolvedPath.startsWith(path.resolve(STORAGE_ROOT) + path.sep)) {
      throw new AppError(400, 'Invalid file path');
    }

    res.sendFile(resolvedPath);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
