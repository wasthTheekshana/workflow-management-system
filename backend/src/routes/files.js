const express = require('express');
const AppError = require('../utils/AppError');
const { verifyDownloadToken } = require('../utils/downloadToken');
const { sendStoredFile } = require('../services/fileStorageService');

const router = express.Router();

router.get('/signed-download', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) {
      throw new AppError(400, 'token is required');
    }
    const { filePath } = verifyDownloadToken(token);

    // The token is signed by us and filePath always comes from our own DB;
    // the storage service still rejects keys that escape the storage root.
    await sendStoredFile(res, filePath);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
