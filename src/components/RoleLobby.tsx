import React, { useEffect, useRef, useState } from "react";
import { User } from "firebase/auth";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  Copy,
  FileBarChart2,
  FolderOpen,
  GraduationCap,
  MessageSquare,
  Presentation,
  QrCode,
  Radio,
  RefreshCw,
  Shield,
  Users,
  X,
} from "lucide-react";
import {
  OperationType,
  collection,
  db,
  deleteDoc,
  doc,
  getDoc,
  handleFirestoreError,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "../firebase";
import {
  AttendedClassEntry,
  ConductedClassEntry,
  JoinCodeDoc,
  RoomDoc,
  StudentVisibility,
} from "../types";
import {
  formatDateLabel,
  formatRoomCode,
  generateRoomCode,
  getStoredStudentVisibility,
  normalizeRoomCode,
  resolveStudentDisplayName,
  saveStudentVisibility,
} from "../utils/roomUtils";
import { LectureNotesPanel } from "./LectureNotesPanel";
import { PostClassDoubtPortal } from "./PostClassDoubtPortal";
import { QrCodeBox } from "./QrCodeBox";
import { QrScannerModal } from "./QrScannerModal";

interface RoleLobbyProps {
  user: User;
  initialRoomCode?: string;
  accessNotice?: string | null;
  onClearAccessNotice?: () => void;
  onEnterTeacher: (roomCode: string) => void;
  onEnterStudent: (roomCode: string) => void;
  onOpenSummary: (roomCode: string, mode: "teacher" | "student") => void;
}

export function RoleLobby({
  user,
  initialRoomCode = "",
  accessNotice = null,
  onClearAccessNotice,
  onEnterTeacher,
  onEnterStudent,
  onOpenSummary,
}: RoleLobbyProps) {
  const [lectureTitle, setLectureTitle] = useState("");
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [createdRoomCode, setCreatedRoomCode] = useState<string | null>(null);
  const [createdJoinCode, setCreatedJoinCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(10);
  const [copiedCode, setCopiedCode] = useState(false);
  const [teacherError, setTeacherError] = useState<string | null>(null);
  const createdJoinCodeRef = useRef<string | null>(null);
  const joinCodeExpiresAtRef = useRef<number>(0);
  const openingTeacherRef = useRef(false);

  const [joinInput, setJoinInput] = useState(() => {
    const clean = normalizeRoomCode(initialRoomCode);
    return clean.length > 2 ? `${clean.slice(0, 2)}-${clean.slice(2)}` : clean;
  });
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [studentVisibility, setStudentVisibility] = useState<StudentVisibility>(() =>
    getStoredStudentVisibility()
  );

  const [historyDrawer, setHistoryDrawer] = useState<{
    roomCode: string;
    title: string;
    isTeacher: boolean;
  } | null>(null);

  const [hostedRooms, setHostedRooms] = useState<RoomDoc[]>([]);
  const [conductedHistory, setConductedHistory] = useState<ConductedClassEntry[]>([]);
  const [attendedClassesList, setAttendedClassesList] = useState<AttendedClassEntry[]>([]);
  const [attendedRoomsList, setAttendedRoomsList] = useState<AttendedClassEntry[]>([]);
  const [loadingTeacherHistory, setLoadingTeacherHistory] = useState(true);
  const [loadingStudentHistory, setLoadingStudentHistory] = useState(true);

  useEffect(() => {
    const clean = normalizeRoomCode(initialRoomCode);
    if (clean.length === 6) {
      setJoinInput(`${clean.slice(0, 2)}-${clean.slice(2)}`);
    }
  }, [initialRoomCode]);

  // Rotate created room's single active Join Code every 10s with strict 10s expiry & zero grace buffer
  useEffect(() => {
    if (!createdRoomCode) return;

    const invalidateCreatedCode = () => {
      const codeToClear = createdJoinCodeRef.current;
      createdJoinCodeRef.current = null;
      joinCodeExpiresAtRef.current = 0;
      const ops: Promise<unknown>[] = [
        updateDoc(doc(db, "rooms", createdRoomCode), {
          activeJoinCode: null,
          previousJoinCode: null,
          codeExpiresAt: 0,
          validJoinCodes: [],
        }).catch(() => {}),
      ];
      if (codeToClear && codeToClear !== createdRoomCode) {
        ops.push(deleteDoc(doc(db, "joinCodes", codeToClear)).catch(() => {}));
      }
      void Promise.allSettled(ops);
    };

    const tickTimer = setInterval(() => {
      const msLeft = Math.max(0, joinCodeExpiresAtRef.current - Date.now());
      setSecondsLeft(Math.max(1, Math.min(10, Math.ceil(msLeft / 1000))));
    }, 250);

    const rotateTimer = setInterval(() => {
      const nowMs = Date.now();
      const expiresAt = nowMs + 10000;
      const prevCode = createdJoinCodeRef.current;
      const excluded =
        prevCode && prevCode !== createdRoomCode
          ? [createdRoomCode, prevCode]
          : [createdRoomCode];
      const nextCode = generateRoomCode(excluded);

      createdJoinCodeRef.current = nextCode;
      joinCodeExpiresAtRef.current = expiresAt;
      setCreatedJoinCode(nextCode);
      setSecondsLeft(10);

      const ops: Promise<unknown>[] = [
        setDoc(doc(db, "joinCodes", nextCode), {
          code: nextCode,
          roomId: createdRoomCode,
          hostUid: user.uid,
          createdAtMs: nowMs,
          expiresAtMs: expiresAt,
        }),
        updateDoc(doc(db, "rooms", createdRoomCode), {
          activeJoinCode: nextCode,
          codeExpiresAt: expiresAt,
          previousJoinCode: null,
          joinCodeUpdatedAtMs: nowMs,
          validJoinCodes: [],
        }),
      ];
      if (prevCode && prevCode !== createdRoomCode && prevCode !== nextCode) {
        ops.push(deleteDoc(doc(db, "joinCodes", prevCode)).catch(() => {}));
      }
      void Promise.allSettled(ops);
    }, 10000);

    const handlePageHide = () => {
      if (!openingTeacherRef.current) {
        invalidateCreatedCode();
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);

    return () => {
      clearInterval(tickTimer);
      clearInterval(rotateTimer);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
      if (!openingTeacherRef.current) {
        invalidateCreatedCode();
      }
    };
  }, [createdRoomCode, user.uid]);

  // Listen to teacher's hosted rooms (fallback/live sync)
  useEffect(() => {
    const roomsQuery = query(
      collection(db, "rooms"),
      where("hostUid", "==", user.uid)
    );
    const unsub = onSnapshot(
      roomsQuery,
      (snap) => {
        const docs: RoomDoc[] = snap.docs.map((d) => d.data() as RoomDoc);
        docs.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
        setHostedRooms(docs);
        setLoadingTeacherHistory(false);
      },
      (err) => {
        setLoadingTeacherHistory(false);
        handleFirestoreError(err, OperationType.LIST, "rooms");
      }
    );
    return () => unsub();
  }, [user.uid]);

  // Listen to teacher's persistent Conducted Classes history
  useEffect(() => {
    const path = `users/${user.uid}/conductedClasses`;
    const unsub = onSnapshot(
      collection(db, "users", user.uid, "conductedClasses"),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as ConductedClassEntry);
        list.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
        setConductedHistory(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );
    return () => unsub();
  }, [user.uid]);

  // Listen to student's persistent Attended Classes & Attended Rooms (strictly classes legitimately joined)
  useEffect(() => {
    const path = `users/${user.uid}/attendedClasses`;
    const unsubClasses = onSnapshot(
      collection(db, "users", user.uid, "attendedClasses"),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as AttendedClassEntry);
        setAttendedClassesList(list);
        setLoadingStudentHistory(false);
      },
      (err) => {
        setLoadingStudentHistory(false);
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );

    const unsubRooms = onSnapshot(
      collection(db, "users", user.uid, "attendedRooms"),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as AttendedClassEntry);
        setAttendedRoomsList(list);
      },
      () => {
        // Fallback smoothly if attendedRooms rules are pending publish
      }
    );

    return () => {
      unsubClasses();
      unsubRooms();
    };
  }, [user.uid]);

  const attendedHistory = React.useMemo(() => {
    const map = new Map<string, AttendedClassEntry>();
    for (const item of [...attendedRoomsList, ...attendedClassesList]) {
      const prev = map.get(item.roomCode);
      map.set(item.roomCode, {
        ...prev,
        ...item,
        pollAnswers: {
          ...(prev?.pollAnswers || {}),
          ...(item.pollAnswers || {}),
        },
      });
    }
    return Array.from(map.values()).sort(
      (a, b) => (b.joinedAtMs || 0) - (a.joinedAtMs || 0)
    );
  }, [attendedClassesList, attendedRoomsList]);

  // Merge conductedHistory + hostedRooms so every class appears immediately with latest counts (hostUid === user.uid only)
  const mergedConducted: ConductedClassEntry[] = React.useMemo(() => {
    const map = new Map<string, ConductedClassEntry>();
    for (const room of hostedRooms) {
      if (room.hostUid !== user.uid) continue;
      map.set(room.roomCode, {
        roomCode: room.roomCode,
        title: room.title,
        status: room.status,
        createdAtMs: room.createdAtMs,
        endedAtMs: room.endedAtMs,
        studentCount: room.summary?.totalParticipants ?? 0,
        overallComprehensionPct: room.summary?.overallComprehensionPct ?? null,
      });
    }
    for (const item of conductedHistory) {
      const existing = map.get(item.roomCode);
      if (!existing || item.status === "ended") {
        map.set(item.roomCode, {
          ...existing,
          ...item,
          studentCount:
            item.studentCount || existing?.studentCount || 0,
          overallComprehensionPct:
            item.overallComprehensionPct ??
            existing?.overallComprehensionPct ??
            null,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)
    );
  }, [hostedRooms, conductedHistory, user.uid]);

  const handleHostLecture = async (e: React.FormEvent) => {
    e.preventDefault();
    setTeacherError(null);

    const cleanTitle = lectureTitle.trim() || "Live Lecture Session";
    setCreatingRoom(true);
    try {
      let chosenCode = "";
      for (let attempt = 0; attempt < 6; attempt++) {
        const candidate = generateRoomCode();
        const ref = doc(db, "rooms", candidate);
        const existing = await getDoc(ref);
        if (!existing.exists()) {
          chosenCode = candidate;
          break;
        }
      }

      if (!chosenCode) {
        throw new Error("Could not allocate a unique room code. Please try again.");
      }

      const nowMs = Date.now();
      const expiresAt = nowMs + 10000;
      const initialJoinCode = generateRoomCode([chosenCode]);
      const newRoom: RoomDoc = {
        roomCode: chosenCode,
        title: cleanTitle.slice(0, 140),
        hostUid: user.uid,
        status: "live",
        currentTopic: "",
        currentMainTopic: "",
        currentSubheading: "",
        subheadingHistory: [],
        topicVersion: 0,
        topicStartedAtMs: null,
        topicHistory: [],
        activeJoinCode: initialJoinCode,
        codeExpiresAt: expiresAt,
        previousJoinCode: null,
        joinCodeUpdatedAtMs: nowMs,
        validJoinCodes: [],
        activePollId: null,
        lastPollId: null,
        pollHistory: [],
        activeQuizId: null,
        lastQuizId: null,
        createdAtMs: nowMs,
        endedAtMs: null,
      };

      await setDoc(doc(db, "rooms", chosenCode), {
        ...newRoom,
        createdAt: serverTimestamp(),
      });

      const conductedEntry: ConductedClassEntry = {
        roomCode: chosenCode,
        title: cleanTitle.slice(0, 140),
        status: "live",
        createdAtMs: nowMs,
        studentCount: 0,
        overallComprehensionPct: null,
      };

      await Promise.allSettled([
        setDoc(doc(db, "joinCodes", initialJoinCode), {
          code: initialJoinCode,
          roomId: chosenCode,
          hostUid: user.uid,
          createdAtMs: nowMs,
          expiresAtMs: expiresAt,
        }),
        setDoc(
          doc(db, "users", user.uid, "conductedClasses", chosenCode),
          conductedEntry
        ),
      ]);

      openingTeacherRef.current = false;
      createdJoinCodeRef.current = initialJoinCode;
      joinCodeExpiresAtRef.current = expiresAt;
      setCreatedRoomCode(chosenCode);
      setCreatedJoinCode(initialJoinCode);
      setSecondsLeft(10);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("{")) {
        throw err;
      }
      setTeacherError(
        err instanceof Error
          ? err.message
          : "Unable to create classroom session. Check Firestore rules and connectivity."
      );
    } finally {
      setCreatingRoom(false);
    }
  };

  const EXPIRED_CODE_ERROR =
    "⛔ QR / Join Code Expired! Codes expire every 10 seconds to prevent proxy sharing. Please scan the current live code on the teacher's screen.";

  const joinLectureByCode = async (rawCode: string) => {
    setStudentError(null);
    onClearAccessNotice?.();

    const normalized = normalizeRoomCode(rawCode);
    if (normalized.length !== 6) {
      setStudentError("Please enter a valid 6-character Join Code (e.g., CS-8492).");
      return;
    }

    setJoiningRoom(true);
    try {
      const initialNowMs = Date.now();
      let resolvedRoomId = "";

      // 1. Lookup single active joinCodes/{code} and verify it has not passed its 10s expiry
      try {
        const joinSnap = await getDoc(doc(db, "joinCodes", normalized));
        if (joinSnap.exists()) {
          const jc = joinSnap.data() as JoinCodeDoc;
          if (initialNowMs > jc.expiresAtMs) {
            setStudentError(EXPIRED_CODE_ERROR);
            return;
          }
          resolvedRoomId = jc.roomId;
        }
      } catch {
        // Handle Firestore error on fallback below
      }

      // 2. Fallback check if normalized maps directly to a room doc
      if (!resolvedRoomId) {
        let directRoomSnap;
        try {
          directRoomSnap = await getDoc(doc(db, "rooms", normalized));
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `rooms/${normalized}`);
        }

        if (!directRoomSnap.exists()) {
          setStudentError(EXPIRED_CODE_ERROR);
          return;
        }
        resolvedRoomId = normalized;
      }

      const roomRef = doc(db, "rooms", resolvedRoomId);
      let roomSnap;
      try {
        roomSnap = await getDoc(roomRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `rooms/${resolvedRoomId}`);
      }

      if (!roomSnap.exists()) {
        setStudentError(EXPIRED_CODE_ERROR);
        return;
      }

      const roomData = roomSnap.data() as RoomDoc;
      const nowMs = Date.now();
      const matchesActiveCode =
        Boolean(roomData.activeJoinCode) &&
        normalized === roomData.activeJoinCode;
      const withinStrict10sWindow =
        typeof roomData.codeExpiresAt === "number" &&
        roomData.codeExpiresAt > 0 &&
        nowMs <= roomData.codeExpiresAt;

      // Hard block entry unless status === "live", code === activeJoinCode, and Date.now() <= codeExpiresAt
      if (
        roomData.status !== "live" ||
        !matchesActiveCode ||
        !withinStrict10sWindow
      ) {
        setStudentError(EXPIRED_CODE_ERROR);
        return;
      }

      const participantPath = `rooms/${resolvedRoomId}/participants/${user.uid}`;
      const participantRef = doc(
        db,
        "rooms",
        resolvedRoomId,
        "participants",
        user.uid
      );
      try {
        const existingParticipant = await getDoc(participantRef);
        const sameTopicVersion =
          existingParticipant.exists() &&
          existingParticipant.data().topicVersion === (roomData.topicVersion || 0);

        const computedName =
          studentVisibility === "anonymous"
            ? null
            : resolveStudentDisplayName(user);

        await setDoc(participantRef, {
          status: sameTopicVersion
            ? (existingParticipant.data().status as "clear" | "confused") || "clear"
            : "clear",
          reasons: sameTopicVersion
            ? existingParticipant.data().reasons || []
            : [],
          topic: roomData.currentTopic || "",
          topicVersion: roomData.topicVersion || 0,
          joinedAtMs: existingParticipant.exists()
            ? existingParticipant.data().joinedAtMs || nowMs
            : nowMs,
          updatedAtMs: nowMs,
          visibility: studentVisibility,
          displayName: computedName,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, participantPath);
      }

      // Record privately in student's attendedClasses & attendedRooms enrollment records
      try {
        const attendedRef = doc(
          db,
          "users",
          user.uid,
          "attendedClasses",
          resolvedRoomId
        );
        const attendedRoomRef = doc(
          db,
          "users",
          user.uid,
          "attendedRooms",
          resolvedRoomId
        );
        const existingAttended = await getDoc(attendedRef);
        const existingData = existingAttended.exists()
          ? (existingAttended.data() as AttendedClassEntry)
          : null;
        const entryPayload: AttendedClassEntry = {
          roomCode: resolvedRoomId,
          title: roomData.title,
          status: roomData.status,
          joinedAtMs: existingData?.joinedAtMs ?? nowMs,
          pollAnswers: existingData?.pollAnswers ?? {},
        };
        await Promise.allSettled([
          setDoc(attendedRef, entryPayload, { merge: true }),
          setDoc(attendedRoomRef, entryPayload, { merge: true }),
        ]);
      } catch {
        // Non-blocking private history write
      }

      onEnterStudent(resolvedRoomId);
    } finally {
      setJoiningRoom(false);
    }
  };

  const handleJoinLecture = async (e: React.FormEvent) => {
    e.preventDefault();
    await joinLectureByCode(joinInput);
  };

  const handleOpenAttendedClass = async (entry: AttendedClassEntry) => {
    try {
      const snap = await getDoc(doc(db, "rooms", entry.roomCode));
      if (snap.exists() && (snap.data() as RoomDoc).status === "live") {
        onEnterStudent(entry.roomCode);
        return;
      }
      if (entry.status !== "ended") {
        await setDoc(
          doc(db, "users", user.uid, "attendedClasses", entry.roomCode),
          { status: "ended" },
          { merge: true }
        );
      }
    } catch {
      // Fallback to opening summary report
    }
    onOpenSummary(entry.roomCode, "student");
  };

  const handleCopyCreatedCode = async () => {
    const codeToCopy = createdJoinCode || createdRoomCode;
    if (!codeToCopy) return;
    try {
      await navigator.clipboard.writeText(formatRoomCode(codeToCopy));
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-3 sm:px-6 py-6 sm:py-10 space-y-8">
      {/* Header */}
      <div className="space-y-2 max-w-2xl">
        <div className="text-xs font-medium text-sky-400">
          Verified &amp; Anonymous Classroom Entry
        </div>
        <h1 className="font-display text-2xl sm:text-4xl font-bold text-slate-100 tracking-tight text-balance">
          Choose how you are joining today
        </h1>
        <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
          Host a lecture to generate a room code and QR invite, join live as a
          student, or review saved post-class analytics reports anytime.
        </p>
      </div>

      {/* 2-Column Role Selector */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Teacher Section Card */}
        <section className="pp-card backdrop-blur-xl border rounded-2xl p-5 sm:p-8 flex flex-col justify-between space-y-6 transition-colors">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
                <Presentation className="w-5 h-5 text-sky-400" />
              </div>
              <span className="text-xs font-medium text-slate-400">
                Teacher Section
              </span>
            </div>

            <div>
              <h2 className="font-display text-xl font-bold text-slate-100">
                Host a Lecture
              </h2>
              <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                Generate a 6-character Room Code and scannable QR Code for
                instant student onboarding, then broadcast topics live.
              </p>
            </div>
          </div>

          {createdRoomCode ? (
            <div className="space-y-5 pt-2">
              <div className="p-4 sm:p-5 rounded-2xl pp-input border pp-accent-border flex flex-col sm:flex-row items-center justify-between gap-5">
                <div className="space-y-3 text-center sm:text-left">
                  <div>
                    <div className="text-xs text-sky-400 font-medium flex items-center justify-center sm:justify-start gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Rotating Join Code ({secondsLeft}s)</span>
                    </div>
                    <div className="font-mono text-2xl sm:text-3xl font-bold tracking-wider text-slate-100 mt-1 tabular-nums">
                      {formatRoomCode(createdJoinCode || createdRoomCode)}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      Session ID: <span className="font-mono">{formatRoomCode(createdRoomCode)}</span> · Anti-proxy 10s rotation
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyCreatedCode}
                    className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied Code</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Join Code</span>
                      </>
                    )}
                  </button>
                </div>

                <QrCodeBox
                  roomCode={createdJoinCode || createdRoomCode}
                  queryParam="code"
                  secondsRemaining={secondsLeft}
                  size={136}
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => {
                    openingTeacherRef.current = true;
                    onEnterTeacher(createdRoomCode);
                  }}
                  className="flex-1 min-h-[48px] px-5 py-3 rounded-xl pp-primary-btn text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <span>Open Teacher Dashboard</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openingTeacherRef.current = false;
                    setCreatedRoomCode(null);
                    setCreatedJoinCode(null);
                  }}
                  className="min-h-[48px] px-4 py-3 rounded-xl border border-slate-700 bg-slate-800/70 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors"
                >
                  New Room
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleHostLecture} className="space-y-4">
              {teacherError && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{teacherError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="lecture-title"
                  className="block text-xs font-medium text-slate-300"
                >
                  Lecture Title
                </label>
                <input
                  id="lecture-title"
                  type="text"
                  value={lectureTitle}
                  onChange={(e) => setLectureTitle(e.target.value)}
                  placeholder="e.g., CS 201: Pointers & Dynamic Memory"
                  maxLength={140}
                  className="w-full min-h-[48px] px-3.5 py-2.5 rounded-xl pp-input border focus:border-sky-500 focus:outline-none text-sm text-slate-100 placeholder:text-slate-600"
                />
              </div>

              <div className="p-3.5 rounded-xl pp-input border text-xs text-slate-400 leading-relaxed">
                Students wait in standby until you broadcast your first topic from
                the Teacher Dashboard.
              </div>

              <button
                type="submit"
                disabled={creatingRoom}
                className="w-full min-h-[48px] px-5 py-3 rounded-xl pp-primary-btn disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <QrCode className="w-4 h-4" />
                <span>
                  {creatingRoom
                    ? "Generating Room & QR..."
                    : "Host a Lecture & Generate QR"}
                </span>
              </button>
            </form>
          )}
        </section>

        {/* Student Section Card */}
        <section className="pp-card backdrop-blur-xl border rounded-2xl p-5 sm:p-8 flex flex-col justify-between space-y-6 transition-colors">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5 text-emerald-400" />
              </div>
              <span className="text-xs font-medium text-slate-400">
                Student Section
              </span>
            </div>

            <div>
              <h2 className="font-display text-xl font-bold text-slate-100">
                Join a Lecture
              </h2>
              <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                Enter the 6-character Room Code from your instructor&apos;s screen
                or scan their QR code to auto-fill and join anonymously.
              </p>
            </div>
          </div>

          <form onSubmit={handleJoinLecture} className="space-y-4">
            {(studentError || accessNotice) && (
              <div
                role="alert"
                className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/20 border border-rose-500/70 text-rose-100 text-xs sm:text-sm font-semibold shadow-sm"
              >
                <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                <span>{studentError || accessNotice}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="room-code-input"
                className="block text-xs font-medium text-slate-300"
              >
                6-Character Room Code or Live QR
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  id="room-code-input"
                  type="text"
                  value={joinInput}
                  onChange={(e) => {
                    const clean = normalizeRoomCode(e.target.value);
                    setJoinInput(
                      clean.length > 2
                        ? `${clean.slice(0, 2)}-${clean.slice(2)}`
                        : clean
                    );
                  }}
                  placeholder="CS-8492"
                  maxLength={7}
                  className="flex-1 min-h-[52px] px-4 py-3 rounded-xl pp-input border focus:border-emerald-500 focus:outline-none font-mono text-xl tracking-widest text-center text-slate-100 placeholder:text-slate-600 uppercase"
                />
                <button
                  type="button"
                  onClick={() => {
                    setStudentError(null);
                    setScannerOpen(true);
                  }}
                  className="min-h-[52px] px-4 py-2.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/50 text-sky-200 text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
                >
                  <Camera className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>📷 Scan QR Code</span>
                </button>
              </div>
            </div>

            <div className="space-y-2 p-3.5 rounded-xl pp-input border">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-200 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Identity Privacy Mode</span>
                </span>
                <span className="text-[11px] text-slate-400">
                  Change anytime inside class
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: "anonymous", label: "🔒 Anonymous" },
                    { id: "teacher", label: "👨‍🏫 Teacher Only" },
                    { id: "public", label: "🌐 Show to All" },
                  ] as const
                ).map((opt) => {
                  const active = studentVisibility === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setStudentVisibility(opt.id);
                        saveStudentVisibility(opt.id);
                      }}
                      className={`min-h-[40px] px-2 py-1.5 rounded-lg border text-[11px] sm:text-xs font-semibold transition-colors ${
                        active
                          ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
                          : "bg-slate-900/70 border-slate-700/80 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {studentVisibility === "anonymous"
                  ? "Nobody sees your name—your pulse signals and doubts stay 100% anonymous."
                  : studentVisibility === "teacher"
                  ? `Only your instructor sees "${resolveStudentDisplayName(
                      user
                    )}" next to your status & doubts; classmates see "Anonymous Student".`
                  : `"${resolveStudentDisplayName(
                      user
                    )}" is visible to both your instructor and classmates on the Doubt Wall.`}
              </p>
            </div>

            <button
              type="submit"
              disabled={joiningRoom}
              className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <span>{joiningRoom ? "Joining Session..." : "Join a Lecture"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </section>
      </div>

      {/* Persistent Class History: Classes Conducted (Teacher) & Classes Attended (Student) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Classes Conducted (Teacher History) */}
        <section className="space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-sky-400 shrink-0" />
              <h2 className="font-display text-lg font-semibold text-slate-100">
                Classes Conducted
              </h2>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">
              {mergedConducted.length} total
            </span>
          </div>

          {loadingTeacherHistory ? (
            <div className="pp-card border rounded-2xl p-6 text-sm text-slate-400">
              Loading conducted classes...
            </div>
          ) : mergedConducted.length === 0 ? (
            <div className="pp-card border rounded-2xl p-6 text-sm text-slate-400">
              No hosted lectures yet. Host a lecture above to create a room and
              build your report archive.
            </div>
          ) : (
            <div className="pp-card backdrop-blur-xl border rounded-2xl divide-y divide-slate-800/80 overflow-hidden">
              {mergedConducted.slice(0, 10).map((item) => (
                <div
                  key={item.roomCode}
                  className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/25 transition-colors"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                      <span className="font-mono text-sky-400 shrink-0">
                        {formatRoomCode(item.roomCode)}
                      </span>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      <span className="truncate">{item.title}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 tabular-nums">
                      <span>{formatDateLabel(item.createdAtMs)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {item.studentCount}{" "}
                        {item.studentCount === 1 ? "student" : "students"}
                      </span>
                      {item.overallComprehensionPct !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-400 font-medium">
                            {item.overallComprehensionPct}% understood
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setHistoryDrawer({
                          roomCode: item.roomCode,
                          title: item.title,
                          isTeacher: true,
                        })
                      }
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl pp-input hover:bg-slate-800 border text-slate-200 text-xs font-medium transition-colors whitespace-nowrap"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                      <span>Doubts &amp; Notes</span>
                    </button>
                    {item.status === "live" ? (
                      <button
                        type="button"
                        onClick={() => onEnterTeacher(item.roomCode)}
                        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl pp-primary-btn text-white text-xs font-semibold transition-colors whitespace-nowrap"
                      >
                        <Radio className="w-3.5 h-3.5" />
                        <span>Resume Live</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenSummary(item.roomCode, "teacher")}
                        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold transition-colors whitespace-nowrap"
                      >
                        <FileBarChart2 className="w-3.5 h-3.5" />
                        <span>Open Report</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Classes Attended (Student History) */}
        <section className="space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-emerald-400 shrink-0" />
              <h2 className="font-display text-lg font-semibold text-slate-100">
                Classes Attended
              </h2>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">
              {attendedHistory.length} total
            </span>
          </div>

          {loadingStudentHistory ? (
            <div className="pp-card border rounded-2xl p-6 text-sm text-slate-400">
              Loading attended lectures...
            </div>
          ) : attendedHistory.length === 0 ? (
            <div className="pp-card border rounded-2xl p-6 text-sm text-slate-400">
              Lectures you join as a student appear here privately so you can
              revisit topics, download notes, and ask post-class doubts.
            </div>
          ) : (
            <div className="pp-card backdrop-blur-xl border rounded-2xl divide-y divide-slate-800/80 overflow-hidden">
              {attendedHistory.slice(0, 10).map((item) => (
                <div
                  key={item.roomCode}
                  className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/25 transition-colors"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                      <span className="font-mono text-emerald-400 shrink-0">
                        {formatRoomCode(item.roomCode)}
                      </span>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      <span className="truncate">{item.title}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 tabular-nums">
                      <span>Joined {formatDateLabel(item.joinedAtMs)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {Object.keys(item.pollAnswers || {}).length} polls answered
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setHistoryDrawer({
                          roomCode: item.roomCode,
                          title: item.title,
                          isTeacher: false,
                        })
                      }
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl pp-input hover:bg-slate-800 border text-slate-200 text-xs font-medium transition-colors whitespace-nowrap"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Notes &amp; Doubts</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenAttendedClass(item)}
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold transition-colors whitespace-nowrap"
                    >
                      <FileBarChart2 className="w-3.5 h-3.5" />
                      <span>Open Revision Report</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Quick Post-Class Notes & Anonymous Doubt Drawer */}
      {historyDrawer && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
          <div className="max-w-3xl w-full max-h-[88vh] pp-card-strong border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-sky-400 font-semibold">
                  {historyDrawer.isTeacher
                    ? "Instructor Resources & Post-Class Doubts"
                    : "Student Notes & Post-Class Doubt Portal"}
                </div>
                <h2 className="font-display text-lg font-bold text-slate-100 truncate">
                  {historyDrawer.title} ({formatRoomCode(historyDrawer.roomCode)})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setHistoryDrawer(null)}
                aria-label="Close resources drawer"
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
              <LectureNotesPanel
                roomCode={historyDrawer.roomCode}
                user={user}
                canUpload={historyDrawer.isTeacher}
                compact
              />
              <PostClassDoubtPortal
                roomCode={historyDrawer.roomCode}
                user={user}
                isTeacher={historyDrawer.isTeacher}
              />
            </div>
          </div>
        </div>
      )}

      {/* Built-in Webcam QR Scanner Modal */}
      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onCodeDetected={(code) => {
          setScannerOpen(false);
          setJoinInput(formatRoomCode(code));
          void joinLectureByCode(code);
        }}
      />
    </main>
  );
}
