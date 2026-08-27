const multer = require('multer');

// Hard ceiling at the transport layer; per-document-type caps are enforced
// by assertAllowedUpload in application code.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

module.exports = { upload };
