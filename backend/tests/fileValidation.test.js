const { assertAllowedUpload } = require('../src/utils/fileValidation');

describe('assertAllowedUpload', () => {
  const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(10)]);

  it('accepts a valid docx-shaped file within limits', () => {
    const file = { originalname: 'template.docx', size: validDocxBuffer.length, buffer: validDocxBuffer };
    expect(() => assertAllowedUpload(file, ['docx'], 1024)).not.toThrow();
  });

  it('rejects a disallowed extension', () => {
    const file = { originalname: 'template.exe', size: validDocxBuffer.length, buffer: validDocxBuffer };
    expect(() => assertAllowedUpload(file, ['docx'], 1024)).toThrow('not allowed');
  });

  it('rejects a file exceeding the size cap', () => {
    const file = { originalname: 'template.docx', size: 2048, buffer: validDocxBuffer };
    expect(() => assertAllowedUpload(file, ['docx'], 1024)).toThrow('maximum allowed size');
  });

  it('rejects a file whose content does not match the expected signature', () => {
    const fakeBuffer = Buffer.from('not a real office document');
    const file = { originalname: 'template.docx', size: fakeBuffer.length, buffer: fakeBuffer };
    expect(() => assertAllowedUpload(file, ['docx'], 1024)).toThrow('signature');
  });
});
