import React, { useEffect, useMemo, useState } from "react";
import { User } from "firebase/auth";
import {
  CheckCircle2,
  Clock,
  HelpCircle,
  Lock,
  MessageSquarePlus,
  Radio,
  RefreshCw,
  Shield,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import {
  OperationType,
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  db,
  doc,
  getDoc,
  handleFirestoreError,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "../firebase";
import {
  AttendedClassEntry,
  CONFUSION_REASONS,
  ConfusionReason,
  DoubtDoc,
  ParticipantDoc,
  PollDoc,
  PollVoteDoc,
  PulseStatus,
  QuizBatchDoc,
  QuizResponseDoc,
  RoomDoc,
  StudentVisibility,
} from "../types";
import {
  formatRoomCode,
  getStoredStudentVisibility,
  resolveStudentDisplayName,
  saveStudentVisibility,
  selectUniqueQuestionsForStudent,
} from "../utils/roomUtils";
import { LectureNotesPanel } from "./LectureNotesPanel";
import { PostClassDoubtPortal } from "./PostClassDoubtPortal";

interface StudentViewProps {
  roomCode: string;
  user: User;
  onBackToLobby: () => void;
  onViewStudentSummary: (roomCode: string) => void;
  onAccessDenied?: (message: string) => void;
  onRoomContextChange?: (ctx: {
    activeTopic: string;
    activeSubheading?: string;
    roomTitle: string;
  }) => void;
}

export function StudentView({
  roomCode,
  user,
  onBackToLobby,
  onViewStudentSummary,
  onAccessDenied,
  onRoomContextChange,
}: StudentViewProps) {
  const [room, setRoom] = useState<RoomDoc | null>(null);
  const [accessVerified, setAccessVerified] = useState(false);
  const [participant, setParticipant] = useState<ParticipantDoc | null>(null);
  const [visibility, setVisibility] = useState<StudentVisibility>(() =>
    getStoredStudentVisibility()
  );
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [activePoll, setActivePoll] = useState<PollDoc | null>(null);
  const [myVote, setMyVote] = useState<PollVoteDoc | null>(null);
  const [localPollAnswers, setLocalPollAnswers] = useState<Record<string, number>>(
    {}
  );
  const [doubts, setDoubts] = useState<DoubtDoc[]>([]);
  const [doubtInput, setDoubtInput] = useState("");
  const [submittingDoubt, setSubmittingDoubt] = useState(false);
  const [doubtError, setDoubtError] = useState<string | null>(null);

  const [respondedRecheckId, setRespondedRecheckId] = useState<string | null>(
    null
  );
  const [submittingRecheck, setSubmittingRecheck] = useState(false);

  // Active AI 5-Q Set or Written Question state
  const [activeQuiz, setActiveQuiz] = useState<QuizBatchDoc | null>(null);
  const [myQuizResponse, setMyQuizResponse] = useState<QuizResponseDoc | null>(
    null
  );
  const [mcqDraftAnswers, setMcqDraftAnswers] = useState<
    Record<string, number>
  >({});
  const [writtenDraft, setWrittenDraft] = useState("");
  const [submittingQuiz, setSubmittingQuiz] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [submittingPulse, setSubmittingPulse] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [submittingVote, setSubmittingVote] = useState(false);

  const isCooldownActive = cooldownSeconds > 0;
  useEffect(() => {
    if (!isCooldownActive) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [isCooldownActive]);

  useEffect(() => {
    if (!onRoomContextChange) return;
    if (!accessVerified) {
      onRoomContextChange({
        activeTopic: "",
        activeSubheading: "",
        roomTitle: "",
      });
      return;
    }
    onRoomContextChange({
      activeTopic: room?.currentMainTopic || room?.currentTopic || "",
      activeSubheading: room?.currentSubheading || "",
      roomTitle: room?.title || "",
    });
    return () => {
      onRoomContextChange({
        activeTopic: "",
        activeSubheading: "",
        roomTitle: "",
      });
    };
  }, [
    accessVerified,
    room?.currentMainTopic,
    room?.currentTopic,
    room?.currentSubheading,
    room?.title,
    onRoomContextChange,
  ]);

  // Verify strict enrollment before unlocking any classroom features or history
  useEffect(() => {
    if (!room) {
      setAccessVerified(false);
      return;
    }
    if (room.hostUid === user.uid) {
      setAccessVerified(true);
      return;
    }

    let cancelled = false;
    const verifyMembership = async () => {
      try {
        const [pRes, aRes, rRes] = await Promise.allSettled([
          getDoc(doc(db, "rooms", roomCode, "participants", user.uid)),
          getDoc(doc(db, "users", user.uid, "attendedClasses", roomCode)),
          getDoc(doc(db, "users", user.uid, "attendedRooms", roomCode)),
        ]);

        if (cancelled) return;

        const isEnrolled =
          (pRes.status === "fulfilled" && pRes.value.exists()) ||
          (aRes.status === "fulfilled" && aRes.value.exists()) ||
          (rRes.status === "fulfilled" && rRes.value.exists());

        if (isEnrolled) {
          setAccessVerified(true);
        } else {
          setAccessVerified(false);
          onAccessDenied?.(
            "Access restricted — please scan the classroom QR or enter the live join code to unlock this class."
          );
        }
      } catch {
        if (!cancelled) {
          setAccessVerified(false);
          onAccessDenied?.(
            "Access restricted — please scan the classroom QR or enter the live join code to unlock this class."
          );
        }
      }
    };

    void verifyMembership();
    return () => {
      cancelled = true;
    };
  }, [room?.roomCode, room?.hostUid, roomCode, user.uid, onAccessDenied]);

  // Sync student's private attendedClasses & attendedRooms ONLY after enrollment is verified
  useEffect(() => {
    if (!room || !accessVerified || room.hostUid === user.uid) return;
    const attendedRef = doc(db, "users", user.uid, "attendedClasses", roomCode);
    const attendedRoomRef = doc(db, "users", user.uid, "attendedRooms", roomCode);
    getDoc(attendedRef)
      .then((snap) => {
        const existing = snap.exists() ? (snap.data() as AttendedClassEntry) : null;
        if (existing?.pollAnswers) {
          setLocalPollAnswers((prev) => ({ ...existing.pollAnswers, ...prev }));
        }
        const joinedAt = existing?.joinedAtMs ?? Date.now();
        return Promise.allSettled([
          setDoc(
            attendedRef,
            {
              roomCode,
              title: room.title,
              status: room.status,
              joinedAtMs: joinedAt,
              pollAnswers: existing?.pollAnswers ?? {},
            },
            { merge: true }
          ),
          setDoc(
            attendedRoomRef,
            {
              roomCode,
              title: room.title,
              status: room.status,
              joinedAtMs: joinedAt,
              verifiedAtMs: Date.now(),
            },
            { merge: true }
          ),
        ]);
      })
      .catch(() => {
        // Non-blocking private history write
      });
  }, [
    accessVerified,
    room?.roomCode,
    room?.title,
    room?.status,
    room?.hostUid,
    roomCode,
    user.uid,
  ]);

  // Listen to live room state
  useEffect(() => {
    setAccessVerified(false);
    setLoading(true);
    const path = `rooms/${roomCode}`;
    const unsub = onSnapshot(
      doc(db, "rooms", roomCode),
      (snap) => {
        if (!snap.exists()) {
          setRoom(null);
          setLoading(false);
          return;
        }
        setRoom(snap.data() as RoomDoc);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        handleFirestoreError(err, OperationType.GET, path);
      }
    );
    return () => unsub();
  }, [roomCode]);

  // Listen to this student's own anonymous participant state once verified
  useEffect(() => {
    if (!accessVerified) return;
    const path = `rooms/${roomCode}/participants/${user.uid}`;
    const unsub = onSnapshot(
      doc(db, "rooms", roomCode, "participants", user.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Omit<ParticipantDoc, "uid">;
          setParticipant({
            uid: snap.id,
            ...data,
          });
          if (
            data.visibility === "anonymous" ||
            data.visibility === "teacher" ||
            data.visibility === "public"
          ) {
            setVisibility(data.visibility);
          }
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, path);
      }
    );
    return () => unsub();
  }, [accessVerified, roomCode, user.uid]);

  // Listen to anonymous doubts wall once verified
  useEffect(() => {
    if (!accessVerified) {
      setDoubts([]);
      return;
    }
    const q = query(
      collection(db, "rooms", roomCode, "doubts"),
      orderBy("createdAtMs", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: DoubtDoc[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<DoubtDoc, "id">),
        }));
        setDoubts(list);
      },
      () => {
        // Non-blocking fallback
      }
    );
    return () => unsub();
  }, [accessVerified, roomCode]);

  // Listen to active poll OR most recently closed poll so answer reveal appears immediately
  const targetPollId = room?.activePollId || room?.lastPollId || null;

  useEffect(() => {
    if (!accessVerified || !targetPollId) {
      setActivePoll(null);
      setMyVote(null);
      return;
    }

    const pollPath = `rooms/${roomCode}/polls/${targetPollId}`;
    const unsubPoll = onSnapshot(
      doc(db, "rooms", roomCode, "polls", targetPollId),
      (snap) => {
        if (snap.exists()) {
          setActivePoll({
            id: snap.id,
            ...(snap.data() as Omit<PollDoc, "id">),
          });
        } else {
          setActivePoll(null);
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, pollPath);
      }
    );

    const votePath = `rooms/${roomCode}/polls/${targetPollId}/votes/${user.uid}`;
    const unsubVote = onSnapshot(
      doc(db, "rooms", roomCode, "polls", targetPollId, "votes", user.uid),
      (snap) => {
        if (snap.exists()) {
          const voteData = {
            uid: snap.id,
            ...(snap.data() as Omit<PollVoteDoc, "uid">),
          };
          setMyVote(voteData);
          setLocalPollAnswers((prev) => ({
            ...prev,
            [targetPollId]: voteData.optionIndex,
          }));
        } else {
          setMyVote(null);
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, votePath);
      }
    );

    return () => {
      unsubPoll();
      unsubVote();
    };
  }, [accessVerified, roomCode, targetPollId, user.uid]);

  // Listen to active/last AI 5-Q conceptual quiz OR written question
  const targetQuizId = room?.activeQuizId || room?.lastQuizId || null;

  useEffect(() => {
    if (!accessVerified || !targetQuizId) {
      setActiveQuiz(null);
      setMyQuizResponse(null);
      return;
    }

    const unsubQuiz = onSnapshot(
      doc(db, "rooms", roomCode, "quizzes", targetQuizId),
      (snap) => {
        if (snap.exists()) {
          setActiveQuiz({
            id: snap.id,
            ...(snap.data() as Omit<QuizBatchDoc, "id">),
          });
        } else {
          setActiveQuiz(null);
        }
      },
      () => {
        // Non-blocking fallback
      }
    );

    const unsubResp = onSnapshot(
      doc(db, "rooms", roomCode, "quizzes", targetQuizId, "responses", user.uid),
      (snap) => {
        if (snap.exists()) {
          setMyQuizResponse({
            uid: snap.id,
            ...(snap.data() as Omit<QuizResponseDoc, "uid">),
          });
        } else {
          setMyQuizResponse(null);
        }
      },
      () => {
        // Non-blocking fallback
      }
    );

    return () => {
      unsubQuiz();
      unsubResp();
    };
  }, [accessVerified, roomCode, targetQuizId, user.uid]);

  // Clear draft selections when quizId or batchVersion changes so refreshed sets unlock cleanly
  useEffect(() => {
    setMcqDraftAnswers({});
    setWrittenDraft("");
    setQuizError(null);
  }, [activeQuiz?.id, activeQuiz?.batchVersion]);

  const isTopicActive = Boolean(room && room.currentTopic && room.topicVersion > 0);
  const syncedToCurrentTopic = Boolean(
    room && participant && participant.topicVersion === room.topicVersion
  );

  const effectiveStatus: PulseStatus =
    syncedToCurrentTopic && participant?.status === "confused"
      ? "confused"
      : "clear";

  const effectiveReasons: ConfusionReason[] =
    syncedToCurrentTopic && effectiveStatus === "confused"
      ? participant?.reasons || []
      : [];

  // Active topic doubts sorted by upvotes desc
  const activeTopicDoubts = useMemo(() => {
    if (!room || !isTopicActive) return [];
    return doubts
      .filter((d) => !d.resolved && d.topicVersion === room.topicVersion)
      .sort(
        (a, b) =>
          (b.upvoterUids?.length || 0) - (a.upvoterUids?.length || 0) ||
          b.createdAtMs - a.createdAtMs
      );
  }, [doubts, room, isTopicActive]);

  // Seeded unique 5-question conceptual set for this student (uid + quizId + batchVersion)
  const assignedQuizQuestions = useMemo(() => {
    if (!activeQuiz || activeQuiz.mode !== "mcq_set" || !activeQuiz.questions?.length) {
      return [];
    }
    return selectUniqueQuestionsForStudent(
      activeQuiz.questions,
      user.uid,
      activeQuiz.id,
      activeQuiz.batchVersion || 1,
      5
    );
  }, [activeQuiz, user.uid]);

  const quizSubmittedForBatch = Boolean(
    activeQuiz &&
      myQuizResponse &&
      myQuizResponse.batchVersion === activeQuiz.batchVersion &&
      myQuizResponse.mode === activeQuiz.mode
  );

  const activeRecheck = room?.activeRecheck ?? null;
  const showRecheckPrompt = Boolean(
    isTopicActive &&
      activeRecheck &&
      activeRecheck.status === "active" &&
      activeRecheck.topicVersion === room?.topicVersion &&
      effectiveStatus === "confused" &&
      respondedRecheckId !== activeRecheck.id
  );

  const resolvedVisibility: StudentVisibility = visibility;
  const resolvedDisplayName: string | null =
    resolvedVisibility === "anonymous" ? null : resolveStudentDisplayName(user);

  const handleChangeVisibility = async (nextVis: StudentVisibility) => {
    setVisibility(nextVis);
    saveStudentVisibility(nextVis);
    if (!room || room.status !== "live" || savingVisibility) return;
    setSavingVisibility(true);
    const nowMs = Date.now();
    const nextName =
      nextVis === "anonymous" ? null : resolveStudentDisplayName(user);
    try {
      await setDoc(doc(db, "rooms", roomCode, "participants", user.uid), {
        status: effectiveStatus,
        reasons: effectiveReasons,
        topic: room.currentTopic || "",
        topicVersion: room.topicVersion || 0,
        joinedAtMs: participant?.joinedAtMs ?? nowMs,
        updatedAtMs: nowMs,
        visibility: nextVis,
        displayName: nextName,
      });
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `rooms/${roomCode}/participants/${user.uid}`
      );
    } finally {
      setSavingVisibility(false);
    }
  };

  const handleSetPulse = async (nextStatus: PulseStatus) => {
    if (
      !room ||
      room.status !== "live" ||
      !isTopicActive ||
      submittingPulse ||
      cooldownSeconds > 0
    )
      return;

    setSubmittingPulse(true);
    const nowMs = Date.now();
    const path = `rooms/${roomCode}/participants/${user.uid}`;
    const nextReasons: ConfusionReason[] =
      nextStatus === "confused" ? effectiveReasons : [];

    try {
      await setDoc(doc(db, "rooms", roomCode, "participants", user.uid), {
        status: nextStatus,
        reasons: nextReasons,
        topic: room.currentTopic,
        topicVersion: room.topicVersion,
        joinedAtMs: participant?.joinedAtMs ?? nowMs,
        updatedAtMs: nowMs,
        visibility: resolvedVisibility,
        displayName: resolvedDisplayName,
      });
      setCooldownSeconds(15);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setSubmittingPulse(false);
    }
  };

  const handleToggleReason = async (reason: ConfusionReason) => {
    if (!room || room.status !== "live" || !isTopicActive || submittingPulse)
      return;
    setSubmittingPulse(true);
    const nowMs = Date.now();
    const path = `rooms/${roomCode}/participants/${user.uid}`;

    const exists = effectiveReasons.includes(reason);
    const nextReasons = exists
      ? effectiveReasons.filter((r) => r !== reason)
      : [...effectiveReasons, reason];

    try {
      await setDoc(doc(db, "rooms", roomCode, "participants", user.uid), {
        status: "confused",
        reasons: nextReasons,
        topic: room.currentTopic,
        topicVersion: room.topicVersion,
        joinedAtMs: participant?.joinedAtMs ?? nowMs,
        updatedAtMs: nowMs,
        visibility: resolvedVisibility,
        displayName: resolvedDisplayName,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setSubmittingPulse(false);
    }
  };

  const handleRecheckResponse = async (outcome: "cleared" | "still_stuck") => {
    if (!room || !activeRecheck || submittingRecheck) return;
    setSubmittingRecheck(true);
    const nowMs = Date.now();
    try {
      // 1. Update participant status if cleared
      if (outcome === "cleared") {
        await setDoc(doc(db, "rooms", roomCode, "participants", user.uid), {
          status: "clear",
          reasons: [],
          topic: room.currentTopic,
          topicVersion: room.topicVersion,
          joinedAtMs: participant?.joinedAtMs ?? nowMs,
          updatedAtMs: nowMs,
          visibility: resolvedVisibility,
          displayName: resolvedDisplayName,
        });
      }

      // 2. Record anonymous recheck vote
      await setDoc(
        doc(
          db,
          "rooms",
          roomCode,
          "rechecks",
          activeRecheck.id,
          "responses",
          user.uid
        ),
        {
          outcome,
          respondedAtMs: nowMs,
        }
      );

      setRespondedRecheckId(activeRecheck.id);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `rooms/${roomCode}/rechecks/${activeRecheck.id}/responses/${user.uid}`
      );
    } finally {
      setSubmittingRecheck(false);
    }
  };

  const handleSubmitDoubt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!room || room.status !== "live" || !isTopicActive || submittingDoubt)
      return;
    const text = doubtInput.trim();
    if (text.length < 3) {
      setDoubtError("Enter at least 3 characters for your doubt.");
      return;
    }
    setDoubtError(null);
    setSubmittingDoubt(true);
    try {
      await addDoc(collection(db, "rooms", roomCode, "doubts"), {
        text: text.slice(0, 160),
        topic: room.currentTopic,
        topicVersion: room.topicVersion,
        upvoterUids: [user.uid],
        resolved: false,
        createdAtMs: Date.now(),
        visibility: resolvedVisibility,
        displayName: resolvedDisplayName,
      });
      setDoubtInput("");
    } catch (err) {
      setDoubtError(
        err instanceof Error ? err.message : "Could not submit doubt."
      );
    } finally {
      setSubmittingDoubt(false);
    }
  };

  const handleToggleDoubtUpvote = async (doubt: DoubtDoc) => {
    if (!room || room.status !== "live") return;
    const already = (doubt.upvoterUids || []).includes(user.uid);
    try {
      await updateDoc(doc(db, "rooms", roomCode, "doubts", doubt.id), {
        upvoterUids: already ? arrayRemove(user.uid) : arrayUnion(user.uid),
      });
    } catch {
      // Ignore transient upvote error
    }
  };

  const handleVote = async (optionIndex: number) => {
    if (!room || !activePoll || !activePoll.isOpen || myVote || submittingVote) {
      return;
    }
    setSubmittingVote(true);
    const pollId = activePoll.id;
    const path = `rooms/${roomCode}/polls/${pollId}/votes/${user.uid}`;
    try {
      await setDoc(doc(db, "rooms", roomCode, "polls", pollId, "votes", user.uid), {
        optionIndex,
        votedAtMs: Date.now(),
      });
      setLocalPollAnswers((prev) => ({ ...prev, [pollId]: optionIndex }));

      // Persist privately under student's own attendedClasses for post-class revision
      const attendedRef = doc(db, "users", user.uid, "attendedClasses", roomCode);
      await setDoc(
        attendedRef,
        {
          roomCode,
          title: room.title,
          status: room.status,
          pollAnswers: { ...localPollAnswers, [pollId]: optionIndex },
        },
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setSubmittingVote(false);
    }
  };

  const handleSubmitMcqSet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !room ||
      room.status !== "live" ||
      !activeQuiz ||
      activeQuiz.mode !== "mcq_set" ||
      !activeQuiz.isOpen ||
      assignedQuizQuestions.length === 0 ||
      submittingQuiz
    ) {
      return;
    }

    const answers = assignedQuizQuestions.map((q) => mcqDraftAnswers[q.id]);
    if (answers.some((a) => a === undefined || a < 0 || a > 3)) {
      setQuizError(
        `Please select an option for all ${assignedQuizQuestions.length} questions before submitting.`
      );
      return;
    }

    setQuizError(null);
    setSubmittingQuiz(true);
    let score = 0;
    assignedQuizQuestions.forEach((q, idx) => {
      if (answers[idx] === q.correctIndex) score += 1;
    });

    const path = `rooms/${roomCode}/quizzes/${activeQuiz.id}/responses/${user.uid}`;
    try {
      await setDoc(doc(db, "rooms", roomCode, "quizzes", activeQuiz.id, "responses", user.uid), {
        mode: "mcq_set",
        batchVersion: activeQuiz.batchVersion || 1,
        questionIds: assignedQuizQuestions.map((q) => q.id),
        answers,
        score,
        totalQuestions: assignedQuizQuestions.length,
        submittedAtMs: Date.now(),
        visibility: resolvedVisibility,
        displayName: resolvedDisplayName,
      });
    } catch (err) {
      setQuizError(
        err instanceof Error ? err.message : "Could not submit your answers."
      );
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setSubmittingQuiz(false);
    }
  };

  const handleSubmitWrittenQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !room ||
      room.status !== "live" ||
      !activeQuiz ||
      activeQuiz.mode !== "written" ||
      !activeQuiz.isOpen ||
      submittingQuiz
    ) {
      return;
    }

    const trimmed = writtenDraft.trim();
    if (trimmed.length < 3) {
      setQuizError("Please enter at least 3 characters for your written response.");
      return;
    }

    setQuizError(null);
    setSubmittingQuiz(true);
    const path = `rooms/${roomCode}/quizzes/${activeQuiz.id}/responses/${user.uid}`;
    try {
      await setDoc(doc(db, "rooms", roomCode, "quizzes", activeQuiz.id, "responses", user.uid), {
        mode: "written",
        batchVersion: activeQuiz.batchVersion || 1,
        writtenAnswer: trimmed.slice(0, 1200),
        submittedAtMs: Date.now(),
        visibility: resolvedVisibility,
        displayName: resolvedDisplayName,
      });
    } catch (err) {
      setQuizError(
        err instanceof Error ? err.message : "Could not submit your written answer."
      );
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setSubmittingQuiz(false);
    }
  };

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-10">
        <div className="pp-card border rounded-2xl p-6 text-sm text-slate-400">
          Connecting to classroom session...
        </div>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-12">
        <div className="pp-card border rounded-2xl p-6 sm:p-8 space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-100">
            Room Not Found
          </h1>
          <p className="text-sm text-slate-400">
            Session {formatRoomCode(roomCode)} could not be found. Double check
            the 6-character code from your instructor.
          </p>
          <button
            type="button"
            onClick={onBackToLobby}
            className="min-h-[48px] px-5 py-2.5 rounded-xl pp-primary-btn text-white text-sm font-semibold"
          >
            Back to Lobby
          </button>
        </div>
      </main>
    );
  }

  if (!accessVerified) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-12">
        <div className="pp-card border rounded-2xl p-6 sm:p-8 space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-100">
            Verifying Classroom Access
          </h1>
          <p className="text-sm text-slate-400">
            Checking your enrollment for session {formatRoomCode(roomCode)}...
          </p>
          <button
            type="button"
            onClick={onBackToLobby}
            className="min-h-[48px] px-5 py-2.5 rounded-xl pp-primary-btn text-white text-sm font-semibold"
          >
            Return to Join a Lecture
          </button>
        </div>
      </main>
    );
  }

  if (room.status === "ended") {
    const topicOptions = Array.from(
      new Set([
        ...(room.topicHistory || []).map((t) => t.mainTopic || t.topic),
        room.currentMainTopic || room.currentTopic || "",
      ].filter(Boolean))
    );
    return (
      <main className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-6">
        <div className="pp-card backdrop-blur-xl border rounded-2xl p-6 sm:p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-2xl font-bold text-slate-100">
              Lecture Ended
            </h1>
            <p className="text-sm text-slate-400">
              {room.title} ({formatRoomCode(room.roomCode)}) has finished. Review
              topics to revisit, download lecture notes, or ask post-class doubts
              below.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <button
              type="button"
              onClick={() => onViewStudentSummary(roomCode)}
              className="min-h-[48px] px-6 py-2.5 rounded-xl pp-primary-btn text-white text-sm font-semibold"
            >
              View Revision &amp; Poll Summary
            </button>
            <button
              type="button"
              onClick={onBackToLobby}
              className="min-h-[48px] px-6 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium"
            >
              Return to Lobby
            </button>
          </div>
        </div>

        <LectureNotesPanel roomCode={roomCode} user={user} canUpload={false} />

        <PostClassDoubtPortal
          roomCode={roomCode}
          user={user}
          isTeacher={false}
          topicOptions={topicOptions}
        />
      </main>
    );
  }

  const isConfusedActive = isTopicActive && effectiveStatus === "confused";
  const isClearActive = isTopicActive && effectiveStatus === "clear";
  const optionLetters = ["A", "B", "C", "D"];

  const chosenOptionIndex =
    activePoll && myVote
      ? myVote.optionIndex
      : activePoll && localPollAnswers[activePoll.id] !== undefined
      ? localPollAnswers[activePoll.id]
      : null;

  const isPollClosedReveal = Boolean(activePoll && !activePoll.isOpen);
  const hasCorrectAnswer =
    activePoll?.correctOptionIndex !== null &&
    activePoll?.correctOptionIndex !== undefined &&
    activePoll.correctOptionIndex >= 0;
  const studentMatchedCorrect =
    isPollClosedReveal &&
    hasCorrectAnswer &&
    chosenOptionIndex !== null &&
    chosenOptionIndex === activePoll?.correctOptionIndex;

  return (
    <main className="max-w-3xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-5">
      {/* Live Topic Card + Compact 3-Mode Identity Privacy Selector */}
      <section className="pp-card backdrop-blur-xl border rounded-3xl p-5 sm:p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <Radio className="w-3.5 h-3.5 shrink-0" />
            <span>Live Lecture</span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono text-sky-400">
              {formatRoomCode(room.roomCode)}
            </span>
          </div>
          <span className="text-slate-400 truncate max-w-[200px] sm:max-w-xs">
            {room.title}
          </span>
        </div>

        {/* Compact 3-Mode Identity Privacy Pill Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 pb-2 border-b border-slate-800/80">
          <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Identity Mode:</span>
          </span>
          <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl pp-input border">
            {(
              [
                { id: "anonymous", label: "🔒 Anonymous" },
                { id: "teacher", label: "👨‍🏫 Teacher Only" },
                { id: "public", label: "🌐 Show to All" },
              ] as const
            ).map((opt) => {
              const active = resolvedVisibility === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={savingVisibility}
                  onClick={() => void handleChangeVisibility(opt.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                    active
                      ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/60"
                      : "text-slate-400 hover:text-slate-200 border border-transparent"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-1">
          <div className="text-xs text-slate-400">Main Topic &amp; Subheading</div>
          {isTopicActive ? (
            <div className="mt-0.5 space-y-1.5">
              <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-50 leading-snug break-words">
                {room.currentMainTopic || room.currentTopic}
              </h1>
              {room.currentSubheading && (
                <div className="inline-flex flex-wrap items-center gap-1.5 px-3 py-1 rounded-xl bg-sky-500/15 border border-sky-400/35 text-xs font-semibold text-sky-200">
                  <span className="text-sky-400">Subheading:</span>
                  <span>{room.currentSubheading}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2.5 p-3.5 rounded-2xl pp-input border text-amber-300 text-sm font-medium">
              <Clock className="w-4 h-4 shrink-0" />
              <span>Waiting for teacher to start a topic...</span>
            </div>
          )}
        </div>
      </section>

      {/* Smart Re-Check Pulse Prompt for Confused Students */}
      {showRecheckPrompt && (
        <section className="bg-sky-500/15 border border-sky-400/50 rounded-3xl p-5 space-y-3 shadow-lg">
          <div className="flex items-center gap-2 text-xs font-bold text-sky-300">
            <RefreshCw className="w-4 h-4 text-sky-400 shrink-0" />
            <span>Instructor Re-Check Pulse</span>
          </div>
          <h2 className="font-display text-base sm:text-lg font-bold text-slate-50">
            Did that re-explanation clear your doubt?
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={submittingRecheck}
              onClick={() => void handleRecheckResponse("cleared")}
              className="min-h-[48px] px-4 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
            >
              ✅ Yes, Got It!
            </button>
            <button
              type="button"
              disabled={submittingRecheck}
              onClick={() => void handleRecheckResponse("still_stuck")}
              className="min-h-[48px] px-4 py-2.5 rounded-2xl bg-amber-600/90 hover:bg-amber-500 text-white text-sm font-semibold transition-colors"
            >
              😕 Still Stuck
            </button>
          </div>
        </section>
      )}

      {/* Live Micro-Poll Card OR Closed Poll Answer Reveal & Match Card */}
      {activePoll && (
        <section className="pp-card-strong backdrop-blur-xl border pp-accent-border rounded-3xl p-5 sm:p-6 space-y-4 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-sky-400">
              {activePoll.isOpen
                ? "Live Micro-Poll from Instructor"
                : "Poll Closed — Answer & Class Breakdown"}
            </span>
            {chosenOptionIndex !== null && activePoll.isOpen && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Vote Locked</span>
              </span>
            )}
          </div>

          <h2 className="font-display text-lg sm:text-xl font-bold text-slate-100 leading-snug break-words">
            {activePoll.question}
          </h2>

          {isPollClosedReveal && hasCorrectAnswer && (
            <div
              className={`p-3.5 rounded-2xl border flex items-start gap-2.5 text-xs sm:text-sm font-semibold ${
                chosenOptionIndex === null
                  ? "bg-slate-800/70 border-slate-700 text-slate-200"
                  : studentMatchedCorrect
                  ? "bg-emerald-500/15 border-emerald-500/45 text-emerald-200"
                  : "bg-rose-500/15 border-rose-500/45 text-rose-200"
              }`}
            >
              {chosenOptionIndex === null ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <span>
                    Correct Answer was Option{" "}
                    {optionLetters[activePoll.correctOptionIndex!]}:{" "}
                    {activePoll.options[activePoll.correctOptionIndex!]}
                  </span>
                </>
              ) : studentMatchedCorrect ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>✅ Correct! You matched the right answer</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    ❌ Incorrect — Correct answer was Option{" "}
                    {optionLetters[activePoll.correctOptionIndex!]} (
                    {activePoll.options[activePoll.correctOptionIndex!]})
                  </span>
                </>
              )}
            </div>
          )}

          {activePoll.isOpen ? (
            <div className="space-y-2.5">
              {activePoll.options.map((opt, idx) => {
                const selected = chosenOptionIndex === idx;
                const locked = chosenOptionIndex !== null;
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={submittingVote || locked}
                    onClick={() => void handleVote(idx)}
                    className={`w-full min-h-[50px] px-4 py-3 rounded-2xl border text-left text-sm font-medium transition-all flex items-center justify-between gap-3 ${
                      selected
                        ? "bg-sky-500/20 border-sky-400 text-sky-100"
                        : locked
                        ? "pp-input border-slate-800/60 text-slate-500 cursor-not-allowed"
                        : "pp-input hover:border-slate-600 text-slate-200 active:scale-[0.99]"
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono text-xs text-slate-400 shrink-0">
                        {optionLetters[idx] ?? idx + 1}.
                      </span>
                      <span className="break-words">{opt}</span>
                    </span>
                    {selected && (
                      <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {activePoll.options.map((opt, idx) => {
                const counts = activePoll.finalCounts || [];
                const total =
                  activePoll.finalTotalVotes ??
                  counts.reduce((acc, c) => acc + c, 0);
                const count = counts[idx] ?? 0;
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                const isCorrect = activePoll.correctOptionIndex === idx;
                const isMine = chosenOptionIndex === idx;
                return (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-slate-100 break-words">
                        <span className="font-mono text-slate-400 mr-1.5">
                          {optionLetters[idx] ?? idx + 1}.
                        </span>
                        {opt}
                        {isCorrect && (
                          <span className="ml-2 text-emerald-400 font-semibold">
                            ✓ Correct
                          </span>
                        )}
                        {isMine && (
                          <span className="ml-2 text-sky-400 font-semibold">
                            (Your Pick)
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-slate-300 shrink-0 tabular-nums">
                        {pct}%
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full pp-input border overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isCorrect ? "bg-emerald-500" : "bg-sky-500"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
            <span>
              {activePoll.isOpen
                ? chosenOptionIndex !== null
                  ? "Your anonymous vote is locked in. Waiting for instructor to reveal results."
                  : "One-tap anonymous voting · 1 vote per student"
                : "Class-wide results revealed anonymously."}
            </span>
          </p>
        </section>
      )}

      {/* AI 5-Question Conceptual Set (Unique Per Student) OR Written Question */}
      {activeQuiz && (
        <section className="pp-card-strong backdrop-blur-xl border border-indigo-400/40 rounded-3xl p-5 sm:p-6 space-y-4 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <span className="text-xs font-semibold text-indigo-300">
                {activeQuiz.mode === "mcq_set"
                  ? `5-Question Conceptual Set (Set #${activeQuiz.batchVersion || 1}) — Unique to You`
                  : `Written Quick Check (Set #${activeQuiz.batchVersion || 1})`}
              </span>
              <div className="text-[11px] text-slate-400">
                Topic: {activeQuiz.mainTopic}
                {activeQuiz.subheading ? ` · ${activeQuiz.subheading}` : ""}
              </div>
            </div>
            {quizSubmittedForBatch ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Submitted</span>
              </span>
            ) : !activeQuiz.isOpen ? (
              <span className="text-xs font-medium text-slate-400">Closed</span>
            ) : null}
          </div>

          {activeQuiz.mode === "mcq_set" && assignedQuizQuestions.length > 0 && (
            <>
              {quizSubmittedForBatch && myQuizResponse ? (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-between gap-3">
                    <div className="text-xs sm:text-sm font-semibold text-emerald-200">
                      Your Score: {myQuizResponse.score ?? 0} /{" "}
                      {myQuizResponse.totalQuestions ?? assignedQuizQuestions.length}{" "}
                      correct
                    </div>
                    <span className="font-mono text-sm font-bold text-emerald-300 tabular-nums">
                      {Math.round(
                        ((myQuizResponse.score ?? 0) /
                          Math.max(
                            1,
                            myQuizResponse.totalQuestions ?? assignedQuizQuestions.length
                          )) *
                          100
                      )}
                      %
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {assignedQuizQuestions.map((q, qIdx) => {
                      const pickedIdx = myQuizResponse.answers?.[qIdx] ?? -1;
                      const isRight = pickedIdx === q.correctIndex;
                      return (
                        <div
                          key={q.id}
                          className={`p-3.5 rounded-2xl border space-y-1.5 ${
                            isRight
                              ? "bg-emerald-500/10 border-emerald-500/35"
                              : "bg-rose-500/10 border-rose-500/35"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                            <span>{q.category}</span>
                            <span
                              className={`font-semibold ${
                                isRight ? "text-emerald-300" : "text-rose-300"
                              }`}
                            >
                              {isRight ? "✓ Correct" : "✗ Review"}
                            </span>
                          </div>
                          <div className="text-xs sm:text-sm font-semibold text-slate-100">
                            Q{qIdx + 1}. {q.question}
                          </div>
                          <div className="text-xs text-slate-300">
                            Your pick:{" "}
                            <span className="font-medium">
                              {pickedIdx >= 0
                                ? `${optionLetters[pickedIdx] ?? pickedIdx + 1}. ${q.options[pickedIdx]}`
                                : "—"}
                            </span>
                            {!isRight && (
                              <span className="block text-emerald-300 mt-0.5">
                                Correct: {optionLetters[q.correctIndex]}.{" "}
                                {q.options[q.correctIndex]}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            {q.explanation}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : activeQuiz.isOpen ? (
                <form onSubmit={handleSubmitMcqSet} className="space-y-4">
                  <div className="space-y-3.5">
                    {assignedQuizQuestions.map((q, qIdx) => {
                      const selected = mcqDraftAnswers[q.id];
                      return (
                        <div
                          key={q.id}
                          className="p-3.5 rounded-2xl pp-input border space-y-2.5"
                        >
                          <div className="text-[11px] font-medium text-indigo-300">
                            {q.category}
                          </div>
                          <div className="text-xs sm:text-sm font-semibold text-slate-100 leading-snug">
                            Q{qIdx + 1}. {q.question}
                          </div>
                          <div className="space-y-1.5">
                            {q.options.map((opt, oIdx) => {
                              const isPicked = selected === oIdx;
                              return (
                                <button
                                  key={oIdx}
                                  type="button"
                                  disabled={submittingQuiz}
                                  onClick={() =>
                                    setMcqDraftAnswers((prev) => ({
                                      ...prev,
                                      [q.id]: oIdx,
                                    }))
                                  }
                                  className={`w-full px-3 py-2.5 rounded-xl border text-left text-xs font-medium transition-colors flex items-center justify-between gap-2 ${
                                    isPicked
                                      ? "bg-indigo-500/20 border-indigo-400 text-indigo-100"
                                      : "bg-slate-950/60 border-slate-800 hover:border-slate-600 text-slate-300"
                                  }`}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <span className="font-mono text-slate-400 shrink-0">
                                      {optionLetters[oIdx]}.
                                    </span>
                                    <span className="break-words">{opt}</span>
                                  </span>
                                  {isPicked && (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {quizError && (
                    <p className="text-xs text-rose-300">{quizError}</p>
                  )}

                  <button
                    type="submit"
                    disabled={submittingQuiz}
                    className="w-full min-h-[48px] px-4 py-2.5 rounded-2xl pp-primary-btn disabled:opacity-50 text-white text-sm font-semibold"
                  >
                    {submittingQuiz
                      ? "Submitting 5 Answers..."
                      : "Submit 5 Answers"}
                  </button>
                </form>
              ) : (
                <p className="text-xs text-slate-400">
                  This 5-question conceptual set has been closed by the instructor.
                </p>
              )}
            </>
          )}

          {activeQuiz.mode === "written" && (
            <>
              <div className="p-3.5 rounded-2xl pp-input border text-sm font-semibold text-slate-100 leading-snug">
                {activeQuiz.writtenPrompt || "Share your written answer below:"}
              </div>

              {quizSubmittedForBatch && myQuizResponse ? (
                <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 space-y-1.5">
                  <div className="text-xs font-semibold text-emerald-300">
                    ✓ Your written response was submitted
                  </div>
                  <p className="text-xs sm:text-sm text-slate-200 break-words">
                    {myQuizResponse.writtenAnswer}
                  </p>
                </div>
              ) : activeQuiz.isOpen ? (
                <form onSubmit={handleSubmitWrittenQuiz} className="space-y-3">
                  <textarea
                    value={writtenDraft}
                    onChange={(e) => setWrittenDraft(e.target.value)}
                    rows={3}
                    maxLength={1200}
                    disabled={submittingQuiz}
                    placeholder="Type a concise explanation or short answer..."
                    className="w-full px-3.5 py-2.5 rounded-2xl pp-input border focus:border-indigo-400 focus:outline-none text-sm text-slate-100 placeholder:text-slate-500 resize-y"
                  />
                  {quizError && (
                    <p className="text-xs text-rose-300">{quizError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={submittingQuiz || !writtenDraft.trim()}
                    className="w-full min-h-[46px] px-4 py-2.5 rounded-2xl pp-primary-btn disabled:opacity-50 text-white text-sm font-semibold"
                  >
                    {submittingQuiz ? "Submitting..." : "Submit Written Answer"}
                  </button>
                </form>
              ) : (
                <p className="text-xs text-slate-400">
                  Written responses for this question are now closed.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {/* Thumb-Friendly Status Pulse Controls */}
      <section className="pp-card backdrop-blur-xl border rounded-3xl p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="font-display text-base font-bold text-slate-100">
            How is this topic landing?
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {isTopicActive
              ? "Freely switch your status anytime as the explanation progresses"
              : "Pulse controls unlock automatically once the instructor broadcasts a topic"}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            disabled={!isTopicActive || submittingPulse || cooldownSeconds > 0}
            onClick={() => void handleSetPulse("clear")}
            className={`min-h-[116px] p-5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-3 ${
              !isTopicActive
                ? "pp-input opacity-50 text-slate-500 cursor-not-allowed"
                : isClearActive
                ? `bg-emerald-500/20 border-emerald-400 text-emerald-50 ${
                    cooldownSeconds > 0
                      ? "opacity-75 cursor-not-allowed"
                      : "active:scale-[0.98]"
                  }`
                : `pp-input text-slate-300 ${
                    cooldownSeconds > 0
                      ? "opacity-55 cursor-not-allowed"
                      : "hover:border-slate-600 active:scale-[0.98]"
                  }`
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  isClearActive ? "bg-emerald-500/25" : "bg-slate-900"
                }`}
              >
                <ThumbsUp
                  className={`w-5 h-5 ${
                    isClearActive ? "text-emerald-300" : "text-slate-400"
                  }`}
                />
              </div>
              {isClearActive && (
                <span className="text-xs font-semibold text-emerald-300">
                  Active
                </span>
              )}
            </div>
            <div>
              <div className="font-display text-lg font-bold">
                I&apos;m Following 👍
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Concept makes sense right now
              </div>
            </div>
          </button>

          <button
            type="button"
            disabled={!isTopicActive || submittingPulse || cooldownSeconds > 0}
            onClick={() => void handleSetPulse("confused")}
            className={`min-h-[116px] p-5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-3 ${
              !isTopicActive
                ? "pp-input opacity-50 text-slate-500 cursor-not-allowed"
                : isConfusedActive
                ? `bg-amber-500/20 border-amber-400 text-amber-50 animate-confused-pulse ${
                    cooldownSeconds > 0
                      ? "opacity-75 cursor-not-allowed"
                      : "active:scale-[0.98]"
                  }`
                : `pp-input text-slate-300 ${
                    cooldownSeconds > 0
                      ? "opacity-55 cursor-not-allowed"
                      : "hover:border-slate-600 active:scale-[0.98]"
                  }`
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  isConfusedActive ? "bg-amber-500/25" : "bg-slate-900"
                }`}
              >
                <HelpCircle
                  className={`w-5 h-5 ${
                    isConfusedActive ? "text-amber-300" : "text-slate-400"
                  }`}
                />
              </div>
              {isConfusedActive && (
                <span className="text-xs font-semibold text-amber-300">
                  Signaling
                </span>
              )}
            </div>
            <div>
              <div className="font-display text-lg font-bold">
                I&apos;m Confused 😕
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Slow down or revisit this point
              </div>
            </div>
          </button>
        </div>

        {cooldownSeconds > 0 && (
          <div className="flex items-center gap-2 text-xs text-slate-400 tabular-nums">
            <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>
              Please wait {cooldownSeconds}s before switching again...
            </span>
          </div>
        )}

        {/* 1-Tap "Why Am I Confused?" Optional Reason Tags */}
        {isConfusedActive && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3">
            <div className="text-xs font-semibold text-amber-200">
              Why are you confused? (Optional 1-tap feedback)
            </div>
            <div className="flex flex-wrap gap-2">
              {CONFUSION_REASONS.map((reason) => {
                const selected = effectiveReasons.includes(reason);
                return (
                  <button
                    key={reason}
                    type="button"
                    disabled={submittingPulse}
                    onClick={() => void handleToggleReason(reason)}
                    className={`min-h-[44px] px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                      selected
                        ? "bg-amber-500 text-slate-950 border-amber-400"
                        : "pp-input text-amber-100 border-amber-500/30 hover:border-amber-400/60"
                    }`}
                  >
                    {reason}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1 text-xs text-slate-400">
          <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>
            {resolvedVisibility === "anonymous"
              ? "🔒 Anonymous Mode — your name and email are hidden from everyone."
              : resolvedVisibility === "teacher"
              ? `👨‍🏫 Teacher Only — only your instructor sees "${resolvedDisplayName}"; classmates see "Anonymous Student".`
              : `🌐 Show to All — "${resolvedDisplayName}" is visible to your instructor and classmates.`}
          </span>
        </div>
      </section>

      {/* Class Doubts Wall */}
      <section className="pp-card backdrop-blur-xl border rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="w-4 h-4 text-sky-400 shrink-0" />
            <h2 className="font-display text-base font-bold text-slate-100">
              Class Doubts Wall
            </h2>
          </div>
          <span className="text-xs text-slate-400 tabular-nums">
            {activeTopicDoubts.length} active
          </span>
        </div>

        <form onSubmit={handleSubmitDoubt} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            disabled={!isTopicActive || submittingDoubt}
            value={doubtInput}
            onChange={(e) => setDoubtInput(e.target.value)}
            placeholder={
              isTopicActive
                ? `Ask a 1-line doubt on "${room.currentTopic}"...`
                : "Doubts unlock once the instructor broadcasts a topic..."
            }
            maxLength={160}
            className="flex-1 min-h-[48px] px-3.5 py-2.5 rounded-xl pp-input border focus:border-sky-400 focus:outline-none text-sm text-slate-100 placeholder:text-slate-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!isTopicActive || submittingDoubt || !doubtInput.trim()}
            className="min-h-[48px] px-4 py-2.5 rounded-xl pp-primary-btn disabled:opacity-50 text-white text-xs sm:text-sm font-semibold whitespace-nowrap"
          >
            {submittingDoubt
              ? "Posting..."
              : resolvedVisibility === "public"
              ? "Post Doubt"
              : resolvedVisibility === "teacher"
              ? "Ask (Teacher Sees Name)"
              : "Ask Anonymously"}
          </button>
        </form>

        {doubtError && (
          <p className="text-xs text-rose-300">{doubtError}</p>
        )}

        {activeTopicDoubts.length === 0 ? (
          <p className="text-xs text-slate-500">
            No doubts on this topic yet. Submit a 1-line question or
            tap &ldquo;+1 Same Doubt&rdquo; on a classmate&apos;s question to
            avoid duplicates.
          </p>
        ) : (
          <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
            {activeTopicDoubts.map((d) => {
              const upvoted = (d.upvoterUids || []).includes(user.uid);
              const count = d.upvoterUids?.length || 0;
              const authorLabel =
                d.visibility === "public" && d.displayName
                  ? d.displayName
                  : "Anonymous Student";
              return (
                <div
                  key={d.id}
                  className="p-3.5 rounded-2xl pp-input border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="text-[11px] font-medium text-slate-400">
                      {authorLabel}
                    </div>
                    <p className="text-sm text-slate-100 break-words">{d.text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleToggleDoubtUpvote(d)}
                    className={`min-h-[40px] px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                      upvoted
                        ? "bg-sky-500/20 border-sky-400 text-sky-200"
                        : "bg-slate-900 border-slate-700 hover:border-slate-500 text-slate-300"
                    }`}
                  >
                    +1 Same Doubt ({count})
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Lecture Notes & Resources Download */}
      <LectureNotesPanel roomCode={roomCode} user={user} canUpload={false} />
    </main>
  );
}
