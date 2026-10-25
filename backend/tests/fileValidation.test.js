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

describe('assertAttachmentSignature', () => {
  const { assertAttachmentSignature } = require('../src/utils/fileValidation');

  it('accepts matching signatures', () => {
    expect(() => assertAttachmentSignature('pdf', Buffer.from('%PDF-1.4 x'))).not.toThrow();
    expect(() => assertAttachmentSignature('png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).not.toThrow();
    expect(() => assertAttachmentSignature('txt', Buffer.from('hello'))).not.toThrow();
  });

  it('rejects content that does not match the extension', () => {
    expect(() => assertAttachmentSignature('pdf', Buffer.from('MZ\x90 executable'))).toThrow(/does not match/);
    expect(() => assertAttachmentSignature('jpg', Buffer.from('<?php'))).toThrow(/does not match/);
    expect(() => assertAttachmentSignature('txt', Buffer.from([0x4d, 0x5a, 0x00]))).toThrow(/does not match/);
  });
});
