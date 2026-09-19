import { apiFetch } from './client';

export interface InstanceVersionInfo {
  id: string;
  version_number: number;
  file_path: string | null;
  created_at: string;
  uploaded_by: string | null;
  uploader_email: string | null;
  has_content: boolean;
}

export interface DiffChunk {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
}

export interface LineDiffItem {
  type: 'added' | 'removed' | 'unchanged';
  line: string;
  lineNumA: number | null;
  lineNumB: number | null;
}

export interface DocumentDiffResult {
  fromVersion: number;
  toVersion: number;
  fromAuthor: string;
  toAuthor: string;
  fromCreated: string | null;
  toCreated: string | null;
  stats: {
    additions: number;
    deletions: number;
    changes: number;
  };
  wordDiff: DiffChunk[];
  lineDiff: LineDiffItem[];
  v1RawText: string;
  v2RawText: string;
}

export async function getInstanceVersions(instanceId: string): Promise<InstanceVersionInfo[]> {
  return apiFetch<InstanceVersionInfo[]>(`/instances/${instanceId}/versions`);
}

export async function getInstanceDiff(
  instanceId: string,
  fromVersion?: number,
  toVersion?: number,
): Promise<DocumentDiffResult> {
  const query = new URLSearchParams();
  if (fromVersion !== undefined) query.set('fromVersion', String(fromVersion));
  if (toVersion !== undefined) query.set('toVersion', String(toVersion));
  const queryString = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<DocumentDiffResult>(`/instances/${instanceId}/diff${queryString}`);
}
