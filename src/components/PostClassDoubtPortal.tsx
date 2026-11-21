import React, { useEffect, useState } from "react";
import { User } from "firebase/auth";
import {
  CheckCircle2,
  MessageSquarePlus,
  Send,
  Shield,
  ThumbsUp,
} from "lucide-react";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  db,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "../firebase";
import { PostClassDoubtDoc, StudentVisibility } from "../types";
import {
  formatDateLabel,
  formatMinuteLabel,
  getStoredStudentVisibility,
  resolveStudentDisplayName,
} from "../utils/roomUtils";

interface PostClassDoubtPortalProps {
  roomCode: string;
  user: User;
  isTeacher: boolean;
  topicOptions?: string[];
}

export function PostClassDoubtPortal({
  roomCode,
  user,
  isTeacher,
  topicOptions = [],
}: PostClassDoubtPortalProps) {
  const [doubts, setDoubts] = useState<PostClassDoubtDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [doubtText, setDoubtText] = useState("");
  const [topicTag, setTopicTag] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [savingReplyId, setSavingReplyId] = useState<string | null>(null);

  const studentVisibility: StudentVisibility = getStoredStudentVisibility();
  const displayName =
    studentVisibility === "anonymous" ? null : resolveStudentDisplayName(user);

  useEffect(() => {
    const q = query(
      collection(db, "rooms", roomCode, "postClassDoubts"),
      orderBy("createdAtMs", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: PostClassDoubtDoc[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PostClassDoubtDoc, "id">),
        }));
        setDoubts(list);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, [roomCode]);

  const handleSubmitDoubt = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = doubtText.trim();
    if (clean.length < 3 || submitting) {
      setError("Please enter at least 3 characters for your doubt.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await addDoc(collection(db, "rooms", roomCode, "postClassDoubts"), {
        text: clean.slice(0, 500),
        topicTag: topicTag.trim() ? topicTag.trim().slice(0, 140) : null,
        upvoterUids: [user.uid],
        resolved: false,
        teacherReply: null,
        repliedAtMs: null,
        createdAtMs: Date.now(),
        visibility: studentVisibility,
        displayName,
      });
      setDoubtText("");
      setTopicTag("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to post doubt. Please verify connection."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleUpvote = async (doubt: PostClassDoubtDoc) => {
    const already = (doubt.upvoterUids || []).includes(user.uid);
    try {
      await updateDoc(doc(db, "rooms", roomCode, "postClassDoubts", doubt.id), {
        upvoterUids: already ? arrayRemove(user.uid) : arrayUnion(user.uid),
      });
    } catch {
      // Ignore transient upvote error
    }
  };

  const handleTeacherReply = async (doubt: PostClassDoubtDoc) => {
    if (!isTeacher || savingReplyId) return;
    const reply = (replyDrafts[doubt.id] ?? doubt.teacherReply ?? "").trim();
    if (!reply) return;

    setSavingReplyId(doubt.id);
    try {
      await updateDoc(doc(db, "rooms", roomCode, "postClassDoubts", doubt.id), {
        teacherReply: reply.slice(0, 1000),
        repliedAtMs: Date.now(),
        resolved: true,
      });
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[doubt.id];
        return next;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save reply right now."
      );
    } finally {
      setSavingReplyId(null);
    }
  };

  return (
    <section className="pp-card backdrop-blur-xl border rounded-2xl p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquarePlus className="w-4 h-4 text-sky-400 shrink-0" />
          <div>
            <h2 className="font-display text-base sm:text-lg font-bold text-slate-100">
              Post-Class Anonymous Doubt Portal
            </h2>
            <p className="text-xs text-slate-400">
              {isTeacher
                ? "Review and reply to student follow-up questions raised after the lecture"
                : "Still wondering about a concept after class? Ask privately or anonymously below"}
            </p>
          </div>
        </div>
        <span className="font-mono text-xs text-slate-400 tabular-nums">
          {doubts.filter((d) => !d.resolved).length} open · {doubts.length} total
        </span>
      </div>

      {!isTeacher && (
        <form
          onSubmit={handleSubmitDoubt}
          className="p-3.5 rounded-xl pp-input border space-y-3"
        >
          {error && <p className="text-xs text-rose-300">{error}</p>}

          <textarea
            value={doubtText}
            onChange={(e) => setDoubtText(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="💬 Ask Post-Class Anonymous Doubt (e.g., Why did the recursion tree branch twice in step 3?)"
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/70 border border-slate-700/80 focus:border-sky-400 focus:outline-none text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 resize-y"
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
              {topicOptions.length > 0 ? (
                <select
                  value={topicTag}
                  onChange={(e) => setTopicTag(e.target.value)}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-950/70 border border-slate-700/80 text-xs text-slate-200 focus:border-sky-400 focus:outline-none max-w-full"
                >
                  <option value="">General Lecture Question</option>
                  {topicOptions.map((t) => (
                    <option key={t} value={t}>
                      Topic: {t}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={topicTag}
                  onChange={(e) => setTopicTag(e.target.value)}
                  placeholder="Optional topic tag"
                  maxLength={140}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-950/70 border border-slate-700/80 text-xs text-slate-200 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                />
              )}
              <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                <Shield className="w-3 h-3 text-emerald-400 shrink-0" />
                {studentVisibility === "anonymous"
                  ? "Submitting anonymously"
                  : studentVisibility === "teacher"
                  ? `Teacher sees ${displayName}`
                  : `Showing as ${displayName}`}
              </span>
            </div>

            <button
              type="submit"
              disabled={submitting || doubtText.trim().length < 3}
              className="min-h-[42px] px-4 py-2 rounded-xl pp-primary-btn disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {submitting ? "Submitting..." : "💬 Ask Post-Class Doubt"}
              </span>
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="p-4 text-xs text-slate-400">
          Loading post-class doubts...
        </div>
      ) : doubts.length === 0 ? (
        <div className="p-4 border border-dashed border-slate-800 rounded-xl pp-input text-center">
          <p className="text-xs text-slate-400">
            No post-class doubts submitted yet.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {doubts.map((doubt) => {
            const canSeeAuthor =
              doubt.visibility === "public" ||
              (isTeacher && doubt.visibility === "teacher");
            const authorLabel =
              canSeeAuthor && doubt.displayName
                ? doubt.displayName
                : "Anonymous Student";
            const upvoted = (doubt.upvoterUids || []).includes(user.uid);
            const draftValue = replyDrafts[doubt.id] ?? doubt.teacherReply ?? "";

            return (
              <div
                key={doubt.id}
                className="p-4 rounded-xl pp-input border space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        canSeeAuthor
                          ? "font-semibold text-sky-300"
                          : "text-slate-400"
                      }
                    >
                      {authorLabel}
                    </span>
                    {doubt.topicTag && (
                      <span className="text-slate-300 font-medium">
                        · {doubt.topicTag}
                      </span>
                    )}
                    <span className="text-slate-500 tabular-nums">
                      · {formatDateLabel(doubt.createdAtMs)}{" "}
                      {formatMinuteLabel(doubt.createdAtMs)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {doubt.resolved ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Resolved</span>
                      </span>
                    ) : (
                      <span className="text-amber-300 font-semibold">
                        Awaiting Reply
                      </span>
                    )}

                    {!isTeacher && (
                      <button
                        type="button"
                        onClick={() => void handleToggleUpvote(doubt)}
                        className={`min-h-[30px] px-2.5 py-1 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 tabular-nums ${
                          upvoted
                            ? "bg-sky-500/20 border-sky-400 text-sky-200"
                            : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"
                        }`}
                      >
                        <ThumbsUp className="w-3 h-3" />
                        <span>{doubt.upvoterUids?.length || 0}</span>
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-xs sm:text-sm text-slate-100 leading-relaxed break-words">
                  {doubt.text}
                </p>

                {doubt.teacherReply && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1">
                    <div className="text-[11px] font-semibold text-emerald-300">
                      Instructor Reply
                      {doubt.repliedAtMs
                        ? ` · ${formatDateLabel(doubt.repliedAtMs)}`
                        : ""}
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed break-words">
                      {doubt.teacherReply}
                    </p>
                  </div>
                )}

                {isTeacher && (
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <input
                      type="text"
                      value={draftValue}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({
                          ...prev,
                          [doubt.id]: e.target.value,
                        }))
                      }
                      placeholder="Write your explanation or clarification..."
                      maxLength={1000}
                      className="flex-1 min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-950/70 border border-slate-700/80 focus:border-emerald-400 focus:outline-none text-xs text-slate-100 placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      disabled={
                        savingReplyId === doubt.id || !draftValue.trim()
                      }
                      onClick={() => void handleTeacherReply(doubt)}
                      className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                    >
                      {savingReplyId === doubt.id
                        ? "Saving..."
                        : doubt.teacherReply
                        ? "✍️ Update Reply"
                        : "✍️ Reply / Resolve"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
