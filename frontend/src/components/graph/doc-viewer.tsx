import { useState, useEffect, useCallback } from 'react';
import { CircleHelp, ArrowLeft, X, FileText } from 'lucide-react';
import Markdown from 'react-markdown';

interface DocMeta {
  filename: string;
  title: string;
}

interface DocViewerProps {
  open: boolean;
  onClose: () => void;
}

const DOC_INDEX = '/doc/index.json';

export function DocViewer({ open, onClose }: DocViewerProps) {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 加载文档列表
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(DOC_INDEX)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: DocMeta[]) => setDocs(data))
      .catch(() => setError('加载文档列表失败'))
      .finally(() => setLoading(false));
  }, [open]);

  // 关闭时重置
  useEffect(() => {
    if (!open) {
      setSelectedDoc(null);
      setContent('');
      setError('');
    }
  }, [open]);

  const openDoc = useCallback((filename: string) => {
    setLoading(true);
    setError('');
    fetch(`/doc/${filename}`)
      .then((r) => {
        if (!r.ok) throw new Error('加载失败');
        return r.text();
      })
      .then((text) => {
        // 解析 frontmatter，提取 title
        const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        const body = fmMatch ? fmMatch[2] : text;
        setContent(body);
        setSelectedDoc(filename);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const backToList = useCallback(() => {
    setSelectedDoc(null);
    setContent('');
  }, []);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-end p-2">
      <div className="w-80 max-h-[80vh] bg-card border rounded-lg shadow-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
          <div className="flex items-center gap-2">
            {selectedDoc && (
              <button
                onClick={backToList}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <h3 className="font-semibold text-sm">
              {selectedDoc
                ? docs.find((d) => d.filename === selectedDoc)?.title || selectedDoc
                : '文档'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <div className="text-xs text-muted-foreground text-center py-4">加载中...</div>
          )}

          {error && (
            <div className="text-xs text-destructive text-center py-4">{error}</div>
          )}

          {!loading && !error && !selectedDoc && (
            <div className="space-y-1">
              {docs.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4">
                  暂无文档
                </div>
              )}
              {docs.map((doc) => (
                <button
                  key={doc.filename}
                  onClick={() => openDoc(doc.filename)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent transition-colors"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {doc.title}
                </button>
              ))}
            </div>
          )}

          {!loading && !error && selectedDoc && (
            <div className="prose prose-xs max-w-none text-xs leading-relaxed [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mb-2 [&_h1]:mt-0 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4 [&_li]:mt-0.5 [&_p]:mt-1 [&_p]:mb-1 [&_code]:text-[11px] [&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:p-2 [&_pre]:overflow-x-auto">
              <Markdown>{content}</Markdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 问号按钮，放在工具栏 */
export function DocHelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="size-7 rounded-full border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors flex items-center justify-center"
        title="帮助文档"
      >
        <CircleHelp className="h-4 w-4" />
      </button>
      <DocViewer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
