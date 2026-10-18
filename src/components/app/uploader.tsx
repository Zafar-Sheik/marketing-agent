'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, UploadCloud, XCircle } from 'lucide-react';

type Item = { name: string; state: 'uploading' | 'done' | 'error'; error?: string };

/** Uploads straight to S3 via presigned URLs, then registers each file. */
export function Uploader({ companyId, purpose, accept, multiple = true, label }: { companyId: string; purpose: 'portfolio' | 'logo' | 'font'; accept: string; multiple?: boolean; label: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      setItems((s) => [...s, { name: file.name, state: 'uploading' }]);
      const set = (patch: Partial<Item>) => setItems((s) => s.map((i) => (i.name === file.name ? { ...i, ...patch } : i)));
      try {
        const mimeType = file.type || 'application/octet-stream';
        const pre = await fetch('/api/uploads/presign', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ companyId, filename: file.name, mimeType, bytes: file.size, purpose }),
        });
        const presign = await pre.json();
        if (!pre.ok) throw new Error(presign.error);
        const put = await fetch(presign.url, { method: 'PUT', headers: presign.headers, body: file });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        const done = await fetch('/api/uploads/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ companyId, key: presign.key, purpose, title: file.name.replace(/\.[^.]+$/, '') }),
        });
        if (!done.ok) throw new Error((await done.json()).error);
        set({ state: 'done' });
      } catch (e) {
        set({ state: 'error', error: e instanceof Error ? e.message : 'Upload failed' });
      }
    }
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files);
        }}
        className={`flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-sm transition ${drag ? 'border-accent bg-accent/5' : 'border-line hover:border-accent/60'}`}
      >
        <UploadCloud className="size-6 text-accent" />
        <span>{label}</span>
        <span className="text-xs text-muted">Drag and drop or click to choose</span>
      </button>
      <input ref={input} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      {items.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {items.map((i) => (
            <li key={i.name} className="flex items-center gap-2">
              {i.state === 'uploading' && <Loader2 className="size-4 animate-spin text-accent" />}
              {i.state === 'done' && <CheckCircle2 className="size-4 text-ok" />}
              {i.state === 'error' && <XCircle className="size-4 text-bad" />}
              <span className="truncate">{i.name}</span>
              {i.error && <span className="text-xs text-bad">{i.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
