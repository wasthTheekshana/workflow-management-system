const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');
const { computeWordDiff, computeLineDiff, extractText } = require('../src/services/documentDiffService');

const TENANT_A = 'fd000000-0000-0000-0000-000000000001';
const USER_A1 = 'fd000000-0000-0000-0000-000000000002';
const TENANT_B = 'fd000000-0000-0000-0000-000000000003';
const USER_B1 = 'fd000000-0000-0000-0000-000000000004';

const userA1Token = signToken({ sub: USER_A1, tenant_id: TENANT_A, is_admin: false });
const userB1Token = signToken({ sub: USER_B1, tenant_id: TENANT_B, is_admin: false });

describe('Document Version Diff & Redline Service (/instances/:id/diff & /versions)', () => {
  let instanceAId;
  let templateVersionId;

  beforeAll(async () => {
    // Setup tenants
    await db('tenants').insert([
      { id: TENANT_A, name: 'Diff Tenant A' },
      { id: TENANT_B, name: 'Diff Tenant B' },
    ]).onConflict('id').ignore();

    // Setup users
    await db('users').insert([
      { id: USER_A1, tenant_id: TENANT_A, email: 'author1@example.com', password_hash: 'x' },
      { id: USER_B1, tenant_id: TENANT_B, email: 'authorb@example.com', password_hash: 'x' },
    ]).onConflict('id').ignore();

    // Template file & template file version
    const [tf] = await db('template_files').insert({
      tenant_id: TENANT_A,
      name: 'Standard Agreement',
      content_format: 'richtext',
    }).returning('*');

    const [tfv] = await db('template_file_versions').insert({
      tenant_id: TENANT_A,
      template_file_id: tf.id,
      version_number: 1,
      content: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Clause 1: Confidentiality obligation.' }] }
        ]
      }),
      uploaded_by: USER_A1,
    }).returning('*');
    templateVersionId = tfv.id;

    // Document type & workflow template
    const [wt] = await db('workflow_templates').insert({
      tenant_id: TENANT_A,
      name: 'Agreement Workflow',
    }).returning('*');

    const [dt] = await db('document_types').insert({
      tenant_id: TENANT_A,
      name: 'Agreement',
      template_file_id: tf.id,
      workflow_template_id: wt.id,
    }).returning('*');

    // Workflow stage
    await db('workflow_stages').insert({
      tenant_id: TENANT_A,
      workflow_template_id: wt.id,
      stage_order: 1,
      name: 'Review',
      assignee_type: 'user',
      assignee_user_id: USER_A1,
    });

    // Workflow instance
    const [inst] = await db('workflow_instances').insert({
      tenant_id: TENANT_A,
      document_type_id: dt.id,
      workflow_template_id: wt.id,
      template_file_version_id: templateVersionId,
      current_stage_order: 1,
      status: 'in_progress',
      created_by: USER_A1,
    }).returning('*');
    instanceAId = inst.id;

    // Insert instance versions:
    // v1: Rich text initial edit
    await db('instance_versions').insert({
      tenant_id: TENANT_A,
      workflow_instance_id: instanceAId,
      version_number: 1,
      uploaded_by: USER_A1,
      content: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Clause 1: Confidentiality obligation applies for 2 years.' }] }
        ]
      }),
    });

    // v2: Rich text revision with changes
    await db('instance_versions').insert({
      tenant_id: TENANT_A,
      workflow_instance_id: instanceAId,
      version_number: 2,
      uploaded_by: USER_A1,
      content: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Clause 1: Confidentiality obligation applies for 5 years without limitation.' }] }
        ]
      }),
    });
  });

  afterAll(async () => {
    await db('instance_versions').where({ tenant_id: TENANT_A }).del();
    await db('workflow_instances').where({ tenant_id: TENANT_A }).del();
    await db('workflow_stages').where({ tenant_id: TENANT_A }).del();
    await db('document_types').where({ tenant_id: TENANT_A }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_A }).del();
    await db('template_file_versions').where({ tenant_id: TENANT_A }).del();
    await db('template_files').where({ tenant_id: TENANT_A }).del();
    await db('users').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('tenants').whereIn('id', [TENANT_A, TENANT_B]).del();
  });

  describe('Pure Diff Algorithm Unit Logic', () => {
    it('correctly computes word diff with additions and deletions', () => {
      const textA = 'The quick brown fox jumps';
      const textB = 'The fast brown fox jumps high';
      const diff = computeWordDiff(textA, textB);

      expect(diff).toBeDefined();
      const added = diff.filter((c) => c.type === 'added').map((c) => c.text.trim());
      const removed = diff.filter((c) => c.type === 'removed').map((c) => c.text.trim());

      expect(added).toContain('fast');
      expect(added).toContain('high');
      expect(removed).toContain('quick');
    });

    it('correctly computes line diff', () => {
      const textA = 'Line 1\nLine 2\nLine 3';
      const textB = 'Line 1\nLine 2 modified\nLine 3\nLine 4';
      const diff = computeLineDiff(textA, textB);

      expect(diff).toBeDefined();
      expect(diff.some((l) => l.type === 'removed' && l.line === 'Line 2')).toBe(true);
      expect(diff.some((l) => l.type === 'added' && l.line === 'Line 2 modified')).toBe(true);
      expect(diff.some((l) => l.type === 'added' && l.line === 'Line 4')).toBe(true);
    });

    it('extracts text from HTML string gracefully', () => {
      const html = '<p>Hello <strong>World</strong>!</p>';
      const extracted = extractText(html);
      expect(extracted).toContain('Hello World !');
    });
  });

  describe('GET /instances/:id/versions', () => {
    it('returns list of versions with uploader email', async () => {
      const res = await request(app)
        .get(`/instances/${instanceAId}/versions`)
        .set('Authorization', `Bearer ${userA1Token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0].version_number).toBe(1);
      expect(res.body[0].uploader_email).toBe('author1@example.com');
      expect(res.body[1].version_number).toBe(2);
    });

    it('returns 404 if instance belongs to another tenant', async () => {
      const res = await request(app)
        .get(`/instances/${instanceAId}/versions`)
        .set('Authorization', `Bearer ${userB1Token}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /instances/:id/diff', () => {
    it('compares latest version with previous version by default', async () => {
      const res = await request(app)
        .get(`/instances/${instanceAId}/diff`)
        .set('Authorization', `Bearer ${userA1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.fromVersion).toBe(1);
      expect(res.body.toVersion).toBe(2);
      expect(res.body.stats).toBeDefined();
      expect(res.body.stats.changes).toBeGreaterThan(0);
      expect(res.body.wordDiff).toBeDefined();
      expect(res.body.lineDiff).toBeDefined();

      // Check word diff chunks
      const additions = res.body.wordDiff.filter((c) => c.type === 'added').map((c) => c.text);
      const removals = res.body.wordDiff.filter((c) => c.type === 'removed').map((c) => c.text);

      expect(additions.some((t) => t.includes('5') || t.includes('limitation'))).toBe(true);
      expect(removals.some((t) => t.includes('2'))).toBe(true);
    });

    it('compares explicit versions when specified (fromVersion=0 template vs v1)', async () => {
      const res = await request(app)
        .get(`/instances/${instanceAId}/diff?fromVersion=0&toVersion=1`)
        .set('Authorization', `Bearer ${userA1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.fromVersion).toBe(0);
      expect(res.body.toVersion).toBe(1);
      expect(res.body.fromAuthor).toBe('Initial Template');
      expect(res.body.stats.additions).toBeGreaterThan(0);
    });

    it('returns 404 for non-existent version number', async () => {
      const res = await request(app)
        .get(`/instances/${instanceAId}/diff?fromVersion=1&toVersion=99`)
        .set('Authorization', `Bearer ${userA1Token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Version 99 not found');
    });

    it('enforces multi-tenant isolation on diff query', async () => {
      const res = await request(app)
        .get(`/instances/${instanceAId}/diff`)
        .set('Authorization', `Bearer ${userB1Token}`);

      expect(res.status).toBe(404);
    });
  });
});

