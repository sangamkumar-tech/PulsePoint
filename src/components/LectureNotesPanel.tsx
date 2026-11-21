import React, { useEffect, useState } from "react";
import { User } from "firebase/auth";
import {
  AlertCircle,
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import {
  collection,
  db,
  deleteDoc,
  deleteObject,
  doc,
  getDownloadURL,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  storage,
  storageRef,
  uploadBytes,
} from "../firebase";
import { LectureNoteDoc } from "../types";
import { formatDateLabel, formatMinuteLabel, stripUndefined } from "../utils/roomUtils";

interface LectureNotesPanelProps {
  roomCode: string;
  user: User;
  canUpload: boolean;
  compact?: boolean;
}

const ACCEPTED_EXTENSIONS = ".pdf,.ppt,.pptx,.doc,.docx,.txt,.png,.jpg,.jpeg";
const MAX_STORAGE_BYTES = 10 * 1024 * 1024; // 10MB for Firebase Storage
const MAX_INLINE_FALLBACK_BYTES = 650 * 1024; // 650KB safe Firestore inline data-URL fallback

function inferFileTypeBadge(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "PDF";
  if (ext === "ppt" || ext === "pptx") return "PPT";
  if (ext === "doc" || ext === "docx") return "DOC";
  if (ext === "txt") return "TXT";
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return "IMG";
  return ext.toUpperCase().slice(0, 6) || "FILE";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not encode file."));
    };
    reader.onerror = () => reject(new Error("Failed to read selected file."));
    reader.readAsDataURL(file);
  });
}

async function uploadToStorageWithTimeout(
  path: string,
  file: File,
  timeoutMs = 7000
): Promise<string> {
  const ref = storageRef(storage, path);
  const uploadPromise = (async () => {
    await uploadBytes(ref, file);
    return await getDownloadURL(ref);
  })();
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Storage upload timed out")), timeoutMs)
  );
  return await Promise.race([uploadPromise, timeoutPromise]);
}

export function LectureNotesPanel({
  roomCode,
  user,
  canUpload,
  compact = false,
}: LectureNotesPanelProps) {
  const [notes, setNotes] = useState<LectureNoteDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteTitle, setNoteTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "rooms", roomCode, "notes"),
      orderBy("createdAtMs", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: LectureNoteDoc[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<LectureNoteDoc, "id">),
        }));
        setNotes(list);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, [roomCode]);

  const handleUploadNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUpload || !selectedFile || uploading) return;

    setUploadError(null);
    setUploadSuccess(null);

    if (selectedFile.size > MAX_STORAGE_BYTES) {
      setUploadError("Please select a file smaller than 10 MB.");
      return;
    }

    setUploading(true);
    const noteId = `note_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const safeFileName = selectedFile.name.replace(/[^a-zA-Z0-9._\-() ]+/g, "_");
    const cleanTitle = (
      noteTitle.trim() || selectedFile.name.replace(/\.[^/.]+$/, "")
    ).slice(0, 140);
    const fileType = inferFileTypeBadge(safeFileName);
    const storagePath = `notes/${roomCode}/${noteId}_${safeFileName}`;

    try {
      let downloadUrl = "";
      let persistedStoragePath: string | null = storagePath;

      try {
        downloadUrl = await uploadToStorageWithTimeout(storagePath, selectedFile);
      } catch {
        // Fallback to inline Firestore data URL for small lecture files if Storage is unavailable/CORS-blocked
        persistedStoragePath = null;
        if (selectedFile.size > MAX_INLINE_FALLBACK_BYTES) {
          throw new Error(
            "Cloud Storage is unavailable in this environment for files over 650 KB. Compress the file under 650 KB or enable Firebase Storage rules."
          );
        }
        downloadUrl = await readFileAsDataUrl(selectedFile);
      }

      const payload: Omit<LectureNoteDoc, "id"> = {
        title: cleanTitle,
        fileName: safeFileName.slice(0, 200),
        fileType,
        mimeType: selectedFile.type || "application/octet-stream",
        sizeBytes: selectedFile.size,
        downloadUrl,
        storagePath: persistedStoragePath,
        uploadedByUid: user.uid,
        createdAtMs: Date.now(),
      };

      await setDoc(
        doc(db, "rooms", roomCode, "notes", noteId),
        stripUndefined(payload)
      );

      setNoteTitle("");
      setSelectedFile(null);
      setUploadSuccess(`Shared "${cleanTitle}" with all students.`);
      setTimeout(() => setUploadSuccess(null), 3500);
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : "Unable to upload note. Check connection and try again."
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadNote = async (note: LectureNoteDoc) => {
    if (downloadingId) return;
    setDownloadingId(note.id);
    try {
      if (note.downloadUrl.startsWith("data:")) {
        const link = document.createElement("a");
        link.href = note.downloadUrl;
        link.download = note.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }

      try {
        const res = await fetch(note.downloadUrl);
        if (!res.ok) throw new Error("Fetch blocked");
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = note.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      } catch {
        // Direct anchor fallback if CORS headers restrict fetch()
        const link = document.createElement("a");
        link.href = note.downloadUrl;
        link.download = note.fileName;
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteNote = async (note: LectureNoteDoc) => {
    if (!canUpload) return;
    try {
      await deleteDoc(doc(db, "rooms", roomCode, "notes", note.id));
      if (note.storagePath) {
        await deleteObject(storageRef(storage, note.storagePath)).catch(() => {});
      }
    } catch {
      // Ignore deletion errors cleanly
    }
  };

  const renderFileIcon = (fileType: string) => {
    if (fileType === "PPT") {
      return <FileSpreadsheet className="w-4 h-4 text-amber-400 shrink-0" />;
    }
    if (fileType === "IMG") {
      return <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />;
    }
    return <FileText className="w-4 h-4 text-sky-400 shrink-0" />;
  };

  return (
    <section
      className={`pp-card backdrop-blur-xl border rounded-2xl ${
        compact ? "p-4 space-y-3" : "p-4 sm:p-6 space-y-4"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen className="w-4 h-4 text-sky-400 shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-slate-100">
              Lecture Notes &amp; Resources
            </h2>
            <p className="text-xs text-slate-400 truncate">
              Slides, PDFs, handouts &amp; diagrams shared for this lecture
            </p>
          </div>
        </div>
        <span className="font-mono text-xs text-slate-400 shrink-0 tabular-nums">
          {notes.length} {notes.length === 1 ? "file" : "files"}
        </span>
      </div>

      {canUpload && (
        <form
          onSubmit={handleUploadNote}
          className="p-3.5 rounded-xl pp-input border space-y-3"
        >
          {uploadError && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{uploadError}</span>
            </div>
          )}
          {uploadSuccess && (
            <div className="p-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-xs text-emerald-200">
              {uploadSuccess}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <input
              type="text"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="Note Title (e.g., Week 4 Recursion Slides)"
              maxLength={140}
              className="sm:col-span-5 min-h-[44px] px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-700/80 focus:border-sky-400 focus:outline-none text-xs sm:text-sm text-slate-100 placeholder:text-slate-500"
            />
            <label className="sm:col-span-4 min-h-[44px] px-3 py-2 rounded-xl bg-slate-950/70 border border-dashed border-slate-700 hover:border-sky-400/70 cursor-pointer flex items-center gap-2 text-xs text-slate-300 truncate">
              <Upload className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="truncate">
                {selectedFile
                  ? `${selectedFile.name} (${formatFileSize(selectedFile.size)})`
                  : "Choose PDF, PPT, DOC, IMG..."}
              </span>
              <input
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSelectedFile(file);
                  setUploadError(null);
                  if (file && !noteTitle.trim()) {
                    setNoteTitle(file.name.replace(/\.[^/.]+$/, "").slice(0, 140));
                  }
                }}
                className="sr-only"
              />
            </label>
            <button
              type="submit"
              disabled={!selectedFile || uploading}
              className="sm:col-span-3 min-h-[44px] px-4 py-2 rounded-xl pp-primary-btn disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Note</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="p-4 text-xs text-slate-400">
          Loading lecture notes...
        </div>
      ) : notes.length === 0 ? (
        <div className="p-4 border border-dashed border-slate-800 rounded-xl pp-input text-center">
          <p className="text-xs text-slate-400">
            {canUpload
              ? "No lecture notes shared yet. Upload slides, PDFs, or handouts above."
              : "No lecture notes uploaded for this session yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {notes.map((note) => (
            <div
              key={note.id}
              className="p-3.5 rounded-xl pp-input border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-700/80 flex items-center justify-center shrink-0">
                  {renderFileIcon(note.fileType)}
                </div>
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-100 break-words">
                      {note.title}
                    </span>
                    <span className="font-mono text-[10px] font-bold text-sky-300 bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 rounded">
                      {note.fileType}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate tabular-nums">
                    {note.fileName} · {formatFileSize(note.sizeBytes)} ·{" "}
                    {formatDateLabel(note.createdAtMs)} at{" "}
                    {formatMinuteLabel(note.createdAtMs)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={downloadingId === note.id}
                  onClick={() => void handleDownloadNote(note)}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-xl pp-primary-btn disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {downloadingId === note.id
                      ? "Downloading..."
                      : "⬇ Download Note"}
                  </span>
                </button>
                {canUpload && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteNote(note)}
                    aria-label={`Delete ${note.title}`}
                    className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 hover:border-rose-500/50 text-slate-400 hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
