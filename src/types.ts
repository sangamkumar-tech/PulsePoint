export type ThemeMode = "slate" | "black";

export type StudentVisibility = "anonymous" | "teacher" | "public";

export type PulseStatus = "clear" | "confused";

export type ConfusionReason =
  | "Need Example"
  | "Too Fast"
  | "Missed a Step"
  | "Audio/Board Issue";

export const CONFUSION_REASONS: ConfusionReason[] = [
  "Need Example",
  "Too Fast",
  "Missed a Step",
  "Audio/Board Issue",
];

export type AppView = "lobby" | "teacher" | "student" | "summary";

export interface JoinCodeDoc {
  code: string;
  roomId: string;
  hostUid: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface ValidJoinCodeEntry {
  code: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface SubheadingEntry {
  mainTopic: string;
  subheading: string;
  topicVersion: number;
  updatedAtMs: number;
  timeLabel: string;
}

export type ConceptualCategory =
  | "Meaning / Definition"
  | "Formula / Principle"
  | "Practical Uses & Applications"
  | "Conceptual Edge Cases";

export interface ConceptualMcqItem {
  id: string;
  category: ConceptualCategory;
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
}

export interface QuizBatchDoc {
  id: string;
  mode: "mcq_set" | "written";
  mainTopic: string;
  subheading?: string;
  topic?: string;
  batchVersion: number;
  isOpen: boolean;
  questions?: ConceptualMcqItem[];
  writtenPrompt?: string | null;
  createdAtMs: number;
  createdBy: string;
}

export interface QuizResponseDoc {
  uid: string;
  mode: "mcq_set" | "written";
  batchVersion: number;
  questionIds?: string[];
  answers?: number[];
  score?: number;
  totalQuestions?: number;
  writtenAnswer?: string | null;
  submittedAtMs: number;
  visibility?: StudentVisibility;
  displayName?: string | null;
}

export interface LectureNoteDoc {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  mimeType?: string;
  sizeBytes: number;
  downloadUrl: string;
  storagePath?: string | null;
  uploadedByUid: string;
  createdAtMs: number;
}

export interface PostClassDoubtDoc {
  id: string;
  text: string;
  topicTag?: string | null;
  upvoterUids: string[];
  resolved: boolean;
  teacherReply?: string | null;
  repliedAtMs?: number | null;
  createdAtMs: number;
  visibility?: StudentVisibility;
  displayName?: string | null;
}

export interface TimelinePoint {
  id: string;
  timestampMs: number;
  minuteBucketMs?: number;
  timeLabel: string;
  topic: string;
  mainTopic?: string;
  subheading?: string;
  topicVersion: number;
  confusionPct: number;
  understandingPct: number;
  confusedCount: number;
  clearCount: number;
  totalParticipants: number;
  isSpike: boolean;
  topReason?: ConfusionReason | null;
  voiceContext?: string | null;
}

export interface ConfusionSpike {
  id: string;
  timestampMs: number;
  timeLabel: string;
  topic: string;
  subheading?: string;
  topicVersion: number;
  confusionPct: number;
  confusedCount: number;
  totalParticipants: number;
  topReason?: ConfusionReason | null;
  voiceContext?: string | null;
}

export interface RecheckState {
  id: string;
  topic: string;
  topicVersion: number;
  baselineConfusionPct: number;
  triggeredAtMs: number;
  status: "active" | "completed";
  resolvedAtMs?: number | null;
  finalConfusionPct?: number | null;
  clearedUids: string[];
  stillStuckUids: string[];
}

export interface RecheckRecord {
  id: string;
  topic: string;
  topicVersion: number;
  triggeredAtMs: number;
  baselineConfusionPct: number;
  afterConfusionPct: number;
  dropPts: number;
  clearedCount: number;
  stillStuckCount: number;
}

export interface DoubtDoc {
  id: string;
  text: string;
  topic: string;
  topicVersion: number;
  upvoterUids: string[];
  resolved: boolean;
  createdAtMs: number;
  visibility?: StudentVisibility;
  displayName?: string | null;
}

export interface ArchivedTopicRecord {
  topic: string;
  mainTopic?: string;
  subheadingHistory?: string[];
  topicVersion: number;
  startedAtMs: number;
  endedAtMs: number;
  points: TimelinePoint[];
  peakConfusionPct: number;
  avgConfusionPct: number;
  spikes: ConfusionSpike[];
  reasonCounts: Record<ConfusionReason, number>;
  topReason: ConfusionReason | null;
}

export interface PollSummary {
  pollId: string;
  question: string;
  topic: string;
  options: string[];
  correctOptionIndex: number | null;
  counts: number[];
  totalVotes: number;
  accuracyPct: number | null;
  createdAtMs: number;
  closedAtMs?: number | null;
}

export type RevisitLabel =
  | "Must Revisit"
  | "Quick Recap Needed"
  | "Well Understood";

export interface TopicSummary {
  topic: string;
  mainTopic?: string;
  subheadings?: string[];
  topicVersion: number;
  peakConfusionPct: number;
  avgConfusionPct: number;
  samples: number;
  spikeCount: number;
  spikeTimestamps: string[];
  topReason: ConfusionReason | null;
  reasonCounts: Record<ConfusionReason, number>;
  label: RevisitLabel;
}

export interface SessionSummary {
  overallComprehensionPct: number;
  overallConfusionPct: number;
  totalParticipants: number;
  totalTopics: number;
  totalPolls: number;
  durationSeconds: number;
  topicsRanked: TopicSummary[];
  spikes: ConfusionSpike[];
  polls: PollSummary[];
  allTimelinePoints: TimelinePoint[];
  recheckHistory?: RecheckRecord[];
  topDoubts?: DoubtDoc[];
  subheadingLog?: SubheadingEntry[];
  generatedAtMs: number;
}

export interface ReportDoc {
  roomCode: string;
  title: string;
  hostUid: string;
  createdAtMs: number;
  endedAtMs: number;
  topicHistory: ArchivedTopicRecord[];
  spikeLog: ConfusionSpike[];
  pollHistory: PollSummary[];
  summary: SessionSummary;
}

export interface ConductedClassEntry {
  roomCode: string;
  title: string;
  status: "live" | "ended";
  createdAtMs: number;
  endedAtMs?: number | null;
  studentCount: number;
  overallComprehensionPct: number | null;
  totalTopics?: number;
  totalSpikes?: number;
}

export interface AttendedClassEntry {
  roomCode: string;
  title: string;
  status: "live" | "ended";
  joinedAtMs: number;
  pollAnswers?: Record<string, number>;
}

export interface RoomDoc {
  roomCode: string;
  title: string;
  hostUid: string;
  status: "live" | "ended";
  currentTopic: string;
  currentMainTopic?: string;
  currentSubheading?: string;
  subheadingHistory?: SubheadingEntry[];
  topicVersion: number;
  topicStartedAtMs: number | null;
  topicHistory: ArchivedTopicRecord[];
  activeJoinCode?: string | null;
  codeExpiresAt?: number | null;
  previousJoinCode?: string | null;
  joinCodeUpdatedAtMs?: number | null;
  validJoinCodes?: ValidJoinCodeEntry[];
  activePollId: string | null;
  lastPollId?: string | null;
  pollHistory: PollSummary[];
  activeQuizId?: string | null;
  lastQuizId?: string | null;
  activeRecheck?: RecheckState | null;
  recheckHistory?: RecheckRecord[];
  createdAtMs: number;
  endedAtMs: number | null;
  summary?: SessionSummary | null;
}

export interface ParticipantDoc {
  uid: string;
  status: PulseStatus;
  reasons: ConfusionReason[];
  topic: string;
  topicVersion: number;
  updatedAtMs: number;
  joinedAtMs: number;
  visibility?: StudentVisibility;
  displayName?: string | null;
}

export interface PollDoc {
  id: string;
  question: string;
  options: string[];
  correctOptionIndex: number | null;
  topic: string;
  topicVersion: number;
  isOpen: boolean;
  finalCounts?: number[] | null;
  finalTotalVotes?: number | null;
  createdAtMs: number;
  createdBy: string;
}

export interface PollVoteDoc {
  uid: string;
  optionIndex: number;
  votedAtMs: number;
}

export interface RescuePollDraft {
  question: string;
  options: [string, string, string];
  correctOptionIndex: number;
  rationale: string;
}

export interface RevisionPracticeQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface TopicRevisionPack {
  topic: string;
  peakConfusionPct: number;
  topReason: ConfusionReason | null;
  bullets: [string, string, string];
  practiceQuestions: [RevisionPracticeQuestion, RevisionPracticeQuestion];
}
