const fs = require('fs/promises');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');
const { signDownloadToken } = require('../src/utils/downloadToken');
const { STORAGE_ROOT } = require('../src/services/fileStorageService');

const TEST_TENANT_DIR = 'signed-download-test-tenant';
const TEST_FILE_RELATIVE_PATH = `${TEST_TENANT_DIR}/fixture.docx`;
const TEST_FILE_CONTENT = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('signed-download-fixture')]);

describe('GET /files/signed-download', () => {
  beforeAll(async () => {
    await fs.mkdir(path.join(STORAGE_ROOT, TEST_TENANT_DIR), { recursive: true });
    await fs.writeFile(path.join(STORAGE_ROOT, TEST_FILE_RELATIVE_PATH), TEST_FILE_CONTENT);
  });

  afterAll(async () => {
    await fs.rm(path.join(STORAGE_ROOT, TEST_TENANT_DIR), { recursive: true, force: true });
  });

  it('rejects a missing token', async () => {
    const response = await request(app).get('/files/signed-download');
    expect(response.status).toBe(400);
  });

  it('rejects an invalid token', async () => {
    const response = await request(app).get('/files/signed-download?token=not-a-real-token');
    expect(response.status).toBe(401);
  });

  it('streams the file for a valid token', async () => {
    const token = signDownloadToken(TEST_FILE_RELATIVE_PATH);
    const response = await request(app)
      .get(`/files/signed-download?token=${token}`)
      .buffer(true)
      .parse((res, callback) => {
        res.setEncoding('binary');
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => callback(null, Buffer.from(data, 'binary')));
      });
    expect(response.status).toBe(200);
    expect(response.body.toString()).toContain('signed-download-fixture');
  });
});
