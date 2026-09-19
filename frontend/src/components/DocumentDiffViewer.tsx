import React, { useState, useEffect } from 'react';
import {
  getInstanceVersions,
  getInstanceDiff,
  InstanceVersionInfo,
  DocumentDiffResult,
} from '../api/diff';

interface DocumentDiffViewerProps {
  instanceId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const DocumentDiffViewer: React.FC<DocumentDiffViewerProps> = ({
  instanceId,
  isOpen,
  onClose,
}) => {
  const [versions, setVersions] = useState<InstanceVersionInfo[]>([]);
  const [fromVer, setFromVer] = useState<number>(0);
  const [toVer, setToVer] = useState<number>(1);
  const [diffResult, setDiffResult] = useState<DocumentDiffResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'inline' | 'split'>('inline');

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    async function loadVersions() {
      setLoading(true);
      setError(null);
      try {
        const list = await getInstanceVersions(instanceId);
        if (!mounted) return;
        setVersions(list);

        if (list.length > 0) {
          const max = list[list.length - 1].version_number;
          const prev = list.length > 1 ? list[list.length - 2].version_number : 0;
          setFromVer(prev);
          setToVer(max);
        }
      } catch (err: unknown) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load version history');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadVersions();
    return () => {
      mounted = false;
    };
  }, [instanceId, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    async function fetchDiff() {
      setLoading(true);
      setError(null);
      try {
        const res = await getInstanceDiff(instanceId, fromVer, toVer);
        if (mounted) setDiffResult(res);
      } catch (err: unknown) {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to compute diff');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchDiff();
    return () => {
      mounted = false;
    };
  }, [instanceId, isOpen, fromVer, toVer]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-5xl flex flex-col max-h-[90vh] animate-in fade-in duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80 rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center font-bold">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Document Redline & Revision Diff</h2>
              <p className="text-xs text-slate-500">
                Compare rich-text changes, edits, and word additions/deletions across approval stages
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar & Version Selector */}
        <div className="px-6 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap text-sm">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Base:</label>
              <select
                value={fromVer}
                onChange={(e) => setFromVer(Number(e.target.value))}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value={0}>v0 (Initial Template)</option>
                {versions.map((v) => (
                  <option key={`from-${v.version_number}`} value={v.version_number}>
                    v{v.version_number} {v.uploader_email ? `(${v.uploader_email})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <span className="text-slate-400 font-bold">→</span>

            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Compare with:</label>
              <select
                value={toVer}
                onChange={(e) => setToVer(Number(e.target.value))}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {versions.map((v) => (
                  <option key={`to-${v.version_number}`} value={v.version_number}>
                    v{v.version_number} {v.uploader_email ? `(${v.uploader_email})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Stat Badges */}
            {diffResult?.stats && (
              <div className="flex items-center gap-2 ml-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  <span className="text-emerald-600 font-bold">+</span>
                  {diffResult.stats.additions} added
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
                  <span className="text-rose-600 font-bold">−</span>
                  {diffResult.stats.deletions} removed
                </span>
              </div>
            )}
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setViewMode('inline')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                viewMode === 'inline'
                  ? 'bg-white text-indigo-700 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Inline Redline
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                viewMode === 'split'
                  ? 'bg-white text-indigo-700 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Side-by-Side (Split)
            </button>
          </div>
        </div>

        {/* Diff Content Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          {loading && (
            <div className="flex items-center justify-center py-20 text-slate-500 gap-3">
              <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm font-medium">Computing revision diff...</span>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
              <p className="font-semibold">Unable to compare versions</p>
              <p className="text-xs mt-1 text-rose-600">{error}</p>
            </div>
          )}

          {!loading && !error && diffResult && (
            <div>
              {/* Identical check */}
              {diffResult.stats.changes === 0 ? (
                <div className="p-8 text-center bg-white rounded-xl border border-slate-200 shadow-sm">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400 mb-3">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-800">No Differences Detected</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Version {diffResult.fromVersion} and Version {diffResult.toVersion} have identical text content.
                  </p>
                </div>
              ) : viewMode === 'inline' ? (
                /* Inline Word-level Redline View */
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 text-sm leading-relaxed whitespace-pre-wrap font-mono">
                  {diffResult.wordDiff.map((chunk, idx) => {
                    if (chunk.type === 'added') {
                      return (
                        <ins
                          key={idx}
                          className="bg-emerald-100 text-emerald-900 border-b-2 border-emerald-500 no-underline px-1 py-0.5 rounded font-semibold"
                          title={`Added in v${diffResult.toVersion}`}
                        >
                          {chunk.text}
                        </ins>
                      );
                    }
                    if (chunk.type === 'removed') {
                      return (
                        <del
                          key={idx}
                          className="bg-rose-100 text-rose-900 line-through border-b-2 border-rose-500 px-1 py-0.5 rounded opacity-80"
                          title={`Removed from v${diffResult.fromVersion}`}
                        >
                          {chunk.text}
                        </del>
                      );
                    }
                    return <span key={idx} className="text-slate-800">{chunk.text}</span>;
                  })}
                </div>
              ) : (
                /* Side-by-Side (Split) Line Diff View */
                <div className="grid grid-cols-2 gap-4">
                  {/* Left Column: Version From */}
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                    <div className="px-4 py-2 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-700">
                      <span>Base: v{diffResult.fromVersion}</span>
                      <span className="text-slate-500 font-normal">{diffResult.fromAuthor}</span>
                    </div>
                    <div className="p-4 overflow-x-auto text-xs font-mono space-y-1">
                      {diffResult.lineDiff.map((item, idx) => {
                        if (item.type === 'added') {
                          return (
                            <div key={idx} className="text-slate-300 italic select-none">
                              &nbsp;
                            </div>
                          );
                        }
                        if (item.type === 'removed') {
                          return (
                            <div key={idx} className="bg-rose-50 text-rose-900 px-2 py-0.5 rounded border border-rose-200 flex gap-3">
                              <span className="text-rose-400 select-none w-6 text-right">{item.lineNumA}</span>
                              <span className="line-through">{item.line || ' '}</span>
                            </div>
                          );
                        }
                        return (
                          <div key={idx} className="text-slate-800 px-2 py-0.5 flex gap-3">
                            <span className="text-slate-400 select-none w-6 text-right">{item.lineNumA}</span>
                            <span>{item.line || ' '}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Column: Version To */}
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                    <div className="px-4 py-2 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-700">
                      <span>Compared: v{diffResult.toVersion}</span>
                      <span className="text-slate-500 font-normal">{diffResult.toAuthor}</span>
                    </div>
                    <div className="p-4 overflow-x-auto text-xs font-mono space-y-1">
                      {diffResult.lineDiff.map((item, idx) => {
                        if (item.type === 'removed') {
                          return (
                            <div key={idx} className="text-slate-300 italic select-none">
                              &nbsp;
                            </div>
                          );
                        }
                        if (item.type === 'added') {
                          return (
                            <div key={idx} className="bg-emerald-50 text-emerald-900 px-2 py-0.5 rounded border border-emerald-200 flex gap-3">
                              <span className="text-emerald-500 select-none w-6 text-right">{item.lineNumB}</span>
                              <span className="font-semibold">{item.line || ' '}</span>
                            </div>
                          );
                        }
                        return (
                          <div key={idx} className="text-slate-800 px-2 py-0.5 flex gap-3">
                            <span className="text-slate-400 select-none w-6 text-right">{item.lineNumB}</span>
                            <span>{item.line || ' '}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              Additions (Green)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
              Deletions (Red Strikethrough)
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-slate-300 font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
