import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { ActionButton } from "../action-button";
import { ATTACHMENT_ACCEPT, type Row } from "../../lib/format";
// Lists, uploads, downloads and removes the evidence attached to one document or ledger entry.
export function AttachmentsPanel({ entityType, entityId, canWrite, api, upload, download, notify, onChanged }: {
  entityType: "DOCUMENT" | "ENTRY";
  entityId: string;
  canWrite: boolean;
  api: (path: string, method?: string, body?: unknown) => Promise<any>;
  upload: (entityType: string, entityId: string, file: File) => Promise<any>;
  download: (attachment: Row) => Promise<void>;
  notify: (t: Row) => void;
  onChanged: () => void;
}) {
  const [files, setFiles] = useState<Row[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api("attachments?" + new URLSearchParams({ entityType, entityId })).then(setFiles).catch((e: any) => setError(e.message)), [api, entityType, entityId]);
  useEffect(() => { load(); }, [load]);
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(list)) await upload(entityType, entityId, file);
      notify({ title: list.length === 1 ? "Attachment added" : list.length + " attachments added", description: Array.from(list).map(f => f.name).join(", ") });
      await load();
      onChanged();
    } catch (e: any) { setError(e.message) }
    finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async (a: Row) => {
    if (!window.confirm("Remove " + a.file_name + "? The removal is recorded in the audit log.")) return;
    try {
      await api("attachments/" + a.id, "DELETE");
      notify({ title: "Attachment removed", description: a.file_name });
      await load();
      onChanged();
    } catch (e: any) { setError(e.message) }
  };
  const size = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  return <div className="attachments-panel">
    {error && <div role="alert" className="error">{error}</div>}
    {files === null ? <p className="muted">Loading attachments…</p> : files.length ? <ul className="attachment-list">
      {files.map(a => <li key={a.id}>
        <span className="attachment-icon">{a.content_type === "application/pdf" ? <FileText size={18}/> : <ImageIcon size={18}/>}</span>
        <div><strong>{a.file_name}</strong><small>{size(a.size)} · {a.uploaded_by || "Unknown"} · {new Date(a.created_at).toLocaleDateString("en-IN")}</small></div>
        <ActionButton type="button" className="icon-btn" title={"Download " + a.file_name} onClick={() => download(a).catch((e: any) => setError(e.message))}><Download size={16}/></ActionButton>
        {canWrite && <button type="button" className="icon-btn" title={"Remove " + a.file_name} onClick={() => remove(a)}><Trash2 size={15}/></button>}
      </li>)}
    </ul> : <p className="muted">No files attached yet.</p>}
    {canWrite && <label className={"btn upload-btn" + (busy ? " disabled" : "")}>
      <Upload size={16}/>{busy ? "Uploading…" : "Add bill / receipt"}
      <input ref={input} type="file" accept={ATTACHMENT_ACCEPT} multiple hidden disabled={busy} onChange={e => add(e.target.files)}/>
    </label>}
    <p className="fine">PDF, PNG, JPEG or WebP, up to 4 MB each. On a phone you can take a photo of the bill.</p>
  </div>;
}
