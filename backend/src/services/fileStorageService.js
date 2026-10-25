const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { validateEnv } = require('../config/env');
const AppError = require('../utils/AppError');

const config = validateEnv();
const STORAGE_ROOT = path.resolve(process.cwd(), config.storageDir);
const driver = config.storage.driver;

// Storage keys look like `<tenantId>/<uuid>.<ext>` and are what we persist in
// the `file_path` DB columns, so they are identical for every driver.

let s3Client;
function getS3() {
  if (!s3Client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    const { endpoint, region, accessKeyId, secretAccessKey, forcePathStyle } = config.storage.s3;
    s3Client = new S3Client({
      region,
      forcePathStyle,
      // Newer SDK versions add CRC32 checksum headers by default; Cloudflare R2
      // and some MinIO builds reject them. Only send them when required.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      ...(endpoint ? { endpoint } : {}),
      ...(accessKeyId ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
  }
  return s3Client;
}

// Same guard the local driver gets from resolveLocalPath: keys are always
// <tenantId>/<uuid>.<ext>, so anything with traversal or a leading slash is bogus.
function assertSafeKey(key) {
  if (typeof key !== 'string' || key.startsWith('/') || key.split('/').includes('..')) {
    throw new AppError(400, 'Invalid file path');
  }
}

function resolveLocalPath(key) {
  const resolved = path.resolve(STORAGE_ROOT, key);
  if (!resolved.startsWith(STORAGE_ROOT + path.sep)) {
    throw new AppError(400, 'Invalid file path');
  }
  return resolved;
}

async function saveUploadedFile(tenantId, buffer, extension) {
  const key = `${tenantId}/${crypto.randomUUID()}.${extension}`;

  if (driver === 's3') {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await getS3().send(new PutObjectCommand({ Bucket: config.storage.s3.bucket, Key: key, Body: buffer }));
    return key;
  }

  const target = resolveLocalPath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return key;
}

// Streams a stored file to an Express response. `downloadName` forces an
// attachment download; without it the file is served inline (OnlyOffice fetch).
async function sendStoredFile(res, key, downloadName) {
  if (driver === 's3') {
    assertSafeKey(key);
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    let object;
    try {
      object = await getS3().send(new GetObjectCommand({ Bucket: config.storage.s3.bucket, Key: key }));
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        throw new AppError(404, 'File not found');
      }
      throw err;
    }
    res.type(path.extname(key) || 'application/octet-stream');
    if (object.ContentLength !== undefined) res.setHeader('Content-Length', object.ContentLength);
    if (downloadName) {
      res.attachment(downloadName);
    }
    // pipeline() forwards a mid-transfer S3 error and tears down both streams;
    // a bare .pipe() would leave it unhandled and crash the process.
    try {
      await pipeline(object.Body, res);
    } catch (err) {
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      throw err;
    }
    return;
  }

  const absolutePath = resolveLocalPath(key);
  await new Promise((resolve, reject) => {
    const done = (err) => (err ? reject(err) : resolve());
    if (downloadName) {
      res.download(absolutePath, downloadName, done);
    } else {
      res.sendFile(absolutePath, done);
    }
  });
}

async function deleteStoredFile(key) {
  if (driver === 's3') {
    assertSafeKey(key);
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await getS3().send(new DeleteObjectCommand({ Bucket: config.storage.s3.bucket, Key: key }));
    return;
  }
  await fs.unlink(resolveLocalPath(key));
}

module.exports = { saveUploadedFile, sendStoredFile, deleteStoredFile, STORAGE_ROOT };
