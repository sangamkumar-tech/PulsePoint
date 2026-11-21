import {
  ArchivedTopicRecord,
  CONFUSION_REASONS,
  ConfusionReason,
  ConfusionSpike,
  DoubtDoc,
  ParticipantDoc,
  PollDoc,
  PollSummary,
  PollVoteDoc,
  RecheckRecord,
  RevisitLabel,
  RoomDoc,
  SessionSummary,
  StudentVisibility,
  TimelinePoint,
  TopicSummary,
} from "../types";

export const STUDENT_VISIBILITY_KEY = "pulsepoint_student_visibility";

export function getStoredStudentVisibility(): StudentVisibility {
  if (typeof window === "undefined") return "anonymous";
  const saved = window.localStorage.getItem(STUDENT_VISIBILITY_KEY);
  if (saved === "teacher" || saved === "public" || saved === "anonymous") {
    return saved;
  }
  return "anonymous";
}

export function saveStudentVisibility(visibility: StudentVisibility): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STUDENT_VISIBILITY_KEY, visibility);
}

export function resolveStudentDisplayName(user: {
  displayName?: string | null;
  email?: string | null;
}): string {
  const cleanName = user.displayName?.trim();
  if (cleanName) return cleanName.slice(0, 80);
  if (user.email && user.email.includes("@")) {
    return user.email.split("@")[0].slice(0, 80);
  }
  return "Verified Student";
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";

export function generateRoomCode(exclude: string[] = []): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = "";
    for (let i = 0; i < 2; i++) {
      code += LETTERS.charAt(Math.floor(Math.random() * LETTERS.length));
    }
    for (let i = 0; i < 4; i++) {
      code += DIGITS.charAt(Math.floor(Math.random() * DIGITS.length));
    }
    if (!exclude.includes(code)) {
      return code;
    }
  }
  return `${LETTERS.charAt(0)}${LETTERS.charAt(1)}${Date.now().toString().slice(-4)}`;
}

export function normalizeRoomCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
}

export function formatRoomCode(code: string): string {
  const clean = normalizeRoomCode(code);
  if (clean.length === 6) {
    return `${clean.slice(0, 2)}-${clean.slice(2)}`;
  }
  return clean;
}

export function getMinuteBucketMs(ms: number): number {
  return Math.floor(ms / 60000) * 60000;
}

/**
 * Clean 1-minute interval X-axis timestamp format (e.g., "10:01", "10:02", "10:03").
 */
export function formatMinuteLabel(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatTimeLabel(ms: number): string {
  return formatMinuteLabel(ms);
}

export function buildTimelineDocId(
  minuteBucketMs: number,
  topicVersion: number
): string {
  return `m_${minuteBucketMs}_v${topicVersion}`;
}

export function formatDateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export interface PaceAssessment {
  score: number;
  status: "Optimal Pace" | "Slow Down / Give Example" | "Stop & Recap";
  tone: "emerald" | "amber" | "rose";
  summary: string;
}

export function computePaceAssessment(
  confusionPct: number,
  totalParticipants: number,
  confusedCount: number,
  reasonCounts: Record<ConfusionReason, number>
): PaceAssessment {
  if (totalParticipants === 0) {
    return {
      score: 12,
      status: "Optimal Pace",
      tone: "emerald",
      summary: "Waiting for student telemetry",
    };
  }

  const tooFast = reasonCounts["Too Fast"] || 0;
  const needExample = reasonCounts["Need Example"] || 0;
  const missedStep = reasonCounts["Missed a Step"] || 0;
  const audioBoard = reasonCounts["Audio/Board Issue"] || 0;

  const paceWeightedCount =
    tooFast * 1.8 + needExample * 1.3 + missedStep * 1.5 + audioBoard * 0.9;
  const reasonPressure =
    totalParticipants > 0
      ? Math.min(100, Math.round((paceWeightedCount / totalParticipants) * 140))
      : 0;

  const score = Math.min(
    100,
    Math.max(0, Math.round(confusionPct * 0.72 + reasonPressure * 0.45))
  );

  const parts: string[] = [];
  if (tooFast > 0) parts.push(`${tooFast} Too Fast`);
  if (needExample > 0) parts.push(`${needExample} Need Example`);
  if (missedStep > 0) parts.push(`${missedStep} Missed a Step`);
  if (audioBoard > 0) parts.push(`${audioBoard} Audio/Board`);

  const summary =
    parts.length > 0
      ? parts.join(" · ")
      : confusedCount > 0
      ? `${confusedCount} students signaling confusion`
      : "Class following smoothly";

  if (confusionPct > 30 || score >= 62) {
    return {
      score: Math.max(score, 66),
      status: "Stop & Recap",
      tone: "rose",
      summary,
    };
  }

  if (confusionPct >= 15 || score >= 34 || needExample + tooFast >= 5) {
    return {
      score: Math.min(64, Math.max(score, 36)),
      status: "Slow Down / Give Example",
      tone: "amber",
      summary,
    };
  }

  return {
    score: Math.min(32, Math.max(8, score)),
    status: "Optimal Pace",
    tone: "emerald",
    summary,
  };
}

/**
 * Recursively strips undefined properties from plain objects/arrays
 * so Firestore setDoc/updateDoc calls never reject on unsupported undefined fields.
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

export function emptyReasonCounts(): Record<ConfusionReason, number> {
  return {
    "Need Example": 0,
    "Too Fast": 0,
    "Missed a Step": 0,
    "Audio/Board Issue": 0,
  };
}

export function computeReasonCounts(
  participants: ParticipantDoc[],
  topicVersion?: number
): Record<ConfusionReason, number> {
  const counts = emptyReasonCounts();
  for (const p of participants) {
    if (topicVersion !== undefined && p.topicVersion !== topicVersion) continue;
    if (p.status !== "confused") continue;
    for (const r of p.reasons || []) {
      if (r in counts) {
        counts[r] += 1;
      }
    }
  }
  return counts;
}

export function getTopReason(
  counts: Record<ConfusionReason, number>
): ConfusionReason | null {
  let best: ConfusionReason | null = null;
  let bestCount = 0;
  for (const r of CONFUSION_REASONS) {
    if (counts[r] > bestCount) {
      bestCount = counts[r];
      best = r;
    }
  }
  return best;
}

export function mergeReasonCounts(
  a: Record<ConfusionReason, number>,
  b: Record<ConfusionReason, number>
): Record<ConfusionReason, number> {
  const out = emptyReasonCounts();
  for (const r of CONFUSION_REASONS) {
    out[r] = (a[r] || 0) + (b[r] || 0);
  }
  return out;
}

export function classifyRevisitLabel(peakConfusionPct: number): RevisitLabel {
  if (peakConfusionPct > 30) return "Must Revisit";
  if (peakConfusionPct >= 15) return "Quick Recap Needed";
  return "Well Understood";
}

export function buildArchivedTopicRecord(
  topic: string,
  topicVersion: number,
  startedAtMs: number,
  endedAtMs: number,
  topicPoints: TimelinePoint[],
  reasonCounts: Record<ConfusionReason, number>,
  subheadings: string[] = []
): ArchivedTopicRecord {
  const peakConfusionPct =
    topicPoints.length > 0
      ? Math.max(...topicPoints.map((p) => p.confusionPct))
      : 0;
  const avgConfusionPct =
    topicPoints.length > 0
      ? Math.round(
          topicPoints.reduce((acc, p) => acc + p.confusionPct, 0) /
            topicPoints.length
        )
      : 0;

  const spikes: ConfusionSpike[] = topicPoints
    .filter((pt) => pt.isSpike || pt.confusionPct > 30)
    .map((pt) => ({
      id: pt.id,
      timestampMs: pt.timestampMs,
      timeLabel: pt.timeLabel,
      topic: pt.topic,
      subheading: pt.subheading,
      topicVersion: pt.topicVersion,
      confusionPct: pt.confusionPct,
      confusedCount: pt.confusedCount,
      totalParticipants: pt.totalParticipants,
      topReason: pt.topReason ?? null,
    }));

  const uniqueSubs = Array.from(
    new Set(
      [
        ...subheadings,
        ...topicPoints.map((p) => p.subheading || "").filter(Boolean),
      ].filter(Boolean)
    )
  );

  return {
    topic,
    mainTopic: topic,
    subheadingHistory: uniqueSubs,
    topicVersion,
    startedAtMs,
    endedAtMs,
    points: topicPoints,
    peakConfusionPct,
    avgConfusionPct,
    spikes,
    reasonCounts,
    topReason: getTopReason(reasonCounts),
  };
}

export function buildPollSummary(
  poll: PollDoc,
  votes: PollVoteDoc[],
  closedAtMs: number | null = null
): PollSummary {
  const counts = poll.options.map((_, idx) =>
    votes.filter((v) => v.optionIndex === idx).length
  );
  const totalVotes = votes.length;
  let accuracyPct: number | null = null;
  if (
    poll.correctOptionIndex !== null &&
    poll.correctOptionIndex >= 0 &&
    poll.correctOptionIndex < poll.options.length &&
    totalVotes > 0
  ) {
    accuracyPct = Math.round((counts[poll.correctOptionIndex] / totalVotes) * 100);
  }
  return {
    pollId: poll.id,
    question: poll.question,
    topic: poll.topic,
    options: poll.options,
    correctOptionIndex: poll.correctOptionIndex,
    counts,
    totalVotes,
    accuracyPct,
    createdAtMs: poll.createdAtMs,
    closedAtMs,
  };
}

export function computeSessionSummary(
  room: RoomDoc,
  allParticipants: ParticipantDoc[],
  allTimelinePoints: TimelinePoint[],
  polls: PollDoc[],
  votesByPollId: Record<string, PollVoteDoc[]>,
  endedAtMs: number,
  finalTopicRecords: ArchivedTopicRecord[],
  archivedPollHistory: PollSummary[] = [],
  recheckHistory: RecheckRecord[] = [],
  topDoubts: DoubtDoc[] = []
): SessionSummary {
  const totalParticipants = allParticipants.length;

  let overallConfusionPct = 0;
  if (allTimelinePoints.length > 0) {
    const sum = allTimelinePoints.reduce((acc, pt) => acc + pt.confusionPct, 0);
    overallConfusionPct = Math.round(sum / allTimelinePoints.length);
  }
  const overallComprehensionPct = Math.max(
    0,
    Math.min(100, 100 - overallConfusionPct)
  );

  const topicsRanked: TopicSummary[] = finalTopicRecords
    .map((rec) => ({
      topic: rec.topic,
      mainTopic: rec.mainTopic || rec.topic,
      subheadings: rec.subheadingHistory || [],
      topicVersion: rec.topicVersion,
      peakConfusionPct: rec.peakConfusionPct,
      avgConfusionPct: rec.avgConfusionPct,
      samples: rec.points.length,
      spikeCount: rec.spikes.length,
      spikeTimestamps: rec.spikes.map((s) => s.timeLabel),
      topReason: rec.topReason,
      reasonCounts: rec.reasonCounts,
      label: classifyRevisitLabel(rec.peakConfusionPct),
    }))
    .sort((a, b) => {
      if (b.peakConfusionPct !== a.peakConfusionPct) {
        return b.peakConfusionPct - a.peakConfusionPct;
      }
      return b.avgConfusionPct - a.avgConfusionPct;
    });

  const spikes: ConfusionSpike[] = allTimelinePoints
    .filter((pt) => pt.isSpike || pt.confusionPct > 30)
    .map((pt) => ({
      id: pt.id,
      timestampMs: pt.timestampMs,
      timeLabel: pt.timeLabel,
      topic: pt.topic,
      subheading: pt.subheading,
      topicVersion: pt.topicVersion,
      confusionPct: pt.confusionPct,
      confusedCount: pt.confusedCount,
      totalParticipants: pt.totalParticipants,
      topReason: pt.topReason ?? null,
    }));

  const pollSummaries: PollSummary[] = polls.map((poll) => {
    const archived = archivedPollHistory.find((p) => p.pollId === poll.id);
    const votes = votesByPollId[poll.id] ?? [];
    if (archived && archived.totalVotes >= votes.length) {
      return { ...archived, closedAtMs: archived.closedAtMs ?? endedAtMs };
    }
    return buildPollSummary(poll, votes, endedAtMs);
  });

  for (const arch of archivedPollHistory) {
    if (!pollSummaries.some((p) => p.pollId === arch.pollId)) {
      pollSummaries.push(arch);
    }
  }

  const durationSeconds = Math.max(
    1,
    Math.round((endedAtMs - room.createdAtMs) / 1000)
  );

  return stripUndefined({
    overallComprehensionPct,
    overallConfusionPct,
    totalParticipants,
    totalTopics: finalTopicRecords.length,
    totalPolls: pollSummaries.length,
    durationSeconds,
    topicsRanked,
    spikes,
    polls: pollSummaries,
    allTimelinePoints,
    recheckHistory,
    topDoubts,
    subheadingLog: room.subheadingHistory || [],
    generatedAtMs: endedAtMs,
  });
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically deals each student a unique randomized 5-question set
 * seeded by their uid + quizId + batchVersion to deter shoulder-surfing/cheating.
 */
export function selectUniqueQuestionsForStudent<T>(
  pool: T[],
  uid: string,
  quizId: string,
  batchVersion: number,
  count = 5
): T[] {
  if (pool.length <= count) return [...pool];
  const rand = mulberry32(hashSeed(`${uid}_${quizId}_v${batchVersion}`));
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}
