import { useEffect, useId, useRef } from 'react';
import { OnlyOfficeConfig } from '../api/documentEditing';

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (containerId: string, config: OnlyOfficeConfig) => { destroyEditor: () => void };
    };
  }
}

const DOCUMENT_SERVER_URL = import.meta.env.VITE_ONLYOFFICE_DOCUMENT_SERVER_URL as string;

let apiScriptPromise: Promise<void> | null = null;

function loadOnlyOfficeApi(): Promise<void> {
  if (window.DocsAPI) {
    return Promise.resolve();
  }
  if (!apiScriptPromise) {
    apiScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${DOCUMENT_SERVER_URL}/web-apps/apps/api/documents/api.js`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load the document editor'));
      document.body.appendChild(script);
    });
  }
  return apiScriptPromise;
}

interface OnlineEditorProps {
  config: OnlyOfficeConfig;
  onClose: () => void;
  onError: (message: string) => void;
}

export function OnlineEditor({ config, onClose, onError }: OnlineEditorProps) {
  const containerId = `oo-editor-${useId().replace(/:/g, '')}`;
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadOnlyOfficeApi()
      .then(() => {
        if (cancelled || !window.DocsAPI) return;
        editorRef.current = new window.DocsAPI.DocEditor(containerId, config);
      })
      .catch(() => onError('Could not load the document editor. Is the editor service running?'));

    return () => {
      cancelled = true;
      editorRef.current?.destroyEditor();
      editorRef.current = null;
    };
    // Re-run only if the resource being edited actually changes (its key
    // changes every save), not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.document.key]);

  return (
    <div className="rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-medium">Editing: {config.document.title}</span>
        <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900">
          Close
        </button>
      </div>
      <div id={containerId} style={{ height: '80vh' }} />
    </div>
  );
}
