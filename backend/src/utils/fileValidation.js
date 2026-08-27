const AppError = require('./AppError');

// docx/xlsx/pptx are all ZIP-based OOXML containers; every ZIP starts with 'PK'.
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b]);

function assertAllowedUpload(file, allowedExtensions, maxSizeBytes) {
  const extension = file.originalname.split('.').pop().toLowerCase();

  if (!allowedExtensions.includes(extension)) {
    throw new AppError(400, `File extension .${extension} is not allowed`);
  }

  if (file.size > maxSizeBytes) {
    throw new AppError(400, `File exceeds the maximum allowed size of ${maxSizeBytes} bytes`);
  }

  if (!file.buffer || file.buffer.length < 2 || !file.buffer.subarray(0, 2).equals(ZIP_SIGNATURE)) {
    throw new AppError(400, 'File content does not match a valid Office document signature');
  }
}

module.exports = { assertAllowedUpload };
