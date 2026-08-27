const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { validateEnv } = require('../config/env');

const config = validateEnv();
const STORAGE_ROOT = path.resolve(process.cwd(), config.storageDir);

async function saveUploadedFile(tenantId, buffer, extension) {
  const tenantDir = path.join(STORAGE_ROOT, tenantId);
  await fs.mkdir(tenantDir, { recursive: true });

  const fileName = `${crypto.randomUUID()}.${extension}`;
  await fs.writeFile(path.join(tenantDir, fileName), buffer);

  return path.join(tenantId, fileName);
}

module.exports = { saveUploadedFile };
