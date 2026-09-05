import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface RichTextEditorProps {
  title: string;
  initialContent: unknown;
  editable: boolean;
  saving?: boolean;
  onSave?: (content: unknown) => void;
  onClose: () => void;
}

export function RichTextEditor({ title, initialContent, editable, saving, onSave, onClose }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: (initialContent as object) ?? '',
    editable,
  });

  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  if (!editor) {
    return null;
  }

  return (
    <div className="rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-medium">{editable ? 'Editing' : 'Viewing'}: {title}</span>
        <div className="flex gap-2">
          {editable && onSave && (
            <button
              onClick={() => onSave(editor.getJSON())}
              disabled={saving}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900">
            Close
          </button>
        </div>
      </div>
      <div className="prose max-w-none p-4" style={{ minHeight: '60vh' }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
