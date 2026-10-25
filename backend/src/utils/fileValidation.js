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

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const startsWith = (buffer, bytes) =>
  buffer.length >= bytes.length && buffer.subarray(0, bytes.length).equals(Buffer.from(bytes));

const SIGNATURE_CHECKS = {
  pdf: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]),
  docx: (b) => startsWith(b, [0x50, 0x4b]),
  xlsx: (b) => startsWith(b, [0x50, 0x4b]),
  pptx: (b) => startsWith(b, [0x50, 0x4b]),
  zip: (b) => startsWith(b, [0x50, 0x4b]),
  doc: (b) => b.length >= 8 && b.subarray(0, 8).equals(OLE_SIGNATURE),
  xls: (b) => b.length >= 8 && b.subarray(0, 8).equals(OLE_SIGNATURE),
  ppt: (b) => b.length >= 8 && b.subarray(0, 8).equals(OLE_SIGNATURE),
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  jpeg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  gif: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]),
  webp: (b) =>
    startsWith(b, [0x52, 0x49, 0x46, 0x46]) && b.length >= 12 && b.subarray(8, 12).toString('ascii') === 'WEBP',
  // Plain text has no signature; reject anything containing NUL bytes (binary).
  txt: (b) => !b.includes(0),
  csv: (b) => !b.includes(0),
};

function assertAttachmentSignature(extension, buffer) {
  const check = SIGNATURE_CHECKS[extension];
  if (!check || !buffer || buffer.length === 0 || !check(buffer)) {
    throw new AppError(400, `File content does not match the .${extension} file type`);
  }
}

module.exports = { assertAllowedUpload, assertAttachmentSignature };
