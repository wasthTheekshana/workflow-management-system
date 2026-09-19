const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid } = require('../utils/validation');

function extractText(content) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === 'object' && parsed !== null) {
        return extractTextFromNode(parsed);
      }
      return content;
    } catch {
      // Strip HTML tags if HTML string
      return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  if (typeof content === 'object') {
    return extractTextFromNode(content);
  }
  return String(content);
}

function extractTextFromNode(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.text) return node.text;
  if (Array.isArray(node)) {
    return node.map(extractTextFromNode).join('\n');
  }
  if (Array.isArray(node.content)) {
    const isBlock = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote'].includes(node.type);
    const joined = node.content.map(extractTextFromNode).join('');
    return isBlock ? `${joined}\n` : joined;
  }
  return '';
}

function computeLCS(tokensA, tokensB) {
  const m = tokensA.length;
  const n = tokensB.length;

  // Optimize with single/double row DP to save memory for larger files
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (tokensA[i] === tokensB[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const rawChunks = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokensA[i - 1] === tokensB[j - 1]) {
      rawChunks.push({ type: 'unchanged', text: tokensA[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawChunks.push({ type: 'added', text: tokensB[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      rawChunks.push({ type: 'removed', text: tokensA[i - 1] });
      i--;
    }
  }

  rawChunks.reverse();

  // Merge consecutive chunks of the same type
  const merged = [];
  for (const chunk of rawChunks) {
    if (merged.length > 0 && merged[merged.length - 1].type === chunk.type) {
      merged[merged.length - 1].text += chunk.text;
    } else {
      merged.push({ ...chunk });
    }
  }

  return merged;
}

function computeWordDiff(textA, textB) {
  const tokensA = (textA || '').match(/\s+|[^\s\w]+|\w+/g) || [];
  const tokensB = (textB || '').match(/\s+|[^\s\w]+|\w+/g) || [];

  return computeLCS(tokensA, tokensB);
}

function computeLineDiff(textA, textB) {
  const linesA = (textA || '').split(/\r?\n/);
  const linesB = (textB || '').split(/\r?\n/);

  const m = linesA.length;
  const n = linesB.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (linesA[i] === linesB[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const rawDiff = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      rawDiff.push({ type: 'unchanged', line: linesA[i - 1], lineNumA: i, lineNumB: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawDiff.push({ type: 'added', line: linesB[j - 1], lineNumA: null, lineNumB: j });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      rawDiff.push({ type: 'removed', line: linesA[i - 1], lineNumA: i, lineNumB: null });
      i--;
    }
  }

  return rawDiff.reverse();
}

async function listInstanceVersions(tenantId, instanceId) {
  assertUuid(instanceId, 'instanceId');
  const instance = await db('workflow_instances').where({ tenant_id: tenantId, id: instanceId }).first();
  if (!instance) {
    throw new AppError(404, 'Workflow instance not found');
  }

  const versions = await db('instance_versions')
    .leftJoin('users', function () {
      this.on('users.id', '=', 'instance_versions.uploaded_by')
        .andOn('users.tenant_id', '=', 'instance_versions.tenant_id');
    })
    .where({
      'instance_versions.tenant_id': tenantId,
      'instance_versions.workflow_instance_id': instanceId,
    })
    .select(
      'instance_versions.id',
      'instance_versions.version_number',
      'instance_versions.file_path',
      'instance_versions.created_at',
      'instance_versions.uploaded_by',
      'users.email as uploader_email',
      db.raw("instance_versions.content is not null as has_content"),
    )
    .orderBy('instance_versions.version_number', 'asc');

  return versions;
}

async function compareInstanceVersions(tenantId, instanceId, fromVer, toVer) {
  assertUuid(instanceId, 'instanceId');
  const instance = await db('workflow_instances').where({ tenant_id: tenantId, id: instanceId }).first();
  if (!instance) {
    throw new AppError(404, 'Workflow instance not found');
  }

  const allVersions = await db('instance_versions')
    .leftJoin('users', function () {
      this.on('users.id', '=', 'instance_versions.uploaded_by')
        .andOn('users.tenant_id', '=', 'instance_versions.tenant_id');
    })
    .where({
      'instance_versions.tenant_id': tenantId,
      'instance_versions.workflow_instance_id': instanceId,
    })
    .select(
      'instance_versions.*',
      'users.email as uploader_email',
    )
    .orderBy('instance_versions.version_number', 'asc');

  if (allVersions.length === 0) {
    // Check if initial template version exists
    const templateVersion = await db('template_file_versions')
      .where({ tenant_id: tenantId, id: instance.template_file_version_id })
      .first();

    const rawText = templateVersion ? extractText(templateVersion.content) : '';
    return {
      fromVersion: 0,
      toVersion: 0,
      stats: { additions: 0, deletions: 0, changes: 0 },
      wordDiff: [{ type: 'unchanged', text: rawText }],
      lineDiff: rawText.split('\n').map((line, idx) => ({ type: 'unchanged', line, lineNumA: idx + 1, lineNumB: idx + 1 })),
      v1RawText: rawText,
      v2RawText: rawText,
      fromAuthor: 'Template',
      toAuthor: 'Template',
    };
  }

  // Resolve version numbers
  const maxVer = allVersions[allVersions.length - 1].version_number;
  const targetToVer = toVer !== undefined && toVer !== null ? Number(toVer) : maxVer;
  const targetFromVer = fromVer !== undefined && fromVer !== null ? Number(fromVer) : Math.max(0, targetToVer - 1);

  let v1Content = null;
  let v1Author = 'Initial Template';
  let v1Created = null;

  if (targetFromVer === 0) {
    const templateVersion = await db('template_file_versions')
      .where({ tenant_id: tenantId, id: instance.template_file_version_id })
      .first();
    v1Content = templateVersion ? templateVersion.content : null;
    v1Created = templateVersion ? templateVersion.created_at : null;
  } else {
    const match1 = allVersions.find((v) => v.version_number === targetFromVer);
    if (!match1) {
      throw new AppError(404, `Version ${targetFromVer} not found for this workflow instance`);
    }
    v1Content = match1.content;
    v1Author = match1.uploader_email || 'Unknown';
    v1Created = match1.created_at;
  }

  const match2 = allVersions.find((v) => v.version_number === targetToVer);
  if (!match2) {
    throw new AppError(404, `Version ${targetToVer} not found for this workflow instance`);
  }
  const v2Content = match2.content;
  const v2Author = match2.uploader_email || 'Unknown';
  const v2Created = match2.created_at;

  const textA = extractText(v1Content);
  const textB = extractText(v2Content);

  const wordDiff = computeWordDiff(textA, textB);
  const lineDiff = computeLineDiff(textA, textB);

  let additions = 0;
  let deletions = 0;
  for (const chunk of wordDiff) {
    if (chunk.type === 'added') additions += chunk.text.trim().split(/\s+/).filter(Boolean).length || 1;
    if (chunk.type === 'removed') deletions += chunk.text.trim().split(/\s+/).filter(Boolean).length || 1;
  }

  return {
    fromVersion: targetFromVer,
    toVersion: targetToVer,
    fromAuthor: v1Author,
    toAuthor: v2Author,
    fromCreated: v1Created,
    toCreated: v2Created,
    stats: {
      additions,
      deletions,
      changes: additions + deletions,
    },
    wordDiff,
    lineDiff,
    v1RawText: textA,
    v2RawText: textB,
  };
}

module.exports = {
  extractText,
  computeWordDiff,
  computeLineDiff,
  listInstanceVersions,
  compareInstanceVersions,
};

