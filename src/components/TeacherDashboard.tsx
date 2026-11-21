import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { User } from "firebase/auth";
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FastForward,
  FileText,
  Layers,
  Loader2,
  MessageSquare,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Send,
  Sparkles,
  StopCircle,
  Trash2,
  Users,
  Wand2,
  Zap,
} from "lucide-react";
import {
  OperationType,
  addDoc,
  collection,
  db,
  deleteDoc,
  doc,
  getDocs,
  handleFirestoreError,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "../firebase";
import {
  ArchivedTopicRecord,
  CONFUSION_REASONS,
  ConfusionReason,
  ConceptualMcqItem,
  DoubtDoc,
  ParticipantDoc,
  PollDoc,
  PollVoteDoc,
  QuizBatchDoc,
  QuizResponseDoc,
  RecheckRecord,
  RecheckState,
  ReportDoc,
  RoomDoc,
  SubheadingEntry,
  TimelinePoint,
} from "../types";
import { generateRescuePollDraft } from "../utils/classroomIntelligence";
import { generateConceptualQuestionBank } from "../utils/aiApi";
import {
  buildArchivedTopicRecord,
  buildPollSummary,
  buildTimelineDocId,
  computePaceAssessment,
  computeReasonCounts,
  computeSessionSummary,
  emptyReasonCounts,
  formatDuration,
  formatMinuteLabel,
  formatRoomCode,
  generateRoomCode,
  getMinuteBucketMs,
  getTopReason,
  mergeReasonCounts,
  stripUndefined,
} from "../utils/roomUtils";
import { ConfusionChart } from "./ConfusionChart";
import { LectureNotesPanel } from "./LectureNotesPanel";
import { PaceOMeter } from "./PaceOMeter";
import { QrCodeBox } from "./QrCodeBox";

interface TeacherDashboardProps {
  roomCode: string;
  user: User;
  onSessionEnded: (roomCode: string, report?: ReportDoc) => void;
  onBackToLobby: () => void;
  onAccessDenied?: (message: string) => void;
  onRoomContextChange?: (ctx: {
    activeTopic: string;
    activeSubheading?: string;
    roomTitle: string;
  }) => void;
}

const QUICK_TOPIC_CHIPS = [
  "1. Core Concepts",
  "2. Recursion & Call Stack",
  "3. Memory & Pointers",
  "4. Edge Cases",
  "5. Summary & Q&A",
];

function createSimulatedStudents(
  topic: string,
  topicVersion: number
): ParticipantDoc[] {
  const now = Date.now();
  return Array.from({ length: 100 }, (_, i) => ({
    uid: `sim-${String(i + 1).padStart(3, "0")}`,
    status: "clear",
    reasons: [],
    topic,
    topicVersion,
    joinedAtMs: now,
    updatedAtMs: now,
  }));
}

function createSimulatedDoubts(
  topic: string,
  topicVersion: number
): DoubtDoc[] {
  const now = Date.now();
  const label = topic || "this topic";
  return [
    {
      id: `sim-doubt-1-v${topicVersion}`,
      text: `Could you trace a quick step-by-step example for ${label}?`,
      topic: label,
      topicVersion,
      upvoterUids: Array.from({ length: 19 }, (_, i) => `sim-u-${i}`),
      resolved: false,
      createdAtMs: now - 40000,
    },
    {
      id: `sim-doubt-2-v${topicVersion}`,
      text: `What boundary condition or edge case causes ${label} to fail?`,
      topic: label,
      topicVersion,
      upvoterUids: Array.from({ length: 12 }, (_, i) => `sim-u-${i}`),
      resolved: false,
      createdAtMs: now - 25000,
    },
    {
      id: `sim-doubt-3-v${topicVersion}`,
      text: `Can you briefly recap the transition before the last step?`,
      topic: label,
      topicVersion,
      upvoterUids: Array.from({ length: 7 }, (_, i) => `sim-u-${i}`),
      resolved: false,
      createdAtMs: now - 10000,
    },
  ];
}

export function TeacherDashboard({
  roomCode,
  user,
  onSessionEnded,
  onBackToLobby,
  onAccessDenied,
  onRoomContextChange,
}: TeacherDashboardProps) {
  const [room, setRoom] = useState<RoomDoc | null>(null);
  const [realParticipants, setRealParticipants] = useState<ParticipantDoc[]>([]);
  const [timelinePoints, setTimelinePoints] = useState<TimelinePoint[]>([]);
  const [polls, setPolls] = useState<PollDoc[]>([]);
  const [activePollVotes, setActivePollVotes] = useState<PollVoteDoc[]>([]);
  const [realDoubts, setRealDoubts] = useState<DoubtDoc[]>([]);
  const [recheckResponses, setRecheckResponses] = useState<
    { uid: string; outcome: "cleared" | "still_stuck" }[]
  >([]);
  const [loading, setLoading] = useState(true);

  const [copied, setCopied] = useState(false);
  const [showQrPanel, setShowQrPanel] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [joinSecondsLeft, setJoinSecondsLeft] = useState(10);

  // Topic + Subheading hierarchical broadcast bar state
  const [topicInput, setTopicInput] = useState("");
  const [subheadingInput, setSubheadingInput] = useState("");
  const [broadcastingTopic, setBroadcastingTopic] = useState(false);
  const [updatingSubheading, setUpdatingSubheading] = useState(false);

  // Graph view selector: "live" | "full" | `topic-${topicVersion}`
  const [graphMode, setGraphMode] = useState<string>("live");

  // 100-Student Live Load Simulator
  const [simActive, setSimActive] = useState(false);
  const [simStudents, setSimStudents] = useState<ParticipantDoc[]>([]);
  const [simPollVotes, setSimPollVotes] = useState<PollVoteDoc[]>([]);
  const [simDoubts, setSimDoubts] = useState<DoubtDoc[]>([]);
  const [simResolvedIds, setSimResolvedIds] = useState<Record<string, boolean>>({});
  const [simMinuteOffset, setSimMinuteOffset] = useState(0);
  const simTickRef = useRef(0);
  const simRecoveredRef = useRef(false);
  const simMinuteOffsetRef = useRef(0);
  simMinuteOffsetRef.current = simMinuteOffset;

  // Cumulative reason counts per topicVersion
  const [cumulativeReasonsByVersion, setCumulativeReasonsByVersion] = useState<
    Record<number, Record<ConfusionReason, number>>
  >({});

  // Segmented Poll / AI Question Generator / Written Question state
  const [questionTab, setQuestionTab] = useState<"poll" | "ai_mcq" | "written">("poll");
  const [resultsFocus, setResultsFocus] = useState<"poll" | "quiz">("poll");

  // Custom & Rescue Poll builder state
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [correctOptionIndex, setCorrectOptionIndex] = useState<number | null>(
    null
  );
  const [rescueRationale, setRescueRationale] = useState<string | null>(null);
  const [launchingPoll, setLaunchingPoll] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  // AI Conceptual 5-Q Set & Written Prompt state
  const [aiBank, setAiBank] = useState<ConceptualMcqItem[]>([]);
  const [selectedAiIds, setSelectedAiIds] = useState<Record<string, boolean>>({});
  const [generatingAiBank, setGeneratingAiBank] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [writtenPromptInput, setWrittenPromptInput] = useState("");
  const [launchingQuiz, setLaunchingQuiz] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<QuizBatchDoc | null>(null);
  const [quizResponses, setQuizResponses] = useState<QuizResponseDoc[]>([]);

  // Re-Check Pulse local tracking
  const [triggeringRecheck, setTriggeringRecheck] = useState(false);
  const [localRecheckHistory, setLocalRecheckHistory] = useState<RecheckRecord[]>(
    []
  );

  // End class confirmation modal
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [endingClass, setEndingClass] = useState(false);
  const endingLocallyRef = useRef(false);

  // Combine real Firestore participants + 100 simulated students
  const allParticipants = useMemo(() => {
    if (!simActive) return realParticipants;
    return [...realParticipants, ...simStudents];
  }, [realParticipants, simActive, simStudents]);

  const activeTopicVersion = room?.topicVersion ?? 0;
  const hasActiveTopic = Boolean(room?.currentTopic && activeTopicVersion > 0);

  const metrics = useMemo(() => {
    const total = allParticipants.length;
    if (!hasActiveTopic || total === 0) {
      return {
        total,
        confused: 0,
        clear: total,
        confusionPct: 0,
        understandingPct: 100,
        reasonCounts: emptyReasonCounts(),
        topReason: null as ConfusionReason | null,
      };
    }

    let confused = 0;
    const reasonCounts = emptyReasonCounts();
    for (const p of allParticipants) {
      const synced = p.topicVersion === activeTopicVersion;
      if (synced && p.status === "confused") {
        confused += 1;
        for (const r of p.reasons || []) {
          if (r in reasonCounts) {
            reasonCounts[r] += 1;
          }
        }
      }
    }
    const clear = total - confused;
    const confusionPct = Math.round((confused / total) * 100);
    const understandingPct = 100 - confusionPct;
    return {
      total,
      confused,
      clear,
      confusionPct,
      understandingPct,
      reasonCounts,
      topReason: getTopReason(reasonCounts),
    };
  }, [allParticipants, hasActiveTopic, activeTopicVersion]);

  const confusedStudentsList = useMemo(() => {
    if (!hasActiveTopic) return [];
    return allParticipants.filter(
      (p) => p.topicVersion === activeTopicVersion && p.status === "confused"
    );
  }, [allParticipants, hasActiveTopic, activeTopicVersion]);

  const paceAssessment = useMemo(
    () =>
      computePaceAssessment(
        metrics.confusionPct,
        metrics.total,
        metrics.confused,
        metrics.reasonCounts
      ),
    [metrics]
  );

  useEffect(() => {
    if (!hasActiveTopic) return;
    setCumulativeReasonsByVersion((prev) => {
      const existing = prev[activeTopicVersion] ?? emptyReasonCounts();
      const next = emptyReasonCounts();
      let changed = false;
      for (const r of CONFUSION_REASONS) {
        const maxVal = Math.max(existing[r], metrics.reasonCounts[r]);
        next[r] = maxVal;
        if (maxVal !== existing[r]) changed = true;
      }
      if (!changed && prev[activeTopicVersion]) return prev;
      return { ...prev, [activeTopicVersion]: next };
    });
  }, [hasActiveTopic, activeTopicVersion, metrics.reasonCounts]);

  const activePoll = useMemo(
    () => polls.find((p) => p.id === room?.activePollId) ?? null,
    [polls, room?.activePollId]
  );

  const combinedActivePollVotes = useMemo(() => {
    if (!activePoll) return [];
    return simActive ? [...activePollVotes, ...simPollVotes] : activePollVotes;
  }, [activePoll, simActive, activePollVotes, simPollVotes]);

  const activePollCounts = useMemo(() => {
    if (!activePoll) return [];
    return activePoll.options.map(
      (_, idx) =>
        combinedActivePollVotes.filter((v) => v.optionIndex === idx).length
    );
  }, [activePoll, combinedActivePollVotes]);

  const currentTopicPoints = useMemo(
    () => timelinePoints.filter((pt) => pt.topicVersion === activeTopicVersion),
    [timelinePoints, activeTopicVersion]
  );

  const displayedChartPoints = useMemo(() => {
    if (graphMode === "full") {
      return timelinePoints;
    }
    if (graphMode.startsWith("topic-")) {
      const ver = Number(graphMode.replace("topic-", ""));
      const archived = (room?.topicHistory || []).find(
        (t) => t.topicVersion === ver
      );
      if (archived) return archived.points;
      return timelinePoints.filter((pt) => pt.topicVersion === ver);
    }
    return currentTopicPoints;
  }, [graphMode, timelinePoints, currentTopicPoints, room?.topicHistory]);

  const allSpikes = useMemo(
    () => timelinePoints.filter((pt) => pt.isSpike || pt.confusionPct > 30),
    [timelinePoints]
  );

  // Combined unresolved doubts for Top 3 Upvote Wall
  const combinedTopDoubts = useMemo(() => {
    const merged = simActive
      ? [
          ...realDoubts,
          ...simDoubts.filter((d) => !simResolvedIds[d.id]),
        ]
      : realDoubts;

    return merged
      .filter(
        (d) =>
          !d.resolved &&
          (!hasActiveTopic || d.topicVersion === activeTopicVersion)
      )
      .sort(
        (a, b) =>
          (b.upvoterUids?.length || 0) - (a.upvoterUids?.length || 0) ||
          b.createdAtMs - a.createdAtMs
      )
      .slice(0, 3);
  }, [
    realDoubts,
    simActive,
    simDoubts,
    simResolvedIds,
    hasActiveTopic,
    activeTopicVersion,
  ]);

  useEffect(() => {
    if (!onRoomContextChange) return;
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
    room?.currentTopic,
    room?.currentMainTopic,
    room?.currentSubheading,
    room?.title,
    onRoomContextChange,
  ]);

  const latestMetricsRef = useRef(metrics);
  latestMetricsRef.current = metrics;

  const latestTopicRef = useRef(room?.currentTopic ?? "");
  latestTopicRef.current = room?.currentTopic ?? "";

  const latestSubheadingRef = useRef(room?.currentSubheading ?? "");
  latestSubheadingRef.current = room?.currentSubheading ?? "";

  const latestTopicVersionRef = useRef(activeTopicVersion);
  latestTopicVersionRef.current = activeTopicVersion;

  const roomStatusRef = useRef(room?.status ?? "live");
  roomStatusRef.current = room?.status ?? "live";

  const activeJoinCodeRef = useRef<string | null>(room?.activeJoinCode ?? null);
  if (room?.activeJoinCode !== undefined) {
    activeJoinCodeRef.current = room.activeJoinCode;
  }

  const codeExpiresAtRef = useRef<number>(room?.codeExpiresAt || 0);
  if (typeof room?.codeExpiresAt === "number") {
    codeExpiresAtRef.current = room.codeExpiresAt;
  }

  const joinCodeUpdatedAtRef = useRef(room?.joinCodeUpdatedAtMs || Date.now());
  joinCodeUpdatedAtRef.current = room?.joinCodeUpdatedAtMs || Date.now();

  const lastWriteAtRef = useRef<number>(0);
  const wasAboveSpikeRef = useRef<boolean>(false);

  // Strict 1-Minute Bucket Upsert: updates the live minute's point and advances every 60s (or via simMinuteOffset)
  const upsertMinuteTimelinePoint = useCallback(
    async (force = false, explicitMinuteOffset?: number) => {
      if (roomStatusRef.current !== "live") return;
      if (!latestTopicRef.current || latestTopicVersionRef.current <= 0) return;

      const realNowMs = Date.now();
      if (!force && realNowMs - lastWriteAtRef.current < 1800) return;

      const m = latestMetricsRef.current;
      if (!force && m.total === 0) return;

      lastWriteAtRef.current = realNowMs;
      const offsetMinutes =
        explicitMinuteOffset !== undefined
          ? explicitMinuteOffset
          : simMinuteOffsetRef.current;
      const effectiveMs = realNowMs + offsetMinutes * 60000;
      const minuteBucketMs = getMinuteBucketMs(effectiveMs);
      const timeLabel = formatMinuteLabel(minuteBucketMs);
      const pointId = buildTimelineDocId(
        minuteBucketMs,
        latestTopicVersionRef.current
      );
      const isSpike = m.confusionPct > 30;

      try {
        await setDoc(
          doc(db, "rooms", roomCode, "timeline", pointId),
          stripUndefined({
            timestampMs: effectiveMs,
            minuteBucketMs,
            timeLabel,
            topic: latestTopicRef.current,
            mainTopic: latestTopicRef.current,
            subheading: latestSubheadingRef.current || undefined,
            topicVersion: latestTopicVersionRef.current,
            confusionPct: m.confusionPct,
            understandingPct: m.understandingPct,
            confusedCount: m.confused,
            clearCount: m.clear,
            totalParticipants: m.total,
            isSpike,
            topReason: m.topReason ?? null,
          }),
          { merge: true }
        );
      } catch (err) {
        if (!endingLocallyRef.current) {
          handleFirestoreError(
            err,
            OperationType.WRITE,
            `rooms/${roomCode}/timeline/${pointId}`
          );
        }
      }
    },
    [roomCode]
  );

  // Listen to room document
  useEffect(() => {
    const roomPath = `rooms/${roomCode}`;
    const unsub = onSnapshot(
      doc(db, "rooms", roomCode),
      (snap) => {
        if (!snap.exists()) {
          setRoom(null);
          setLoading(false);
          return;
        }
        const data = snap.data() as RoomDoc;
        if (data.hostUid !== user.uid) {
          setLoading(false);
          if (onAccessDenied) {
            onAccessDenied(
              "Access restricted — please scan the classroom QR or enter the live join code to unlock this class."
            );
            return;
          }
        }
        setRoom(data);
        setLoading(false);
        if (data.status === "ended" && !endingLocallyRef.current) {
          onSessionEnded(roomCode);
        }
      },
      (err) => {
        setLoading(false);
        handleFirestoreError(err, OperationType.GET, roomPath);
      }
    );
    return () => unsub();
  }, [roomCode, onSessionEnded]);

  // Listen to anonymous participants
  useEffect(() => {
    const path = `rooms/${roomCode}/participants`;
    const unsub = onSnapshot(
      collection(db, "rooms", roomCode, "participants"),
      (snap) => {
        const list: ParticipantDoc[] = snap.docs.map((d) => ({
          uid: d.id,
          ...(d.data() as Omit<ParticipantDoc, "uid">),
        }));
        setRealParticipants(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );
    return () => unsub();
  }, [roomCode]);

  // Listen to 1-minute timeline points
  useEffect(() => {
    const path = `rooms/${roomCode}/timeline`;
    const q = query(
      collection(db, "rooms", roomCode, "timeline"),
      orderBy("timestampMs", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const pts: TimelinePoint[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<TimelinePoint, "id">),
        }));
        setTimelinePoints(pts);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );
    return () => unsub();
  }, [roomCode]);

  // Listen to anonymous doubts
  useEffect(() => {
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
        setRealDoubts(list);
      },
      () => {
        // Non-blocking fallback
      }
    );
    return () => unsub();
  }, [roomCode]);

  // Listen to active Re-Check Pulse responses
  const activeRecheckId = room?.activeRecheck?.id ?? null;
  useEffect(() => {
    if (!activeRecheckId) {
      setRecheckResponses([]);
      return;
    }
    const unsub = onSnapshot(
      collection(db, "rooms", roomCode, "rechecks", activeRecheckId, "responses"),
      (snap) => {
        setRecheckResponses(
          snap.docs.map((d) => ({
            uid: d.id,
            outcome: (d.data() as { outcome: "cleared" | "still_stuck" }).outcome,
          }))
        );
      },
      () => {
        // Ignore transient listen error
      }
    );
    return () => unsub();
  }, [roomCode, activeRecheckId]);

  // Listen to polls
  useEffect(() => {
    const path = `rooms/${roomCode}/polls`;
    const q = query(
      collection(db, "rooms", roomCode, "polls"),
      orderBy("createdAtMs", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: PollDoc[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PollDoc, "id">),
        }));
        setPolls(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );
    return () => unsub();
  }, [roomCode]);

  // Listen to active poll votes
  useEffect(() => {
    if (!room?.activePollId) {
      setActivePollVotes([]);
      return;
    }
    const pollId = room.activePollId;
    const path = `rooms/${roomCode}/polls/${pollId}/votes`;
    const unsub = onSnapshot(
      collection(db, "rooms", roomCode, "polls", pollId, "votes"),
      (snap) => {
        const votes: PollVoteDoc[] = snap.docs.map((d) => ({
          uid: d.id,
          ...(d.data() as Omit<PollVoteDoc, "uid">),
        }));
        setActivePollVotes(votes);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );
    return () => unsub();
  }, [roomCode, room?.activePollId]);

  // Listen to active AI 5-MCQ Quiz Batch or Written Question + student responses
  const activeQuizId = room?.activeQuizId || room?.lastQuizId || null;
  useEffect(() => {
    if (!activeQuizId) {
      setActiveQuiz(null);
      setQuizResponses([]);
      return;
    }

    const unsubQuiz = onSnapshot(
      doc(db, "rooms", roomCode, "quizzes", activeQuizId),
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
      () => {}
    );

    const unsubRes = onSnapshot(
      collection(db, "rooms", roomCode, "quizzes", activeQuizId, "responses"),
      (snap) => {
        const list: QuizResponseDoc[] = snap.docs.map((d) => ({
          uid: d.id,
          ...(d.data() as Omit<QuizResponseDoc, "uid">),
        }));
        setQuizResponses(list);
      },
      () => {}
    );

    return () => {
      unsubQuiz();
      unsubRes();
    };
  }, [roomCode, activeQuizId]);

  // Strict Anti-Proxy Rotating Join Code & QR every 10s (single active code + exact codeExpiresAt, zero grace buffer)
  useEffect(() => {
    if (!room || room.status !== "live" || room.hostUid !== user.uid) return;

    const invalidateActiveCode = () => {
      const prevCode = activeJoinCodeRef.current;
      activeJoinCodeRef.current = null;
      codeExpiresAtRef.current = 0;
      const ops: Promise<unknown>[] = [
        updateDoc(doc(db, "rooms", roomCode), {
          activeJoinCode: null,
          previousJoinCode: null,
          codeExpiresAt: 0,
          validJoinCodes: [],
        }).catch(() => {}),
      ];
      if (prevCode && prevCode !== roomCode) {
        ops.push(deleteDoc(doc(db, "joinCodes", prevCode)).catch(() => {}));
      }
      void Promise.allSettled(ops);
    };

    const rotateNow = () => {
      const nowMs = Date.now();
      const expiresAt = nowMs + 10000;
      const prevCode = activeJoinCodeRef.current;
      const excluded =
        prevCode && prevCode !== roomCode ? [roomCode, prevCode] : [roomCode];
      const nextCode = generateRoomCode(excluded);

      activeJoinCodeRef.current = nextCode;
      codeExpiresAtRef.current = expiresAt;
      joinCodeUpdatedAtRef.current = nowMs;
      setJoinSecondsLeft(10);

      const ops: Promise<unknown>[] = [
        setDoc(doc(db, "joinCodes", nextCode), {
          code: nextCode,
          roomId: roomCode,
          hostUid: user.uid,
          createdAtMs: nowMs,
          expiresAtMs: expiresAt,
        }),
        updateDoc(doc(db, "rooms", roomCode), {
          activeJoinCode: nextCode,
          codeExpiresAt: expiresAt,
          previousJoinCode: null,
          joinCodeUpdatedAtMs: nowMs,
          validJoinCodes: [],
        }),
      ];

      if (prevCode && prevCode !== roomCode && prevCode !== nextCode) {
        ops.push(deleteDoc(doc(db, "joinCodes", prevCode)).catch(() => {}));
      }

      void Promise.allSettled(ops);
    };

    // Issue a fresh 10-second code synced with the interval whenever Teacher Dashboard activates
    rotateNow();

    const countdownInterval = setInterval(() => {
      const msLeft = Math.max(0, codeExpiresAtRef.current - Date.now());
      setJoinSecondsLeft(Math.max(1, Math.min(10, Math.ceil(msLeft / 1000))));
    }, 250);

    const rotateInterval = setInterval(rotateNow, 10000);

    const handlePageHide = () => {
      if (roomStatusRef.current === "live" && !endingLocallyRef.current) {
        invalidateActiveCode();
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);

    return () => {
      clearInterval(countdownInterval);
      clearInterval(rotateInterval);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
      if (roomStatusRef.current === "live" && !endingLocallyRef.current) {
        invalidateActiveCode();
      }
    };
  }, [room?.status, room?.hostUid, roomCode, user.uid]);

  // Lecture timer
  useEffect(() => {
    if (!room?.createdAtMs) return;
    const updateElapsed = () => {
      setElapsedSec(
        Math.max(0, Math.floor((Date.now() - room.createdAtMs) / 1000))
      );
    };
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [room?.createdAtMs]);

  // Real-time update of current 1-minute bucket whenever confusion changes + 5s periodic sync
  useEffect(() => {
    if (room?.status !== "live" || !hasActiveTopic) return;
    void upsertMinuteTimelinePoint(false);
  }, [
    room?.status,
    hasActiveTopic,
    metrics.confusionPct,
    metrics.total,
    upsertMinuteTimelinePoint,
  ]);

  useEffect(() => {
    if (room?.status !== "live" || !hasActiveTopic) return;
    const interval = setInterval(() => {
      void upsertMinuteTimelinePoint(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [room?.status, hasActiveTopic, upsertMinuteTimelinePoint]);

  // Immediate spike trigger when confusion crosses > 30%
  useEffect(() => {
    if (room?.status !== "live" || !hasActiveTopic || metrics.total === 0)
      return;
    const isAbove = metrics.confusionPct > 30;
    if (isAbove && !wasAboveSpikeRef.current) {
      wasAboveSpikeRef.current = true;
      void upsertMinuteTimelinePoint(true);
    } else if (!isAbove) {
      wasAboveSpikeRef.current = false;
    }
  }, [
    metrics.confusionPct,
    metrics.total,
    room?.status,
    hasActiveTopic,
    upsertMinuteTimelinePoint,
  ]);

  const applySimStep = useCallback(
    (step: number, overrideTargetConfused?: number) => {
      const curTopic = latestTopicRef.current;
      const curVer = latestTopicVersionRef.current;
      const now = Date.now();

      let targetConfused = overrideTargetConfused ?? 12;
      if (overrideTargetConfused === undefined) {
        if (step === 0) targetConfused = 10;
        else if (step === 1) targetConfused = 18;
        else if (step === 2) targetConfused = 28;
        else if (step === 3) targetConfused = 42;
        else if (step === 4) targetConfused = 48;
        else if (step === 5) targetConfused = 36;
        else if (step === 6) targetConfused = 21;
        else targetConfused = 14 + (step % 4) * 6;
      }

      setSimStudents((prev) =>
        prev.map((student, idx) => {
          if (curVer <= 0) {
            return {
              ...student,
              status: "clear",
              reasons: [],
              topic: curTopic,
              topicVersion: curVer,
              updatedAtMs: now,
            };
          }
          const isConfused = idx < targetConfused;
          const reasonPick: ConfusionReason =
            idx % 5 === 0 || idx % 5 === 1
              ? "Too Fast"
              : idx % 5 === 2
              ? "Need Example"
              : idx % 5 === 3
              ? "Missed a Step"
              : "Audio/Board Issue";
          return {
            ...student,
            status: isConfused ? "confused" : "clear",
            reasons: isConfused ? [reasonPick] : [],
            topic: curTopic,
            topicVersion: curVer,
            updatedAtMs: now,
          };
        })
      );
    },
    []
  );

  // 100-Student Live Load Simulator loop (advances 1-minute tick smoothly every 4.5s for live demo)
  useEffect(() => {
    if (!simActive) {
      setSimStudents([]);
      setSimPollVotes([]);
      setSimDoubts([]);
      setSimResolvedIds({});
      setSimMinuteOffset(0);
      simTickRef.current = 0;
      simRecoveredRef.current = false;
      return;
    }

    const topicName = room?.currentTopic || "";
    const ver = room?.topicVersion || 0;
    setSimStudents(createSimulatedStudents(topicName, ver));
    setSimDoubts(ver > 0 ? createSimulatedDoubts(topicName, ver) : []);
    simTickRef.current = 0;
    simRecoveredRef.current = false;

    const interval = setInterval(() => {
      if (simRecoveredRef.current) return;
      simTickRef.current += 1;
      const nextStep = simTickRef.current;
      // Advance 1-minute interval tick on every 2nd step (~9s) or first 4 steps for multi-minute visibility
      setSimMinuteOffset((prev) => prev + 1);
      applySimStep(nextStep);
    }, 4500);

    return () => clearInterval(interval);
  }, [simActive, room?.topicVersion, room?.currentTopic, applySimStep]);

  const handleSimFastForwardMinute = async () => {
    if (!simActive) return;
    simRecoveredRef.current = false;
    simTickRef.current += 1;
    const nextOffset = simMinuteOffset + 1;
    setSimMinuteOffset(nextOffset);
    applySimStep(simTickRef.current);
    // Let React update metrics first, then lock next 1-minute point
    setTimeout(() => {
      void upsertMinuteTimelinePoint(true, nextOffset);
    }, 180);
  };

  // Simulate realistic votes from ~82 virtual students whenever a poll is active
  useEffect(() => {
    if (!simActive || !activePoll || !activePoll.isOpen) {
      setSimPollVotes([]);
      return;
    }

    const optCount = activePoll.options.length;
    const now = Date.now();
    const generated: PollVoteDoc[] = Array.from({ length: 82 }, (_, idx) => {
      let chosen = idx % optCount;
      if (activePoll.correctOptionIndex !== null && idx % 3 !== 0) {
        chosen = activePoll.correctOptionIndex;
      }
      return {
        uid: `sim-${String(idx + 1).padStart(3, "0")}`,
        optionIndex: chosen,
        votedAtMs: now,
      };
    });
    setSimPollVotes(generated);
  }, [simActive, activePoll]);

  const handleCopyCode = async () => {
    const codeToCopy = room?.activeJoinCode || roomCode;
    try {
      await navigator.clipboard.writeText(formatRoomCode(codeToCopy));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleBroadcastTopic = async (
    nextTopicRaw: string,
    nextSubheadingRaw = ""
  ) => {
    const nextTopic = nextTopicRaw.trim();
    const nextSubheading = nextSubheadingRaw.trim();
    if (!nextTopic || !room) return;

    setBroadcastingTopic(true);
    try {
      const nowMs = Date.now();
      let updatedTopicHistory = [...(room.topicHistory || [])];
      let updatedPollHistory = [...(room.pollHistory || [])];
      let updatedRecheckHistory = [
        ...(room.recheckHistory || localRecheckHistory),
      ];

      // Archive active re-check if open
      if (room.activeRecheck && room.activeRecheck.status === "active") {
        const afterPct = metrics.confusionPct;
        const rec: RecheckRecord = {
          id: room.activeRecheck.id,
          topic: room.activeRecheck.topic,
          topicVersion: room.activeRecheck.topicVersion,
          triggeredAtMs: room.activeRecheck.triggeredAtMs,
          baselineConfusionPct: room.activeRecheck.baselineConfusionPct,
          afterConfusionPct: afterPct,
          dropPts: Math.max(0, room.activeRecheck.baselineConfusionPct - afterPct),
          clearedCount: recheckResponses.filter((r) => r.outcome === "cleared")
            .length,
          stillStuckCount: recheckResponses.filter(
            (r) => r.outcome === "still_stuck"
          ).length,
        };
        updatedRecheckHistory = [
          ...updatedRecheckHistory.filter((r) => r.id !== rec.id),
          rec,
        ];
        setLocalRecheckHistory(updatedRecheckHistory);
      }

      if (room.currentTopic && room.topicVersion > 0) {
        await upsertMinuteTimelinePoint(true);
        const prevPoints = timelinePoints.filter(
          (p) => p.topicVersion === room.topicVersion
        );
        const currentCounts = computeReasonCounts(
          allParticipants,
          room.topicVersion
        );
        const cumulative = mergeReasonCounts(
          cumulativeReasonsByVersion[room.topicVersion] ?? emptyReasonCounts(),
          currentCounts
        );
        const topicSubheadings = (room.subheadingHistory || [])
          .filter((s) => s.topicVersion === room.topicVersion)
          .map((s) => s.subheading);
        const archived = buildArchivedTopicRecord(
          room.currentTopic,
          room.topicVersion,
          room.topicStartedAtMs || room.createdAtMs,
          nowMs,
          prevPoints,
          cumulative,
          topicSubheadings
        );
        updatedTopicHistory = [...updatedTopicHistory, archived];
      }

      if (room.activePollId && activePoll) {
        const finalCounts = activePoll.options.map(
          (_, idx) =>
            combinedActivePollVotes.filter((v) => v.optionIndex === idx).length
        );
        await updateDoc(doc(db, "rooms", roomCode, "polls", room.activePollId), {
          isOpen: false,
          finalCounts,
          finalTotalVotes: combinedActivePollVotes.length,
        });
        const pollSummary = buildPollSummary(
          activePoll,
          combinedActivePollVotes,
          nowMs
        );
        if (!updatedPollHistory.some((p) => p.pollId === pollSummary.pollId)) {
          updatedPollHistory = [...updatedPollHistory, pollSummary];
        }
      }

      const nextVersion = (room.topicVersion || 0) + 1;
      const effectiveMs = nowMs + simMinuteOffsetRef.current * 60000;
      const minuteBucketMs = getMinuteBucketMs(effectiveMs);
      const timeLabel = formatMinuteLabel(minuteBucketMs);

      const updatedSubheadingHistory: SubheadingEntry[] = [
        ...(room.subheadingHistory || []),
        ...(nextSubheading
          ? [
              {
                mainTopic: nextTopic.slice(0, 140),
                subheading: nextSubheading.slice(0, 140),
                topicVersion: nextVersion,
                updatedAtMs: nowMs,
                timeLabel,
              },
            ]
          : []),
      ];

      await updateDoc(
        doc(db, "rooms", roomCode),
        stripUndefined({
          currentTopic: nextTopic.slice(0, 140),
          currentMainTopic: nextTopic.slice(0, 140),
          currentSubheading: nextSubheading.slice(0, 140),
          subheadingHistory: updatedSubheadingHistory,
          topicVersion: nextVersion,
          topicStartedAtMs: nowMs,
          topicHistory: updatedTopicHistory,
          activePollId: null,
          activeRecheck: null,
          recheckHistory: updatedRecheckHistory,
          pollHistory: updatedPollHistory,
        })
      );

      wasAboveSpikeRef.current = false;
      setGraphMode("live");
      setTopicInput("");
      setSubheadingInput("");

      if (simActive) {
        simRecoveredRef.current = false;
        setSimStudents(
          createSimulatedStudents(nextTopic.slice(0, 140), nextVersion)
        );
        setSimDoubts(createSimulatedDoubts(nextTopic.slice(0, 140), nextVersion));
        simTickRef.current = 0;
      }

      const initialPointId = buildTimelineDocId(minuteBucketMs, nextVersion);

      await setDoc(
        doc(db, "rooms", roomCode, "timeline", initialPointId),
        stripUndefined({
          timestampMs: effectiveMs,
          minuteBucketMs,
          timeLabel,
          topic: nextTopic.slice(0, 140),
          mainTopic: nextTopic.slice(0, 140),
          subheading: nextSubheading ? nextSubheading.slice(0, 140) : undefined,
          topicVersion: nextVersion,
          confusionPct: 0,
          understandingPct: 100,
          confusedCount: 0,
          clearCount: allParticipants.length,
          totalParticipants: allParticipants.length,
          isSpike: false,
          topReason: null,
        }),
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}`);
    } finally {
      setBroadcastingTopic(false);
    }
  };

  const handleUpdateSubheading = async () => {
    const cleanSub = subheadingInput.trim();
    if (!room || !hasActiveTopic || !cleanSub || updatingSubheading) return;

    setUpdatingSubheading(true);
    try {
      const nowMs = Date.now();
      const effectiveMs = nowMs + simMinuteOffsetRef.current * 60000;
      const minuteBucketMs = getMinuteBucketMs(effectiveMs);
      const timeLabel = formatMinuteLabel(minuteBucketMs);

      const nextSubLog: SubheadingEntry[] = [
        ...(room.subheadingHistory || []),
        {
          mainTopic: room.currentTopic,
          subheading: cleanSub.slice(0, 140),
          topicVersion: room.topicVersion,
          updatedAtMs: nowMs,
          timeLabel,
        },
      ];

      latestSubheadingRef.current = cleanSub.slice(0, 140);

      await updateDoc(
        doc(db, "rooms", roomCode),
        stripUndefined({
          currentSubheading: cleanSub.slice(0, 140),
          subheadingHistory: nextSubLog,
        })
      );

      await upsertMinuteTimelinePoint(true);
      setSubheadingInput("");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}`);
    } finally {
      setUpdatingSubheading(false);
    }
  };

  // Smart Re-Check Pulse Trigger
  const handleTriggerRecheckPulse = async () => {
    if (!room || !hasActiveTopic || triggeringRecheck) return;
    setTriggeringRecheck(true);
    const nowMs = Date.now();
    const recheckId = `rc_${nowMs}`;
    const baselinePct = metrics.confusionPct;

    const newRecheck: RecheckState = {
      id: recheckId,
      topic: room.currentTopic,
      topicVersion: room.topicVersion,
      baselineConfusionPct: baselinePct,
      triggeredAtMs: nowMs,
      status: "active",
      resolvedAtMs: null,
      finalConfusionPct: null,
      clearedUids: [],
      stillStuckUids: [],
    };

    try {
      await updateDoc(
        doc(db, "rooms", roomCode),
        stripUndefined({ activeRecheck: newRecheck })
      );

      // In 100-Student Simulator mode, animate virtual confused students clearing doubts cleanly
      if (simActive) {
        simRecoveredRef.current = true;
        setTimeout(() => {
          const recoveredTarget = Math.max(8, Math.round(baselinePct * 0.25));
          applySimStep(simTickRef.current, recoveredTarget);
          setTimeout(() => {
            void upsertMinuteTimelinePoint(true);
          }, 250);
        }, 1200);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}`);
    } finally {
      setTriggeringRecheck(false);
    }
  };

  const handleCompleteRecheck = async () => {
    if (!room?.activeRecheck) return;
    const rc = room.activeRecheck;
    const afterPct = metrics.confusionPct;
    const clearedReal = recheckResponses.filter(
      (r) => r.outcome === "cleared"
    ).length;
    const stuckReal = recheckResponses.filter(
      (r) => r.outcome === "still_stuck"
    ).length;
    const record: RecheckRecord = {
      id: rc.id,
      topic: rc.topic,
      topicVersion: rc.topicVersion,
      triggeredAtMs: rc.triggeredAtMs,
      baselineConfusionPct: rc.baselineConfusionPct,
      afterConfusionPct: afterPct,
      dropPts: Math.max(0, rc.baselineConfusionPct - afterPct),
      clearedCount:
        clearedReal +
        (simActive
          ? Math.max(
              0,
              Math.round(((rc.baselineConfusionPct - afterPct) / 100) * 100)
            )
          : 0),
      stillStuckCount: stuckReal,
    };

    const nextHistory = [
      ...(room.recheckHistory || localRecheckHistory).filter(
        (r) => r.id !== record.id
      ),
      record,
    ];
    setLocalRecheckHistory(nextHistory);
    simRecoveredRef.current = false;

    try {
      await updateDoc(
        doc(db, "rooms", roomCode),
        stripUndefined({
          activeRecheck: null,
          recheckHistory: nextHistory,
        })
      );
    } catch {
      // Non-blocking fallback
    }
  };

  const handleResolveDoubt = async (doubt: DoubtDoc) => {
    if (doubt.id.startsWith("sim-")) {
      setSimResolvedIds((prev) => ({ ...prev, [doubt.id]: true }));
      return;
    }
    try {
      await updateDoc(doc(db, "rooms", roomCode, "doubts", doubt.id), {
        resolved: true,
      });
    } catch {
      // Non-blocking fallback
    }
  };

  const handleAutoGenerateRescuePoll = () => {
    const draft = generateRescuePollDraft(
      room?.currentTopic || "Current Topic",
      metrics.topReason
    );
    setPollQuestion(draft.question);
    setPollOptions([...draft.options]);
    setCorrectOptionIndex(draft.correctOptionIndex);
    setRescueRationale(draft.rationale);
    setPollError(null);
  };

  const launchPoll = async (
    question: string,
    options: string[],
    correctIdx: number | null
  ) => {
    if (!room) return;
    setLaunchingPoll(true);
    setPollError(null);
    try {
      const nowMs = Date.now();
      let updatedPollHistory = [...(room.pollHistory || [])];

      if (room.activePollId && activePoll) {
        const finalCounts = activePoll.options.map(
          (_, idx) =>
            combinedActivePollVotes.filter((v) => v.optionIndex === idx).length
        );
        await updateDoc(doc(db, "rooms", roomCode, "polls", room.activePollId), {
          isOpen: false,
          finalCounts,
          finalTotalVotes: combinedActivePollVotes.length,
        });
        const archived = buildPollSummary(
          activePoll,
          combinedActivePollVotes,
          nowMs
        );
        if (!updatedPollHistory.some((p) => p.pollId === archived.pollId)) {
          updatedPollHistory = [...updatedPollHistory, archived];
        }
      }

      const pollRef = await addDoc(collection(db, "rooms", roomCode, "polls"), {
        question: question.slice(0, 240),
        options,
        correctOptionIndex: correctIdx,
        topic: room.currentTopic || "General Check-In",
        topicVersion: room.topicVersion || 0,
        isOpen: true,
        finalCounts: null,
        finalTotalVotes: null,
        createdAtMs: nowMs,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      await updateDoc(
        doc(db, "rooms", roomCode),
        stripUndefined({
          activePollId: pollRef.id,
          lastPollId: pollRef.id,
          pollHistory: updatedPollHistory,
        })
      );

      setResultsFocus("poll");
      setPollQuestion("");
      setPollOptions(["", ""]);
      setCorrectOptionIndex(null);
      setRescueRationale(null);
    } catch (err) {
      setPollError(
        err instanceof Error ? err.message : "Failed to launch live poll."
      );
    } finally {
      setLaunchingPoll(false);
    }
  };

  const handleGenerateAiQuestionBank = async () => {
    if (generatingAiBank) return;
    setGeneratingAiBank(true);
    setAiNotice(null);
    setPollError(null);

    const targetTopic =
      room?.currentMainTopic ||
      room?.currentTopic ||
      room?.title ||
      "Core Lecture Concept";
    const targetSub = room?.currentSubheading || "";

    try {
      const { questions } = await generateConceptualQuestionBank(
        targetTopic,
        targetSub
      );
      setAiBank(questions);
      const allSelected: Record<string, boolean> = {};
      questions.forEach((q) => {
        allSelected[q.id] = true;
      });
      setSelectedAiIds(allSelected);
      setAiNotice(
        `Generated ${questions.length} conceptual MCQs across 4 dimensions for "${targetTopic}". Review or toggle questions below, then push unique 5-question sets.`
      );
    } catch (err) {
      setAiNotice(
        err instanceof Error
          ? err.message
          : "Could not generate question bank right now. Try again."
      );
    } finally {
      setGeneratingAiBank(false);
    }
  };

  const handlePushUniqueQuizSets = async () => {
    if (!room || launchingQuiz) return;
    const approved = aiBank.filter((q) => selectedAiIds[q.id]);
    if (approved.length < 5) {
      setPollError("Select at least 5 questions so each student gets a 5-question set.");
      return;
    }

    setLaunchingQuiz(true);
    setPollError(null);
    try {
      const nowMs = Date.now();
      const quizId = `quiz_${nowMs.toString(36)}`;
      const payload = stripUndefined({
        mode: "mcq_set" as const,
        mainTopic: room.currentMainTopic || room.currentTopic || room.title,
        subheading: room.currentSubheading || "",
        topic: room.currentTopic || room.title,
        batchVersion: 1,
        isOpen: true,
        questions: approved,
        writtenPrompt: null,
        createdAtMs: nowMs,
        createdBy: user.uid,
      });

      await setDoc(doc(db, "rooms", roomCode, "quizzes", quizId), payload);
      await updateDoc(doc(db, "rooms", roomCode), {
        activeQuizId: quizId,
        lastQuizId: quizId,
      });
      setResultsFocus("quiz");
      setAiNotice(
        `Pushed unique randomized 5-question sets from ${approved.length} approved MCQs to all students!`
      );
    } catch (err) {
      setPollError(
        err instanceof Error ? err.message : "Failed to push 5-question sets."
      );
    } finally {
      setLaunchingQuiz(false);
    }
  };

  const handleResendFreshFiveQuestions = async () => {
    if (!room || !activeQuiz || activeQuiz.mode !== "mcq_set" || launchingQuiz)
      return;
    setLaunchingQuiz(true);
    try {
      const nextVersion = (activeQuiz.batchVersion || 1) + 1;
      await updateDoc(doc(db, "rooms", roomCode, "quizzes", activeQuiz.id), {
        batchVersion: nextVersion,
        isOpen: true,
      });
      await updateDoc(doc(db, "rooms", roomCode), {
        activeQuizId: activeQuiz.id,
        lastQuizId: activeQuiz.id,
      });
      setResultsFocus("quiz");
      setAiNotice(
        `Resent Set #${nextVersion}: every student now has a newly shuffled 5-question conceptual set.`
      );
    } catch (err) {
      setPollError(
        err instanceof Error ? err.message : "Failed to refresh student sets."
      );
    } finally {
      setLaunchingQuiz(false);
    }
  };

  const handlePushWrittenQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!room || launchingQuiz) return;
    const cleanPrompt = writtenPromptInput.trim();
    if (cleanPrompt.length < 4) {
      setPollError("Enter a clear short-answer conceptual question.");
      return;
    }

    setLaunchingQuiz(true);
    setPollError(null);
    try {
      const nowMs = Date.now();
      const quizId = `written_${nowMs.toString(36)}`;
      await setDoc(
        doc(db, "rooms", roomCode, "quizzes", quizId),
        stripUndefined({
          mode: "written" as const,
          mainTopic: room.currentMainTopic || room.currentTopic || room.title,
          subheading: room.currentSubheading || "",
          topic: room.currentTopic || room.title,
          batchVersion: 1,
          isOpen: true,
          writtenPrompt: cleanPrompt.slice(0, 400),
          createdAtMs: nowMs,
          createdBy: user.uid,
        })
      );
      await updateDoc(doc(db, "rooms", roomCode), {
        activeQuizId: quizId,
        lastQuizId: quizId,
      });
      setWrittenPromptInput("");
      setResultsFocus("quiz");
    } catch (err) {
      setPollError(
        err instanceof Error ? err.message : "Failed to push written question."
      );
    } finally {
      setLaunchingQuiz(false);
    }
  };

  const handleCloseActiveQuiz = async () => {
    if (!activeQuiz || !room) return;
    try {
      await updateDoc(doc(db, "rooms", roomCode, "quizzes", activeQuiz.id), {
        isOpen: false,
      });
      await updateDoc(doc(db, "rooms", roomCode), {
        activeQuizId: null,
        lastQuizId: activeQuiz.id,
      });
    } catch {
      // Ignore transient close error
    }
  };

  const handleQuickPulse = async () => {
    const label = room?.currentTopic || "this concept";
    await launchPoll(
      `Do you understand "${label}"?`,
      ["Yes, clear", "Somewhat", "No, confused"],
      0
    );
  };

  const handleCreateCustomPoll = async (e: React.FormEvent) => {
    e.preventDefault();
    setPollError(null);
    const cleanQ = pollQuestion.trim();
    const cleanOpts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!cleanQ) {
      setPollError("Enter a question for your micro-poll.");
      return;
    }
    if (cleanOpts.length < 2) {
      setPollError("Provide at least 2 answer options.");
      return;
    }

    const mappedCorrect =
      correctOptionIndex !== null && pollOptions[correctOptionIndex]?.trim()
        ? cleanOpts.indexOf(pollOptions[correctOptionIndex].trim())
        : null;

    await launchPoll(cleanQ, cleanOpts.slice(0, 4), mappedCorrect);
  };

  const handleCloseActivePoll = async () => {
    if (!room?.activePollId || !activePoll) return;
    const nowMs = Date.now();
    try {
      const finalCounts = activePoll.options.map(
        (_, idx) =>
          combinedActivePollVotes.filter((v) => v.optionIndex === idx).length
      );
      const finalTotalVotes = combinedActivePollVotes.length;

      await updateDoc(doc(db, "rooms", roomCode, "polls", room.activePollId), {
        isOpen: false,
        finalCounts,
        finalTotalVotes,
      });

      const archived = buildPollSummary(
        activePoll,
        combinedActivePollVotes,
        nowMs
      );
      const updatedHistory = (room.pollHistory || []).some(
        (p) => p.pollId === archived.pollId
      )
        ? room.pollHistory || []
        : [...(room.pollHistory || []), archived];

      await updateDoc(
        doc(db, "rooms", roomCode),
        stripUndefined({
          activePollId: null,
          lastPollId: room.activePollId,
          pollHistory: updatedHistory,
        })
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}`);
    }
  };

  // End Class & Compile Permanent Report (guaranteed instant transition without hanging)
  const handleEndClass = async () => {
    if (!room) return;
    endingLocallyRef.current = true;
    setEndingClass(true);

    const nowMs = Date.now();
    let compiledReport: ReportDoc | undefined;

    try {
      let updatedPollHistory = [...(room.pollHistory || [])];
      let updatedRecheckHistory = [
        ...(room.recheckHistory || localRecheckHistory),
      ];

      if (room.activeRecheck && room.activeRecheck.status === "active") {
        const afterPct = metrics.confusionPct;
        const rec: RecheckRecord = {
          id: room.activeRecheck.id,
          topic: room.activeRecheck.topic,
          topicVersion: room.activeRecheck.topicVersion,
          triggeredAtMs: room.activeRecheck.triggeredAtMs,
          baselineConfusionPct: room.activeRecheck.baselineConfusionPct,
          afterConfusionPct: afterPct,
          dropPts: Math.max(0, room.activeRecheck.baselineConfusionPct - afterPct),
          clearedCount: recheckResponses.filter((r) => r.outcome === "cleared")
            .length,
          stillStuckCount: recheckResponses.filter(
            (r) => r.outcome === "still_stuck"
          ).length,
        };
        updatedRecheckHistory = [
          ...updatedRecheckHistory.filter((r) => r.id !== rec.id),
          rec,
        ];
      }

      if (room.activePollId && activePoll) {
        const finalCounts = activePoll.options.map(
          (_, idx) =>
            combinedActivePollVotes.filter((v) => v.optionIndex === idx).length
        );
        try {
          await updateDoc(
            doc(db, "rooms", roomCode, "polls", room.activePollId),
            {
              isOpen: false,
              finalCounts,
              finalTotalVotes: combinedActivePollVotes.length,
            }
          );
        } catch {
          // Non-blocking fallback
        }
        const archivedPoll = buildPollSummary(
          activePoll,
          combinedActivePollVotes,
          nowMs
        );
        if (!updatedPollHistory.some((p) => p.pollId === archivedPoll.pollId)) {
          updatedPollHistory = [...updatedPollHistory, archivedPoll];
        }
      }

      if (hasActiveTopic) {
        try {
          await upsertMinuteTimelinePoint(true);
        } catch {
          // Non-blocking fallback
        }
      }

      let allTimeline: TimelinePoint[] = [...timelinePoints];
      try {
        const timelineSnap = await getDocs(
          query(
            collection(db, "rooms", roomCode, "timeline"),
            orderBy("timestampMs", "asc")
          )
        );
        if (!timelineSnap.empty) {
          allTimeline = timelineSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<TimelinePoint, "id">),
          }));
        }
      } catch {
        // Fallback to local state
      }

      let finalTopicRecords: ArchivedTopicRecord[] = [
        ...(room.topicHistory || []),
      ];
      if (hasActiveTopic) {
        const activePoints = allTimeline.filter(
          (p) => p.topicVersion === room.topicVersion
        );
        const currentCounts = computeReasonCounts(
          allParticipants,
          room.topicVersion
        );
        const cumulative = mergeReasonCounts(
          cumulativeReasonsByVersion[room.topicVersion] ?? emptyReasonCounts(),
          currentCounts
        );
        const activeSubheadings = (room.subheadingHistory || [])
          .filter((s) => s.topicVersion === room.topicVersion)
          .map((s) => s.subheading);
        finalTopicRecords = [
          ...finalTopicRecords,
          buildArchivedTopicRecord(
            room.currentTopic,
            room.topicVersion,
            room.topicStartedAtMs || room.createdAtMs,
            nowMs,
            activePoints,
            cumulative,
            activeSubheadings
          ),
        ];
      }

      const votesByPollId: Record<string, PollVoteDoc[]> = {};
      await Promise.all(
        polls.map(async (p) => {
          try {
            const snap = await getDocs(
              collection(db, "rooms", roomCode, "polls", p.id, "votes")
            );
            votesByPollId[p.id] = snap.docs.map((d) => ({
              uid: d.id,
              ...(d.data() as Omit<PollVoteDoc, "uid">),
            }));
          } catch {
            votesByPollId[p.id] = [];
          }
        })
      );

      const topDoubtsForReport = (simActive
        ? [...realDoubts, ...simDoubts]
        : realDoubts
      )
        .sort(
          (a, b) =>
            (b.upvoterUids?.length || 0) - (a.upvoterUids?.length || 0)
        )
        .slice(0, 6);

      const summary = computeSessionSummary(
        room,
        allParticipants,
        allTimeline,
        polls,
        votesByPollId,
        nowMs,
        finalTopicRecords,
        updatedPollHistory,
        updatedRecheckHistory,
        topDoubtsForReport
      );

      compiledReport = stripUndefined({
        roomCode,
        title: room.title,
        hostUid: room.hostUid,
        createdAtMs: room.createdAtMs,
        endedAtMs: nowMs,
        topicHistory: finalTopicRecords,
        spikeLog: summary.spikes,
        pollHistory: summary.polls,
        summary,
      });

      const codeToClear = activeJoinCodeRef.current;
      activeJoinCodeRef.current = null;
      codeExpiresAtRef.current = 0;

      await Promise.allSettled([
        setDoc(doc(db, "reports", roomCode), compiledReport),
        updateDoc(
          doc(db, "rooms", roomCode),
          stripUndefined({
            status: "ended",
            activeJoinCode: null,
            previousJoinCode: null,
            codeExpiresAt: 0,
            validJoinCodes: [],
            activePollId: null,
            activeRecheck: null,
            endedAtMs: nowMs,
            endedAt: serverTimestamp(),
            topicHistory: finalTopicRecords,
            recheckHistory: updatedRecheckHistory,
            pollHistory: summary.polls,
            summary,
          })
        ),
        ...(codeToClear && codeToClear !== roomCode
          ? [deleteDoc(doc(db, "joinCodes", codeToClear)).catch(() => {})]
          : []),
        setDoc(
          doc(db, "users", user.uid, "conductedClasses", roomCode),
          stripUndefined({
            roomCode,
            title: room.title,
            status: "ended",
            createdAtMs: room.createdAtMs,
            endedAtMs: nowMs,
            studentCount: summary.totalParticipants,
            overallComprehensionPct: summary.overallComprehensionPct,
            totalTopics: summary.totalTopics,
            totalSpikes: summary.spikes.length,
          }),
          { merge: true }
        ),
      ]);
    } catch (err) {
      console.error("Error compiling session report:", err);
    } finally {
      setEndingClass(false);
      setConfirmEndOpen(false);
      onSessionEnded(roomCode, compiledReport);
    }
  };

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="pp-card border rounded-2xl p-8 text-sm text-slate-400">
          Connecting to live classroom dashboard...
        </div>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="pp-card border rounded-2xl p-8 space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-100">
            Session Not Found
          </h1>
          <p className="text-sm text-slate-400">
            Classroom {formatRoomCode(roomCode)} does not exist or could not be
            loaded.
          </p>
          <button
            type="button"
            onClick={onBackToLobby}
            className="min-h-[44px] px-4 py-2 rounded-xl pp-primary-btn text-white text-sm font-medium"
          >
            Return to Lobby
          </button>
        </div>
      </main>
    );
  }

  if (room.hostUid !== user.uid) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="pp-card border rounded-2xl p-8 space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-100">
            Instructor Access Required
          </h1>
          <p className="text-sm text-slate-400">
            Only the host who created room {formatRoomCode(roomCode)} can open the
            Teacher Live Dashboard.
          </p>
          <button
            type="button"
            onClick={onBackToLobby}
            className="min-h-[44px] px-4 py-2 rounded-xl pp-primary-btn text-white text-sm font-medium"
          >
            Return to Lobby
          </button>
        </div>
      </main>
    );
  }

  const isSpikeNow =
    hasActiveTopic && metrics.total > 0 && metrics.confusionPct > 30;
  const optionLetters = ["A", "B", "C", "D"];
  const activePollTotal = combinedActivePollVotes.length;
  const activeRecheck = room.activeRecheck ?? null;
  const latestRecheckRecovery =
    activeRecheck && activeRecheck.status === "active"
      ? {
          before: activeRecheck.baselineConfusionPct,
          now: metrics.confusionPct,
          drop: Math.max(0, activeRecheck.baselineConfusionPct - metrics.confusionPct),
        }
      : null;

  return (
    <main className="max-w-7xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-6">
      {/* Room Header */}
      <section className="pp-card backdrop-blur-xl border rounded-2xl p-4 sm:p-6 space-y-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                <Radio className="w-3.5 h-3.5 shrink-0" />
                Live Session
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock className="w-3.5 h-3.5" />
                {formatDuration(elapsedSec)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-slate-200 font-medium tabular-nums">
                <Users className="w-3.5 h-3.5 text-sky-400" />
                {metrics.total} {metrics.total === 1 ? "student" : "students"} connected
              </span>
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-100 break-words">
              {room.title}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 shrink-0">
            {/* Rotating Join Code + 10s Countdown + QR Toggle */}
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl pp-input border">
              <div className="min-w-[110px]">
                <div className="text-[10px] text-sky-400 flex items-center gap-1.5 font-medium">
                  <RefreshCw className="w-3 h-3 shrink-0" />
                  <span className="tabular-nums">
                    Join Code · {joinSecondsLeft}s
                  </span>
                </div>
                <div className="font-mono text-lg sm:text-2xl font-bold tracking-wider text-sky-300 tabular-nums">
                  {formatRoomCode(room.activeJoinCode || room.roomCode)}
                </div>
                <div className="w-full h-1 rounded-full bg-slate-800 overflow-hidden mt-1">
                  <div
                    className={`h-full transition-all duration-300 ${
                      joinSecondsLeft <= 3 ? "bg-amber-400" : "bg-sky-400"
                    }`}
                    style={{ width: `${(joinSecondsLeft / 10) * 100}%` }}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyCode}
                className="min-h-[40px] px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors flex items-center gap-1.5"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowQrPanel((v) => !v)}
                className={`min-h-[40px] px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  showQrPanel
                    ? "bg-sky-500/20 border-sky-400 text-sky-200"
                    : "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-200"
                }`}
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>QR</span>
              </button>
            </div>

            {/* 100-Student Live Load Simulator Toggle */}
            <button
              type="button"
              onClick={() => setSimActive((v) => !v)}
              className={`min-h-[48px] px-3.5 sm:px-4 py-2.5 rounded-xl border text-xs font-semibold transition-colors inline-flex items-center gap-2 whitespace-nowrap ${
                simActive
                  ? "bg-amber-500/20 border-amber-400 text-amber-200"
                  : "pp-input hover:bg-slate-800 text-slate-200"
              }`}
            >
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                {simActive
                  ? "Stop 100-Student Sim"
                  : "⚡ Simulate 100 Students"}
              </span>
            </button>

            {simActive && (
              <button
                type="button"
                onClick={() => void handleSimFastForwardMinute()}
                className="min-h-[48px] px-3.5 py-2.5 rounded-xl border border-sky-500/40 bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <FastForward className="w-4 h-4 text-sky-400" />
                <span>+1 Min Tick</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setConfirmEndOpen(true)}
              className="min-h-[48px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-colors inline-flex items-center gap-2 whitespace-nowrap"
            >
              <StopCircle className="w-4 h-4" />
              <span>End Class &amp; Report</span>
            </button>
          </div>
        </div>

        {/* Expandable Rotating QR Projector Panel */}
        {showQrPanel && (
          <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="space-y-1.5 text-center sm:text-left">
              <div className="text-sm font-semibold text-slate-100">
                Anti-Proxy Rotating Student QR Invite (Refreshes Every 10s)
              </div>
              <p className="text-xs text-slate-400 max-w-lg leading-relaxed">
                Live Join Code:{" "}
                <span className="font-mono text-sky-400 font-bold">
                  {formatRoomCode(room.activeJoinCode || room.roomCode)}
                </span>{" "}
                ({joinSecondsLeft}s left · Strictly expires every 10s with zero grace
                window). Permanent Session ID{" "}
                <span className="font-mono text-slate-300">
                  {formatRoomCode(room.roomCode)}
                </span>{" "}
                keeps already-joined students connected continuously.
              </p>
            </div>
            <QrCodeBox
              roomCode={room.activeJoinCode || room.roomCode}
              queryParam="code"
              secondsRemaining={joinSecondsLeft}
              size={136}
            />
          </div>
        )}
      </section>

      {/* Prominent Teacher Main Topic + Subheading Hierarchy Broadcast Bar */}
      <section className="pp-card backdrop-blur-xl border pp-accent-border rounded-2xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Layers className="w-4 h-4 text-sky-400" />
            <h2 className="font-display text-base font-bold text-slate-100">
              Main Topic &amp; Subheading Broadcast
            </h2>
          </div>
          <div className="text-xs text-slate-400">
            {hasActiveTopic ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <span>Active:</span>
                <span className="text-sky-300 font-semibold">
                  {room.currentMainTopic || room.currentTopic}
                </span>
                {room.currentSubheading && (
                  <>
                    <span className="text-slate-600">/</span>
                    <span className="text-emerald-300 font-medium">
                      {room.currentSubheading}
                    </span>
                  </>
                )}
                <span className="text-slate-500">
                  (Topic #{room.topicVersion})
                </span>
              </span>
            ) : (
              <span className="text-amber-300 font-medium">
                Standby — students are waiting for your first Main Topic
              </span>
            )}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleBroadcastTopic(topicInput, subheadingInput);
          }}
          className="grid grid-cols-1 lg:grid-cols-12 gap-3"
        >
          <input
            type="text"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder="Main Topic (e.g., 2. Recursion & Call Stack)"
            maxLength={140}
            className="lg:col-span-5 min-h-[48px] px-4 py-2.5 rounded-xl pp-input border focus:border-sky-400 focus:outline-none text-sm text-slate-100 placeholder:text-slate-500"
          />
          <input
            type="text"
            value={subheadingInput}
            onChange={(e) => setSubheadingInput(e.target.value)}
            placeholder="Subheading / Sub-topic (e.g., Base Case vs Stack Overflow)"
            maxLength={140}
            className="lg:col-span-4 min-h-[48px] px-4 py-2.5 rounded-xl pp-input border focus:border-emerald-400 focus:outline-none text-sm text-slate-100 placeholder:text-slate-500"
          />
          <div className="lg:col-span-3 flex gap-2">
            <button
              type="submit"
              disabled={broadcastingTopic || !topicInput.trim()}
              className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl pp-primary-btn disabled:opacity-50 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap inline-flex items-center justify-center gap-1.5"
            >
              <Send className="w-4 h-4" />
              <span>{broadcastingTopic ? "Broadcasting..." : "Broadcast"}</span>
            </button>
            <button
              type="button"
              disabled={!hasActiveTopic || updatingSubheading || !subheadingInput.trim()}
              onClick={() => void handleUpdateSubheading()}
              title="Update subheading under active Main Topic without resetting student pulses"
              className="min-h-[48px] px-3.5 py-2.5 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-45 text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {updatingSubheading ? "Updating..." : "Update Subheading"}
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400 mr-1">Quick Topics:</span>
          {QUICK_TOPIC_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={broadcastingTopic}
              onClick={() => void handleBroadcastTopic(chip, "")}
              className="min-h-[36px] px-3 py-1.5 rounded-lg pp-input hover:bg-slate-800 border text-xs font-medium text-slate-300 transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>

      </section>

      {/* Inline End Class Confirmation Modal */}
      {confirmEndOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full pp-card-strong border border-slate-700 rounded-2xl p-6 space-y-5 shadow-2xl">
            <div className="space-y-2">
              <h2 className="font-display text-lg font-bold text-slate-100">
                End Lecture &amp; Generate Summary?
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                This closes room{" "}
                <span className="font-mono text-sky-400">
                  {formatRoomCode(roomCode)}
                </span>{" "}
                and compiles the permanent PDF-ready report with 1-minute
                timelines, spike alerts, recovery metrics, and poll results.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={endingClass}
                onClick={() => setConfirmEndOpen(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium"
              >
                Keep Session Live
              </button>
              <button
                type="button"
                disabled={endingClass}
                onClick={handleEndClass}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-sm font-semibold"
              >
                {endingClass ? "Generating Report..." : "End Class Now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Re-Check Pulse Recovery Metric Banner */}
      {latestRecheckRecovery && (
        <div className="bg-sky-500/15 border border-sky-400/50 rounded-2xl px-4 sm:px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-sky-100">
              <RefreshCw className="w-4 h-4 text-sky-400 shrink-0" />
              <span>Re-Check Recovery Metric:</span>
              <span className="font-mono text-emerald-300 tabular-nums">
                Confusion shifted from {latestRecheckRecovery.before}% →{" "}
                {latestRecheckRecovery.now}%
                {latestRecheckRecovery.drop > 0
                  ? ` (-${latestRecheckRecovery.drop} pts)`
                  : ""}
              </span>
            </div>
            <p className="text-xs text-sky-200/80">
              Students who signaled confusion are seeing the 1-tap Re-Check
              prompt (&ldquo;Did that clear your doubt?&rdquo;).
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCompleteRecheck()}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
          >
            Save Recovery Snapshot
          </button>
        </div>
      )}

      {/* Red Confusion Spike Alert Banner with Smart Re-Check Pulse + Auto Rescue Poll */}
      {isSpikeNow && (
        <div className="bg-rose-500/15 border border-rose-500/50 rounded-2xl px-4 sm:px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <div className="text-sm font-bold text-rose-200 break-words">
                ⚠️ Confusion Spike Alert ({metrics.confusionPct}% confused during{" "}
                {room.currentTopic})
              </div>
              <div className="text-xs text-rose-300/90">
                {metrics.confused} of {metrics.total} students are confused
                {metrics.topReason ? ` · Top reason: ${metrics.topReason}` : ""}.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={triggeringRecheck}
              onClick={() => void handleTriggerRecheckPulse()}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>🔄 Trigger Re-Check Pulse</span>
            </button>
            <button
              type="button"
              onClick={handleAutoGenerateRescuePoll}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>✨ Auto-Generate Rescue Poll</span>
            </button>
          </div>
        </div>
      )}

      {/* Row 1: Live Comprehension Gauge + Pace-o-Meter + Confusion Reasons */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 pp-card backdrop-blur-xl border rounded-2xl p-4 sm:p-6 flex flex-col justify-between space-y-5 min-w-0">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-slate-100">
                Live Class Comprehension
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {hasActiveTopic
                  ? `Tracking "${room.currentTopic}"`
                  : "Broadcast a topic to begin"}
              </p>
            </div>
            <div className="text-right tabular-nums shrink-0">
              <div className="text-xs text-slate-400">Connected</div>
              <div className="font-mono text-lg font-bold text-slate-100">
                {metrics.total}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
              <div className="text-xs font-medium text-emerald-300">
                Following
              </div>
              <div className="font-mono text-2xl sm:text-3xl font-bold text-emerald-400 mt-1 tabular-nums">
                {hasActiveTopic && metrics.total > 0
                  ? `${metrics.understandingPct}%`
                  : "—"}
              </div>
              <div className="text-xs text-emerald-200/80 mt-1 tabular-nums">
                {metrics.clear} following
              </div>
            </div>

            <div
              className={`p-4 rounded-xl border ${
                isSpikeNow
                  ? "bg-rose-500/15 border-rose-500/40"
                  : "bg-amber-500/10 border-amber-500/25"
              }`}
            >
              <div
                className={`text-xs font-medium ${
                  isSpikeNow ? "text-rose-300" : "text-amber-300"
                }`}
              >
                Confused {isSpikeNow ? "· SPIKE" : ""}
              </div>
              <div
                className={`font-mono text-2xl sm:text-3xl font-bold mt-1 tabular-nums ${
                  isSpikeNow ? "text-rose-400" : "text-amber-400"
                }`}
              >
                {hasActiveTopic && metrics.total > 0
                  ? `${metrics.confusionPct}%`
                  : "—"}
              </div>
              <div
                className={`text-xs mt-1 tabular-nums ${
                  isSpikeNow ? "text-rose-200/85" : "text-amber-200/80"
                }`}
              >
                {metrics.confused} confused
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="h-3.5 w-full rounded-full pp-input border overflow-hidden flex">
              {!hasActiveTopic || metrics.total === 0 ? (
                <div className="w-full h-full bg-slate-800/60" />
              ) : (
                <>
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${metrics.understandingPct}%` }}
                  />
                  <div
                    className={`h-full transition-all duration-300 ${
                      isSpikeNow ? "bg-rose-500" : "bg-amber-500"
                    }`}
                    style={{ width: `${metrics.confusionPct}%` }}
                  />
                </>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
              <span>0%</span>
              <span className="text-rose-400/90">30% spike threshold</span>
              <span>100%</span>
            </div>
          </div>
        </section>

        {/* Live Pace-o-Meter Speedometer */}
        <div className="lg:col-span-3 min-w-0">
          <PaceOMeter assessment={paceAssessment} />
        </div>

        {/* Live "Why Are Students Confused?" Reason Tags */}
        <section className="lg:col-span-4 pp-card backdrop-blur-xl border rounded-2xl p-4 sm:p-6 flex flex-col justify-between space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-slate-100">
                Confusion Reasons
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Live 1-tap student feedback
              </p>
            </div>
            {metrics.topReason && (
              <span className="text-xs font-semibold text-amber-300 shrink-0">
                Top: {metrics.topReason}
              </span>
            )}
          </div>

          <div className="space-y-2.5">
            {CONFUSION_REASONS.map((reason) => {
              const count = metrics.reasonCounts[reason] || 0;
              const pct =
                metrics.confused > 0
                  ? Math.round((count / metrics.confused) * 100)
                  : 0;
              return (
                <div key={reason} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-200">{reason}</span>
                    <span className="font-mono text-slate-400 tabular-nums">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full pp-input border overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Row 2: 1-Minute Interval Timeline Graph + Spike Alert Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-8 pp-card backdrop-blur-xl border rounded-2xl p-4 sm:p-6 space-y-4 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-100">
                1-Minute Interval Confusion Timeline
              </h2>
              <p className="text-xs text-slate-400">
                X-axis: Clean 1-minute intervals · Live updates within current
                minute · Red triangles mark spikes &gt;30%
              </p>
            </div>
            <div className="flex items-center gap-2">
              {hasActiveTopic && !isSpikeNow && metrics.confusionPct >= 15 && (
                <button
                  type="button"
                  disabled={triggeringRecheck}
                  onClick={() => void handleTriggerRecheckPulse()}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg bg-sky-600/90 hover:bg-sky-500 text-xs font-semibold text-white inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Re-Check Pulse</span>
                </button>
              )}
              <button
                type="button"
                disabled={!hasActiveTopic}
                onClick={() => void upsertMinuteTimelinePoint(true)}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 text-xs font-medium text-slate-200 transition-colors"
              >
                Snapshot Minute
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl pp-input border">
            <button
              type="button"
              onClick={() => setGraphMode("live")}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                graphMode === "live"
                  ? "pp-primary-btn text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Current Live Topic
            </button>

            <button
              type="button"
              onClick={() => setGraphMode("full")}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                graphMode === "full"
                  ? "pp-primary-btn text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Full Lecture Combined Timeline
            </button>

            {(room.topicHistory || []).map((rec) => {
              const key = `topic-${rec.topicVersion}`;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setGraphMode(key)}
                  className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors max-w-[180px] truncate ${
                    graphMode === key
                      ? "bg-slate-800 text-sky-300 border border-sky-500/40"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {rec.topic}
                </button>
              );
            })}
          </div>

          <ConfusionChart
            points={displayedChartPoints}
            showTopicDividers={graphMode === "full"}
            emptyText={
              !hasActiveTopic
                ? "Broadcast your first topic above to start plotting 1-minute confusion telemetry."
                : "Collecting live telemetry for the current 1-minute bucket..."
            }
          />
        </section>

        {/* Spike Alert Log + Top 3 Anonymous Doubts Wall */}
        <div className="lg:col-span-4 space-y-6 min-w-0">
          <section className="pp-card backdrop-blur-xl border rounded-2xl p-4 sm:p-5 flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-100">
                Spike Alert Log
              </h2>
              <span className="font-mono text-xs text-rose-400 tabular-nums">
                {allSpikes.length} {allSpikes.length === 1 ? "spike" : "spikes"}
              </span>
            </div>

            {allSpikes.length === 0 ? (
              <div className="p-4 border border-dashed border-slate-800 rounded-xl pp-input text-center">
                <p className="text-xs font-medium text-slate-300">
                  No confusion spikes yet
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Flags any minute crossing 30% confusion with topic &amp; reason breakdown.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                {[...allSpikes].reverse().map((sp) => (
                  <div
                    key={sp.id}
                    className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-rose-300">
                        ⚠️ Spike at {sp.timeLabel}
                      </span>
                      <span className="font-mono text-xs font-bold text-rose-400 tabular-nums">
                        {sp.confusionPct}%
                      </span>
                    </div>
                    <div className="text-xs text-slate-200 break-words">
                      Topic: <span className="font-semibold">{sp.topic}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 tabular-nums">
                      {sp.confusedCount}/{sp.totalParticipants} confused
                      {sp.topReason ? ` · ${sp.topReason}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Top 3 Most Upvoted Student Doubts (respects 3-mode Student Visibility) */}
          <section className="pp-card backdrop-blur-xl border rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-sky-400" />
                <h2 className="font-display text-base font-bold text-slate-100">
                  Top 3 Student Doubts
                </h2>
              </div>
              <span className="text-xs text-slate-400 tabular-nums">
                Upvoted live
              </span>
            </div>

            {combinedTopDoubts.length === 0 ? (
              <div className="p-4 border border-dashed border-slate-800 rounded-xl pp-input text-center">
                <p className="text-xs text-slate-400">
                  No unresolved student doubts for this topic.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {combinedTopDoubts.map((doubt) => {
                  const showName =
                    (doubt.visibility === "teacher" ||
                      doubt.visibility === "public") &&
                    Boolean(doubt.displayName);
                  const authorLabel = showName
                    ? doubt.displayName!
                    : "Anonymous Student";
                  return (
                    <div
                      key={doubt.id}
                      className="p-3 rounded-xl pp-input border space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span
                          className={
                            showName
                              ? "font-semibold text-sky-300"
                              : "text-slate-400"
                          }
                        >
                          {authorLabel}
                        </span>
                        {doubt.visibility === "teacher" && (
                          <span className="text-[10px] text-amber-300">
                            Teacher Only
                          </span>
                        )}
                        {doubt.visibility === "public" && (
                          <span className="text-[10px] text-emerald-300">
                            Public
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-100 leading-relaxed break-words">
                        {doubt.text}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-sky-400 tabular-nums">
                          +{doubt.upvoterUids?.length || 0} same doubt
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleResolveDoubt(doubt)}
                          className="min-h-[32px] px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-[11px] font-semibold inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          <span>✓ Mark Resolved</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Confused Students Live List (respects 3-mode Student Visibility) */}
          <section className="pp-card backdrop-blur-xl border rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-400" />
                <h2 className="font-display text-base font-bold text-slate-100">
                  Confused Students
                </h2>
              </div>
              <span className="font-mono text-xs text-amber-300 tabular-nums">
                {confusedStudentsList.length} signaling
              </span>
            </div>

            {confusedStudentsList.length === 0 ? (
              <div className="p-4 border border-dashed border-slate-800 rounded-xl pp-input text-center">
                <p className="text-xs text-slate-400">
                  No students currently signaling confusion.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                {confusedStudentsList.slice(0, 20).map((student) => {
                  const showName =
                    (student.visibility === "teacher" ||
                      student.visibility === "public") &&
                    Boolean(student.displayName);
                  const studentLabel = showName
                    ? student.displayName!
                    : "Anonymous Student";
                  return (
                    <div
                      key={student.uid}
                      className="p-2.5 rounded-xl pp-input border flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div
                          className={`truncate font-medium ${
                            showName ? "text-sky-300" : "text-slate-300"
                          }`}
                        >
                          {studentLabel}
                        </div>
                        {student.reasons && student.reasons.length > 0 && (
                          <div className="text-[11px] text-amber-300/90 truncate">
                            {student.reasons.join(" · ")}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        {student.visibility === "teacher"
                          ? "Teacher Only"
                          : student.visibility === "public"
                          ? "Public"
                          : "Anonymous"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Row 3: Custom Poll + AI Smart Question Generator (5-Q Unique Sets) + Written Mode & Live Results */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 pp-card backdrop-blur-xl border rounded-2xl p-4 sm:p-6 space-y-5 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-sky-400" />
              <h2 className="font-display text-base font-bold text-slate-100">
                Polls &amp; Smart Assessments
              </h2>
            </div>
          </div>

          {/* 3-Tab Mode Selector */}
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl pp-input border">
            <button
              type="button"
              onClick={() => setQuestionTab("poll")}
              className={`min-h-[38px] px-2 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-colors ${
                questionTab === "poll"
                  ? "pp-primary-btn text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Micro-Poll
            </button>
            <button
              type="button"
              onClick={() => setQuestionTab("ai_mcq")}
              className={`min-h-[38px] px-2 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-colors ${
                questionTab === "ai_mcq"
                  ? "pp-primary-btn text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              ✨ AI 5-Q Sets
            </button>
            <button
              type="button"
              onClick={() => setQuestionTab("written")}
              className={`min-h-[38px] px-2 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-colors ${
                questionTab === "written"
                  ? "pp-primary-btn text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              ✍️ Written Q
            </button>
          </div>

          {pollError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">
              {pollError}
            </div>
          )}

          {questionTab === "poll" && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={launchingPoll}
                  onClick={handleQuickPulse}
                  className="min-h-[48px] px-3.5 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-200 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 text-center"
                >
                  <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Quick Pulse Check</span>
                </button>

                <button
                  type="button"
                  onClick={handleAutoGenerateRescuePoll}
                  className={`min-h-[48px] px-3.5 py-2.5 rounded-xl border text-xs font-semibold transition-all flex items-center justify-center gap-1.5 text-center ${
                    isSpikeNow
                      ? "bg-rose-500/25 hover:bg-rose-500/35 border-rose-400 text-rose-100 shadow-lg shadow-rose-500/15"
                      : "bg-sky-500/15 hover:bg-sky-500/25 border-sky-500/40 text-sky-200"
                  }`}
                >
                  <Wand2 className="w-4 h-4 shrink-0" />
                  <span>✨ Auto-Generate Rescue Poll</span>
                </button>
              </div>

              {rescueRationale && (
                <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-xs text-sky-200">
                  <span className="font-semibold">Diagnostic Rescue Poll Ready:</span>{" "}
                  {rescueRationale}
                </div>
              )}

              <form
                onSubmit={handleCreateCustomPoll}
                className="space-y-4 pt-3 border-t border-slate-800"
              >
                <div className="space-y-1.5">
                  <label
                    htmlFor="poll-question"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Poll Question
                  </label>
                  <input
                    id="poll-question"
                    type="text"
                    value={pollQuestion}
                    onChange={(e) => setPollQuestion(e.target.value)}
                    placeholder="e.g., What is the time complexity of binary search?"
                    maxLength={240}
                    className="w-full min-h-[46px] px-3.5 py-2 rounded-xl pp-input border focus:border-sky-500 focus:outline-none text-sm text-slate-100 placeholder:text-slate-600"
                  />
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Options (A–D)</span>
                    <span>Mark Correct Answer</span>
                  </div>
                  {pollOptions.map((opt, idx) => {
                    const isMarkedCorrect = correctOptionIndex === idx;
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-400 w-4 shrink-0">
                          {optionLetters[idx]}
                        </span>
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => {
                            const next = [...pollOptions];
                            next[idx] = e.target.value;
                            setPollOptions(next);
                          }}
                          placeholder={`Option ${optionLetters[idx]}`}
                          maxLength={120}
                          className="flex-1 min-w-0 min-h-[44px] px-3 py-2 rounded-xl pp-input border focus:border-sky-500 focus:outline-none text-sm text-slate-100 placeholder:text-slate-600"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setCorrectOptionIndex(isMarkedCorrect ? null : idx)
                          }
                          title="Mark Correct Answer"
                          className={`min-h-[44px] px-2.5 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
                            isMarkedCorrect
                              ? "bg-emerald-500/20 border-emerald-400 text-emerald-300"
                              : "pp-input text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">
                            {isMarkedCorrect ? "Correct" : "Mark"}
                          </span>
                        </button>
                        {pollOptions.length > 2 && (
                          <button
                            type="button"
                            onClick={() => {
                              setPollOptions(
                                pollOptions.filter((_, i) => i !== idx)
                              );
                              if (correctOptionIndex === idx) {
                                setCorrectOptionIndex(null);
                              }
                            }}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border pp-input hover:bg-slate-800 text-slate-400 hover:text-rose-400 shrink-0"
                            aria-label="Remove option"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {pollOptions.length < 4 && (
                    <button
                      type="button"
                      onClick={() => setPollOptions([...pollOptions, ""])}
                      className="min-h-[38px] inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Option</span>
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={launchingPoll}
                  className="w-full min-h-[48px] px-4 py-2.5 rounded-xl pp-primary-btn disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  <span>{launchingPoll ? "Launching..." : "Launch Live Poll"}</span>
                </button>
              </form>
            </>
          )}

          {questionTab === "ai_mcq" && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl pp-input border space-y-2 text-xs text-slate-300">
                <div className="font-semibold text-sky-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI Conceptual Bank → Unique 5-Q Sets Per Student</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Generates 16+ conceptual MCQs across Definition, Formula,
                  Practical Use, and Edge Cases. Each student receives a{" "}
                  <strong className="text-slate-200">
                    unique shuffled 5-question set
                  </strong>{" "}
                  to prevent copying.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={generatingAiBank}
                  onClick={() => void handleGenerateAiQuestionBank()}
                  className="flex-1 min-h-[46px] px-4 py-2.5 rounded-xl pp-primary-btn disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  {generatingAiBank ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Generating Bank...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" />
                      <span>
                        {aiBank.length > 0
                          ? "🔄 Refresh New Set"
                          : "✨ Generate AI Questions"}
                      </span>
                    </>
                  )}
                </button>

                {activeQuiz && activeQuiz.mode === "mcq_set" && (
                  <button
                    type="button"
                    disabled={launchingQuiz}
                    onClick={() => void handleResendFreshFiveQuestions()}
                    className="min-h-[46px] px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>🔄 Refresh &amp; Resend New 5 Qs</span>
                  </button>
                )}
              </div>

              {aiNotice && (
                <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-xs text-sky-200">
                  {aiNotice}
                </div>
              )}

              {aiBank.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>
                      Selected:{" "}
                      <strong className="text-slate-100 tabular-nums">
                        {aiBank.filter((q) => selectedAiIds[q.id]).length}
                      </strong>{" "}
                      / {aiBank.length} MCQs
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const allChecked = aiBank.every((q) => selectedAiIds[q.id]);
                        const next: Record<string, boolean> = {};
                        aiBank.forEach((q) => {
                          next[q.id] = !allChecked;
                        });
                        setSelectedAiIds(next);
                      }}
                      className="text-sky-400 hover:text-sky-300 font-medium"
                    >
                      {aiBank.every((q) => selectedAiIds[q.id])
                        ? "Deselect All"
                        : "Select All"}
                    </button>
                  </div>

                  <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                    {aiBank.map((item, idx) => {
                      const checked = Boolean(selectedAiIds[item.id]);
                      return (
                        <label
                          key={item.id}
                          className={`block p-3 rounded-xl border cursor-pointer transition-colors ${
                            checked
                              ? "bg-sky-500/10 border-sky-500/40"
                              : "pp-input opacity-65"
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedAiIds((prev) => ({
                                  ...prev,
                                  [item.id]: !prev[item.id],
                                }))
                              }
                              className="mt-1 accent-sky-500 shrink-0"
                            />
                            <div className="min-w-0 space-y-1">
                              <div className="text-[10px] font-semibold text-sky-300">
                                Q{idx + 1} · {item.category}
                              </div>
                              <div className="text-xs font-medium text-slate-100 break-words">
                                {item.question}
                              </div>
                              <div className="text-[11px] text-emerald-300">
                                ✓ {item.options[item.correctIndex]}
                              </div>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    disabled={
                      launchingQuiz ||
                      aiBank.filter((q) => selectedAiIds[q.id]).length < 5
                    }
                    onClick={() => void handlePushUniqueQuizSets()}
                    className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    <span>
                      {launchingQuiz
                        ? "Pushing Sets..."
                        : "Push Unique 5-Q Sets to Class"}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}

          {questionTab === "written" && (
            <form onSubmit={handlePushWrittenQuestion} className="space-y-4">
              <div className="p-3.5 rounded-xl pp-input border text-xs text-slate-400 leading-relaxed">
                Push an open-ended conceptual question so students type a short
                written response directly from their phones.
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="written-prompt"
                  className="block text-xs font-medium text-slate-300"
                >
                  Written Conceptual Prompt
                </label>
                <textarea
                  id="written-prompt"
                  rows={3}
                  maxLength={400}
                  value={writtenPromptInput}
                  onChange={(e) => setWrittenPromptInput(e.target.value)}
                  placeholder="e.g., Explain in 1–2 sentences why a missing base case causes a stack overflow."
                  className="w-full px-3.5 py-2.5 rounded-xl pp-input border focus:border-sky-400 focus:outline-none text-sm text-slate-100 placeholder:text-slate-600 resize-y"
                />
              </div>
              <button
                type="submit"
                disabled={launchingQuiz || writtenPromptInput.trim().length < 4}
                className="w-full min-h-[48px] px-4 py-2.5 rounded-xl pp-primary-btn disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2"
              >
                <FileText className="w-4 h-4" />
                <span>
                  {launchingQuiz
                    ? "Sending..."
                    : "Push Written Question to Class"}
                </span>
              </button>
            </form>
          )}
        </section>

        {/* Live Results (Micro-Poll OR AI 5-Q Set / Written Responses) */}
        <section className="lg:col-span-7 pp-card backdrop-blur-xl border rounded-2xl p-4 sm:p-6 flex flex-col justify-between space-y-5 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-bold text-slate-100">
                  {resultsFocus === "quiz" && activeQuiz
                    ? activeQuiz.mode === "written"
                      ? "Live Written Question Responses"
                      : `Live 5-Q Conceptual Assessment (Set #${activeQuiz.batchVersion})`
                    : "Live Micro-Poll Results"}
                </h2>
                {activePoll && activeQuiz && (
                  <div className="inline-flex rounded-lg pp-input border p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setResultsFocus("poll")}
                      className={`px-2 py-0.5 rounded-md font-semibold ${
                        resultsFocus === "poll"
                          ? "pp-primary-btn text-white"
                          : "text-slate-400"
                      }`}
                    >
                      Poll
                    </button>
                    <button
                      type="button"
                      onClick={() => setResultsFocus("quiz")}
                      className={`px-2 py-0.5 rounded-md font-semibold ${
                        resultsFocus === "quiz"
                          ? "pp-primary-btn text-white"
                          : "text-slate-400"
                      }`}
                    >
                      {activeQuiz.mode === "written" ? "Written" : "5-Q Set"}
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {resultsFocus === "quiz" && activeQuiz
                  ? `Topic: ${activeQuiz.mainTopic}${
                      activeQuiz.subheading ? ` · ${activeQuiz.subheading}` : ""
                    }`
                  : activePoll
                  ? `Topic: ${activePoll.topic}`
                  : "Launch a Quick Pulse, AI 5-Q Set, Written Question, or Custom Poll"}
              </p>
            </div>

            {resultsFocus === "quiz" && activeQuiz && activeQuiz.isOpen ? (
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-xs text-slate-300 tabular-nums">
                  {
                    quizResponses.filter(
                      (r) => r.batchVersion === activeQuiz.batchVersion
                    ).length
                  }{" "}
                  submitted
                </span>
                <button
                  type="button"
                  onClick={() => void handleCloseActiveQuiz()}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200"
                >
                  Close Question
                </button>
              </div>
            ) : (
              activePoll && (
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-xs text-slate-300 tabular-nums">
                    {activePollTotal} / {metrics.total || activePollTotal} voted
                  </span>
                  <button
                    type="button"
                    onClick={handleCloseActivePoll}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200"
                  >
                    Close Poll
                  </button>
                </div>
              )
            )}
          </div>

          {resultsFocus === "quiz" && activeQuiz ? (
            activeQuiz.mode === "mcq_set" ? (
              <div className="space-y-4">
                {(() => {
                  const batchResponses = quizResponses.filter(
                    (r) => r.batchVersion === activeQuiz.batchVersion
                  );
                  const avgScore =
                    batchResponses.length > 0
                      ? (
                          batchResponses.reduce((acc, r) => acc + (r.score || 0), 0) /
                          batchResponses.length
                        ).toFixed(1)
                      : "0.0";
                  return (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-3.5 rounded-xl pp-input border">
                          <div className="text-[11px] text-slate-400">Pool Size</div>
                          <div className="font-mono text-xl font-bold text-sky-400 mt-0.5 tabular-nums">
                            {activeQuiz.questions?.length || 0} Qs
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl pp-input border">
                          <div className="text-[11px] text-slate-400">
                            Submitted (Set #{activeQuiz.batchVersion})
                          </div>
                          <div className="font-mono text-xl font-bold text-slate-100 mt-0.5 tabular-nums">
                            {batchResponses.length}
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl pp-input border">
                          <div className="text-[11px] text-slate-400">Avg Score</div>
                          <div className="font-mono text-xl font-bold text-emerald-400 mt-0.5 tabular-nums">
                            {avgScore} / 5
                          </div>
                        </div>
                      </div>

                      {batchResponses.length === 0 ? (
                        <div className="p-6 border border-dashed border-slate-800 rounded-xl pp-input text-center text-xs text-slate-400">
                          Each connected student now has a unique randomized 5-question
                          set. Scores appear here live as students submit.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                          {batchResponses.map((resp, idx) => {
                            const showName =
                              (resp.visibility === "teacher" ||
                                resp.visibility === "public") &&
                              Boolean(resp.displayName);
                            return (
                              <div
                                key={resp.uid}
                                className="p-3 rounded-xl pp-input border flex items-center justify-between gap-2 text-xs"
                              >
                                <span
                                  className={
                                    showName
                                      ? "font-semibold text-sky-300"
                                      : "text-slate-300"
                                  }
                                >
                                  {showName
                                    ? resp.displayName
                                    : `Anonymous Student #${idx + 1}`}
                                </span>
                                <span className="font-mono font-bold text-emerald-400 tabular-nums">
                                  {resp.score ?? 0} / {resp.totalQuestions ?? 5}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-xl pp-input border">
                  <div className="text-xs text-sky-400 font-medium mb-1">
                    Written Prompt on Student Screens
                  </div>
                  <div className="font-display text-base sm:text-lg font-bold text-slate-100 break-words">
                    {activeQuiz.writtenPrompt}
                  </div>
                </div>

                {quizResponses.length === 0 ? (
                  <div className="p-6 border border-dashed border-slate-800 rounded-xl pp-input text-center text-xs text-slate-400">
                    Waiting for student short-answer responses...
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[240px] overflow-y-auto pr-1">
                    {quizResponses.map((resp, idx) => {
                      const showName =
                        (resp.visibility === "teacher" ||
                          resp.visibility === "public") &&
                        Boolean(resp.displayName);
                      return (
                        <div
                          key={resp.uid}
                          className="p-3.5 rounded-xl pp-input border space-y-1"
                        >
                          <div className="text-[11px] font-medium text-sky-300">
                            {showName
                              ? resp.displayName
                              : `Anonymous Student #${idx + 1}`}
                          </div>
                          <p className="text-xs sm:text-sm text-slate-100 leading-relaxed break-words">
                            {resp.writtenAnswer}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )
          ) : activePoll ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl pp-input border">
                <div className="text-xs text-sky-400 font-medium mb-1">
                  Live on Student Screens
                </div>
                <div className="font-display text-lg font-bold text-slate-100 break-words">
                  {activePoll.question}
                </div>
              </div>

              <div className="space-y-3">
                {activePoll.options.map((opt, idx) => {
                  const count = activePollCounts[idx] ?? 0;
                  const pct =
                    activePollTotal > 0
                      ? Math.round((count / activePollTotal) * 100)
                      : 0;
                  const isCorrect = activePoll.correctOptionIndex === idx;
                  return (
                    <div key={idx} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-slate-100 break-words">
                          <span className="font-mono text-slate-400 mr-2">
                            {optionLetters[idx]}.
                          </span>
                          {opt}
                          {isCorrect && (
                            <span className="ml-2 text-emerald-400 font-semibold">
                              (Correct Answer)
                            </span>
                          )}
                        </span>
                        <span className="font-mono text-slate-300 shrink-0 tabular-nums">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-3 rounded-full pp-input border overflow-hidden">
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
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-800 rounded-xl pp-input min-h-[210px]">
              <BarChart3 className="w-8 h-8 text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-300">
                No active micro-poll or quiz set
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Use Micro-Poll, ✨ AI 5-Q Sets, or ✍️ Written Q on the left to
                assess live conceptual understanding.
              </p>
            </div>
          )}

          {(room.pollHistory || []).length > 0 && (
            <div className="pt-3 border-t border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Archived Polls</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {room.pollHistory.length}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {room.pollHistory.slice(-4).map((p) => (
                  <div
                    key={p.pollId}
                    className="p-2.5 rounded-xl pp-input border text-xs"
                  >
                    <div className="font-medium text-slate-200 truncate">
                      {p.question}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                      {p.totalVotes} votes
                      {p.accuracyPct !== null
                        ? ` · ${p.accuracyPct}% accurate`
                        : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Row 4: Lecture Notes & Resources (PPT / PDF / DOCS Upload) */}
      <LectureNotesPanel roomCode={roomCode} user={user} canUpload={true} />
    </main>
  );
}
