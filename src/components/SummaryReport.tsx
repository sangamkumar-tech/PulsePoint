import { useEffect, useMemo, useRef, useState } from "react";
import { User } from "firebase/auth";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  MessageSquare,
  Printer,
  RefreshCw,
  XCircle,
} from "lucide-react";
import {
  OperationType,
  collection,
  db,
  doc,
  getDoc,
  getDocs,
  handleFirestoreError,
  orderBy,
  query,
} from "../firebase";
import {
  AttendedClassEntry,
  ParticipantDoc,
  PollDoc,
  PollVoteDoc,
  ReportDoc,
  RoomDoc,
  SessionSummary,
  TimelinePoint,
} from "../types";
import { generateTopicRevisionPack } from "../utils/classroomIntelligence";
import {
  buildArchivedTopicRecord,
  computeReasonCounts,
  computeSessionSummary,
  formatDateLabel,
  formatDuration,
  formatMinuteLabel,
  formatRoomCode,
} from "../utils/roomUtils";
import { ConfusionChart } from "./ConfusionChart";
import { LectureNotesPanel } from "./LectureNotesPanel";
import { PostClassDoubtPortal } from "./PostClassDoubtPortal";
import { TopicBarChart } from "./TopicBarChart";

interface SummaryReportProps {
  roomCode: string;
  user: User;
  mode?: "teacher" | "student";
  preloadedReport?: ReportDoc | null;
  onBackToLobby: () => void;
  onAccessDenied?: (message: string) => void;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function SummaryReport({
  roomCode,
  user,
  mode = "teacher",
  preloadedReport = null,
  onBackToLobby,
  onAccessDenied,
}: SummaryReportProps) {
  const isPreloadedHost = Boolean(
    preloadedReport && preloadedReport.hostUid === user.uid
  );
  const [title, setTitle] = useState<string>(preloadedReport?.title || "");
  const [createdAtMs, setCreatedAtMs] = useState<number>(
    preloadedReport?.createdAtMs || Date.now()
  );
  const [summary, setSummary] = useState<SessionSummary | null>(
    preloadedReport?.summary || null
  );
  const [timelinePoints, setTimelinePoints] = useState<TimelinePoint[]>(
    preloadedReport?.summary?.allTimelinePoints || []
  );
  const [myPollAnswers, setMyPollAnswers] = useState<Record<string, number>>({});
  const [accessVerified, setAccessVerified] = useState(isPreloadedHost);
  const [loading, setLoading] = useState(!isPreloadedHost);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const [revealedQuestions, setRevealedQuestions] = useState<
    Record<string, boolean>
  >({});

  const reportRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const hostOwnsPreloaded = Boolean(
        preloadedReport && preloadedReport.hostUid === user.uid
      );
      let isMember = hostOwnsPreloaded;
      let attendedPollAnswers: Record<string, number> | null = null;

      try {
        const [pRes, aRes, rRes, roomRes] = await Promise.allSettled([
          getDoc(doc(db, "rooms", roomCode, "participants", user.uid)),
          getDoc(doc(db, "users", user.uid, "attendedClasses", roomCode)),
          getDoc(doc(db, "users", user.uid, "attendedRooms", roomCode)),
          getDoc(doc(db, "rooms", roomCode)),
        ]);

        if (cancelled) return;

        if (aRes.status === "fulfilled" && aRes.value.exists()) {
          const data = aRes.value.data() as AttendedClassEntry;
          if (data.pollAnswers) {
            attendedPollAnswers = data.pollAnswers;
          }
          isMember = true;
        }
        if (pRes.status === "fulfilled" && pRes.value.exists()) {
          isMember = true;
        }
        if (rRes.status === "fulfilled" && rRes.value.exists()) {
          isMember = true;
        }
        if (
          roomRes.status === "fulfilled" &&
          roomRes.value.exists() &&
          (roomRes.value.data() as RoomDoc).hostUid === user.uid
        ) {
          isMember = true;
        }

        if (!isMember && !preloadedReport) {
          const reportCheckSnap = await getDoc(doc(db, "reports", roomCode));
          if (cancelled) return;
          if (
            reportCheckSnap.exists() &&
            (reportCheckSnap.data() as ReportDoc).hostUid === user.uid
          ) {
            isMember = true;
          }
        }
      } catch {
        // Verified below via isMember
      }

      if (cancelled) return;

      if (!isMember) {
        setAccessVerified(false);
        setLoading(false);
        onAccessDenied?.(
          "Access restricted — please scan the classroom QR or enter the live join code to unlock this class."
        );
        return;
      }

      setAccessVerified(true);
      if (attendedPollAnswers) {
        setMyPollAnswers(attendedPollAnswers);
      }

      if (preloadedReport) {
        setLoading(false);
        return;
      }

      try {
        const reportSnap = await getDoc(doc(db, "reports", roomCode));
        if (reportSnap.exists()) {
          const rep = reportSnap.data() as ReportDoc;
          if (!cancelled) {
            setTitle(rep.title);
            setCreatedAtMs(rep.createdAtMs);
            setSummary(rep.summary);
            setTimelinePoints(rep.summary.allTimelinePoints || []);
            setLoading(false);
          }
          return;
        }

        const roomSnap = await getDoc(doc(db, "rooms", roomCode));
        if (!roomSnap.exists()) {
          if (!cancelled) {
            setSummary(null);
            setLoading(false);
          }
          return;
        }

        const roomData = roomSnap.data() as RoomDoc;
        const timelineSnap = await getDocs(
          query(
            collection(db, "rooms", roomCode, "timeline"),
            orderBy("timestampMs", "asc")
          )
        );
        const timeline: TimelinePoint[] = timelineSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<TimelinePoint, "id">),
        }));

        let computed = roomData.summary ?? null;
        if (!computed) {
          let participants: ParticipantDoc[] = [];
          try {
            const pSnap = await getDocs(
              collection(db, "rooms", roomCode, "participants")
            );
            participants = pSnap.docs.map((d) => ({
              uid: d.id,
              ...(d.data() as Omit<ParticipantDoc, "uid">),
            }));
          } catch {
            participants = [];
          }

          const pollsSnap = await getDocs(
            query(
              collection(db, "rooms", roomCode, "polls"),
              orderBy("createdAtMs", "asc")
            )
          );
          const polls: PollDoc[] = pollsSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<PollDoc, "id">),
          }));

          const votesByPollId: Record<string, PollVoteDoc[]> = {};
          await Promise.all(
            polls.map(async (p) => {
              try {
                const vSnap = await getDocs(
                  collection(db, "rooms", roomCode, "polls", p.id, "votes")
                );
                votesByPollId[p.id] = vSnap.docs.map((d) => ({
                  uid: d.id,
                  ...(d.data() as Omit<PollVoteDoc, "uid">),
                }));
              } catch {
                votesByPollId[p.id] = [];
              }
            })
          );

          const fallbackRecords =
            roomData.topicHistory && roomData.topicHistory.length > 0
              ? roomData.topicHistory
              : roomData.currentTopic
              ? [
                  buildArchivedTopicRecord(
                    roomData.currentTopic,
                    roomData.topicVersion || 1,
                    roomData.topicStartedAtMs || roomData.createdAtMs,
                    roomData.endedAtMs || Date.now(),
                    timeline,
                    computeReasonCounts(participants, roomData.topicVersion || 1)
                  ),
                ]
              : [];

          computed = computeSessionSummary(
            roomData,
            participants,
            timeline,
            polls,
            votesByPollId,
            roomData.endedAtMs || Date.now(),
            fallbackRecords,
            roomData.pollHistory || [],
            roomData.recheckHistory || []
          );
        }

        if (!cancelled) {
          setTitle(roomData.title);
          setCreatedAtMs(roomData.createdAtMs);
          setTimelinePoints(
            computed.allTimelinePoints && computed.allTimelinePoints.length > 0
              ? computed.allTimelinePoints
              : timeline
          );
          setSummary(computed);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
        }
        handleFirestoreError(err, OperationType.GET, `reports/${roomCode}`);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [roomCode, user.uid, preloadedReport, onAccessDenied]);

  // Personalized Student Revision Packs for spiked (or highest confusion) topics
  const revisionPacks = useMemo(() => {
    if (!summary || summary.topicsRanked.length === 0) return [];
    const spikedTopics = summary.topicsRanked.filter(
      (t) => t.peakConfusionPct > 30 || t.spikeCount > 0
    );
    const targets =
      spikedTopics.length > 0
        ? spikedTopics.slice(0, 3)
        : summary.topicsRanked.slice(0, 2);
    return targets.map((t) => generateTopicRevisionPack(t, summary.spikes));
  }, [summary]);

  // Strict 1-Page Focused A4 PDF Download via html2canvas + jsPDF
  const handleDownloadPdf = async () => {
    if (!summary) return;
    const html2canvasFn = window.html2canvas;
    const JsPdfCtor = window.jspdf?.jsPDF;

    if (typeof html2canvasFn !== "function" || typeof JsPdfCtor !== "function") {
      setPdfNotice(
        "PDF library still loading or offline — opening browser print dialog instead."
      );
      window.print();
      return;
    }

    setExportingPdf(true);
    setPdfNotice(null);

    const hostWrapper = document.createElement("div");
    hostWrapper.setAttribute("data-pp-pdf-host", "true");
    hostWrapper.style.position = "fixed";
    hostWrapper.style.left = "-9999px";
    hostWrapper.style.top = "0";
    hostWrapper.style.width = "780px";
    hostWrapper.style.opacity = "0";
    hostWrapper.style.pointerEvents = "none";

    const container = document.createElement("div");
    container.setAttribute("data-pp-pdf-root", "true");
    container.style.width = "780px";
    container.style.backgroundColor = "#ffffff";
    container.style.color = "#0f172a";
    container.style.fontFamily = "Arial, Helvetica, sans-serif";
    container.style.padding = "16px";
    container.style.boxSizing = "border-box";

    try {
      const canvases = Array.from(
        reportRef.current?.querySelectorAll("canvas") || []
      );
      const chartSnapshots = canvases.map((c) => {
        try {
          return c.toDataURL("image/png", 1.0);
        } catch {
          return "";
        }
      });

      const topicChartImg = chartSnapshots[0] || "";
      const timelineChartImg = chartSnapshots[1] || "";
      const optionLetters = ["A", "B", "C", "D"];
      const lectureTitle = title || `Lecture ${formatRoomCode(roomCode)}`;
      const roleLabel =
        mode === "student"
          ? "Student 1-Page Revision Summary"
          : "Post-Class 1-Page Analytics Report";

      const topSpikes = summary.spikes.slice(0, 3);
      const spikesHtml =
        topSpikes.length > 0
          ? `<div style="border:1px solid #fecdd3;background:#fff1f2;border-radius:8px;padding:7px 10px;margin-bottom:8px;">
              <div style="font-size:10.5px;font-weight:700;color:#9f1239;margin-bottom:3px;">Key Confusion Spikes (&gt;30%) · Showing ${topSpikes.length} of ${summary.spikes.length}</div>
              ${topSpikes
                .map(
                  (sp) => `<div style="font-size:9.5px;color:#0f172a;padding:2.5px 0;border-top:1px solid #ffe4e6;">
                    <strong style="color:#be123c;">${escapeHtml(sp.timeLabel)} · ${escapeHtml(sp.topic)}${sp.subheading ? ` (${escapeHtml(sp.subheading)})` : ""} (${sp.confusionPct}%)</strong>
                    <span style="color:#475569;"> — ${sp.confusedCount}/${sp.totalParticipants} confused${sp.topReason ? ` · ${escapeHtml(sp.topReason)}` : ""}</span>
                  </div>`
                )
                .join("")}
            </div>`
          : "";

      const recheckHtml =
        summary.recheckHistory && summary.recheckHistory.length > 0
          ? `<div style="border:1px solid #bae6fd;background:#f0f9ff;border-radius:8px;padding:6px 10px;margin-bottom:8px;">
              <div style="font-size:10.5px;font-weight:700;color:#0369a1;margin-bottom:2px;">Smart Re-Check Recovery</div>
              ${summary.recheckHistory
                .slice(0, 2)
                .map(
                  (rc) => `<div style="font-size:9.5px;color:#0f172a;">
                    <strong>${escapeHtml(rc.topic)}:</strong> ${rc.baselineConfusionPct}% → ${rc.afterConfusionPct}% (${rc.dropPts > 0 ? `-${rc.dropPts} pts recovery` : "verified"})
                  </div>`
                )
                .join("")}
            </div>`
          : "";

      const topTopics = summary.topicsRanked.slice(0, 6);
      const topicsRowsHtml = topTopics
        .map(
          (t, i) => `<tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:3.5px 5px;font-size:9.5px;color:#64748b;">#${i + 1}</td>
            <td style="padding:3.5px 5px;font-size:9.5px;font-weight:700;color:#0f172a;">
              ${escapeHtml(t.mainTopic || t.topic)}
              ${
                t.subheadings && t.subheadings.length > 0
                  ? `<div style="font-size:8px;font-weight:400;color:#64748b;margin-top:1px;">Subheadings: ${escapeHtml(t.subheadings.slice(0, 3).join(", "))}</div>`
                  : ""
              }
            </td>
            <td style="padding:3.5px 5px;font-size:9.5px;text-align:right;font-weight:700;color:${
              t.peakConfusionPct > 30
                ? "#e11d48"
                : t.peakConfusionPct >= 15
                ? "#d97706"
                : "#059669"
            };">${t.peakConfusionPct}%</td>
            <td style="padding:3.5px 5px;font-size:9.5px;text-align:right;color:#334155;">${t.avgConfusionPct}%</td>
            <td style="padding:3.5px 5px;font-size:9.5px;color:#334155;">${escapeHtml(t.topReason || "—")}</td>
            <td style="padding:3.5px 5px;font-size:9.5px;color:#475569;">${
              t.spikeTimestamps.length > 0
                ? escapeHtml(t.spikeTimestamps.slice(0, 3).join(", "))
                : "None"
            }</td>
            <td style="padding:3.5px 5px;font-size:9.5px;text-align:right;font-weight:700;color:${
              t.label === "Must Revisit"
                ? "#e11d48"
                : t.label === "Quick Recap Needed"
                ? "#d97706"
                : "#059669"
            };">${escapeHtml(t.label)}</td>
          </tr>`
        )
        .join("");

      const allPolls = summary.polls;
      const pollsHtml =
        allPolls.length > 0
          ? `<div style="margin-top:8px;">
              <div style="font-size:10.5px;font-weight:700;color:#0f172a;border-bottom:1px solid #cbd5e1;padding-bottom:3px;margin-bottom:4px;">Micro-Poll Performance Summary (${allPolls.length} ${allPolls.length === 1 ? "poll" : "polls"})</div>
              <table style="width:100%;border-collapse:collapse;">
                <thead>
                  <tr style="border-bottom:1px solid #cbd5e1;text-align:left;font-size:8.5px;color:#475569;">
                    <th style="padding:3px 4px;">Poll Question &amp; Topic</th>
                    <th style="padding:3px 4px;">Correct Answer / Breakdown</th>
                    <th style="padding:3px 4px;text-align:right;">Correctness %</th>
                  </tr>
                </thead>
                <tbody>
                  ${allPolls
                    .map((poll, idx) => {
                      const hasCorrect =
                        poll.correctOptionIndex !== null &&
                        poll.correctOptionIndex >= 0 &&
                        poll.correctOptionIndex < poll.options.length;
                      const correctIdx = hasCorrect
                        ? poll.correctOptionIndex!
                        : -1;
                      const correctCount =
                        hasCorrect && poll.counts
                          ? poll.counts[correctIdx] ?? 0
                          : 0;
                      const computedPct =
                        hasCorrect && poll.totalVotes > 0
                          ? Math.round((correctCount / poll.totalVotes) * 100)
                          : poll.accuracyPct ?? 0;

                      let topIdx = 0;
                      let topVotes = -1;
                      poll.options.forEach((_, oIdx) => {
                        const c = poll.counts?.[oIdx] ?? 0;
                        if (c > topVotes) {
                          topVotes = c;
                          topIdx = oIdx;
                        }
                      });
                      const topPct =
                        poll.totalVotes > 0
                          ? Math.round(
                              (Math.max(0, topVotes) / poll.totalVotes) * 100
                            )
                          : 0;

                      const answerText = hasCorrect
                        ? `${optionLetters[correctIdx] ?? correctIdx + 1}. ${poll.options[correctIdx]}`
                        : poll.totalVotes > 0
                        ? `Unmarked · Top: ${optionLetters[topIdx] ?? topIdx + 1}. ${poll.options[topIdx]} (${Math.max(0, topVotes)}/${poll.totalVotes} · ${topPct}%)`
                        : "Unmarked · No votes cast";

                      const pick = myPollAnswers[poll.pollId];
                      const hasPick = pick !== undefined;
                      const pickBadge =
                        mode === "student" && hasPick && hasCorrect
                          ? pick === correctIdx
                            ? ` · Your Pick: ${optionLetters[pick] ?? pick + 1} (Matched)`
                            : ` · Your Pick: ${optionLetters[pick] ?? pick + 1}`
                          : "";

                      const correctnessCell = hasCorrect
                        ? `${computedPct}% Correct (${correctCount}/${poll.totalVotes} students)`
                        : `${poll.totalVotes} ${poll.totalVotes === 1 ? "vote" : "votes"} (No key)`;

                      const correctnessColor = hasCorrect
                        ? computedPct >= 70
                          ? "#059669"
                          : computedPct >= 45
                          ? "#d97706"
                          : "#e11d48"
                        : "#475569";

                      return `<tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:3.5px 4px;font-size:9.5px;color:#0f172a;vertical-align:top;">
                          <strong>P${idx + 1}: ${escapeHtml(poll.question)}</strong>
                          <div style="font-size:8.5px;color:#64748b;margin-top:1px;">Topic: ${escapeHtml(poll.topic)}</div>
                        </td>
                        <td style="padding:3.5px 4px;font-size:9.5px;color:#334155;vertical-align:top;">
                          ${escapeHtml(answerText)}${
                        pickBadge
                          ? `<span style="color:#0369a1;font-weight:700;">${escapeHtml(pickBadge)}</span>`
                          : ""
                      }
                        </td>
                        <td style="padding:3.5px 4px;font-size:9.5px;text-align:right;white-space:nowrap;font-weight:700;color:${correctnessColor};vertical-align:top;">
                          ${escapeHtml(correctnessCell)}
                        </td>
                      </tr>`;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>`
          : `<div style="margin-top:8px;font-size:9.5px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:5px;">
              <strong>Micro-Poll Performance Summary:</strong> No micro-polls were conducted during this session.
            </div>`;

      const studentRecapHtml =
        mode === "student" && revisionPacks.length > 0
          ? `<div style="margin-top:7px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:8px;padding:7px 10px;">
              <div style="font-size:10px;font-weight:700;color:#0369a1;margin-bottom:3px;">AI Study Focus Points</div>
              ${revisionPacks
                .slice(0, 2)
                .map(
                  (pack) => `<div style="margin-bottom:3px;font-size:9.5px;color:#334155;">
                    <strong style="color:#0f172a;">${escapeHtml(pack.topic)}:</strong> ${escapeHtml(pack.bullets[0])}
                  </div>`
                )
                .join("")}
            </div>`
          : "";

      const chartsRowHtml =
        topicChartImg || timelineChartImg
          ? `<table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px 8px -8px;">
              <tr>
                ${
                  topicChartImg
                    ? `<td style="width:50%;vertical-align:top;">
                        <div style="font-size:10.5px;font-weight:700;color:#0f172a;margin-bottom:3px;">Topic-Wise Confusion</div>
                        <div style="background:#0f172a;border-radius:8px;padding:5px;">
                          <img src="${topicChartImg}" style="width:100%;max-height:135px;object-fit:contain;display:block;" />
                        </div>
                      </td>`
                    : ""
                }
                ${
                  timelineChartImg
                    ? `<td style="width:50%;vertical-align:top;">
                        <div style="font-size:10.5px;font-weight:700;color:#0f172a;margin-bottom:3px;">1-Minute Confusion Timeline</div>
                        <div style="background:#0f172a;border-radius:8px;padding:5px;">
                          <img src="${timelineChartImg}" style="width:100%;max-height:135px;object-fit:contain;display:block;" />
                        </div>
                      </td>`
                    : ""
                }
              </tr>
            </table>`
          : "";

      container.innerHTML = `
        <div style="border:1px solid #cbd5e1;border-radius:10px;padding:9px 14px;background:#f8fafc;margin-bottom:8px;">
          <div style="font-size:10px;font-weight:700;color:#0284c7;letter-spacing:0.02em;margin-bottom:2px;">PulsePoint - The Learning Portal · ${escapeHtml(roleLabel)}</div>
          <h1 style="margin:0;font-size:17px;color:#0f172a;">${escapeHtml(lectureTitle)}</h1>
          <div style="font-size:9.5px;color:#475569;margin-top:2px;">Room ${escapeHtml(formatRoomCode(roomCode))} · ${escapeHtml(formatDateLabel(createdAtMs))} (${escapeHtml(formatMinuteLabel(createdAtMs))}) · Duration ${escapeHtml(formatDuration(summary.durationSeconds))}</div>
        </div>

        <table style="width:100%;border-collapse:separate;border-spacing:6px 0;margin:0 -6px 8px -6px;">
          <tr>
            <td style="width:25%;border:1px solid #cbd5e1;border-radius:8px;padding:6px 9px;background:#ffffff;">
              <div style="font-size:9px;color:#64748b;">Unique Students</div>
              <div style="font-size:16px;font-weight:700;color:#0f172a;margin-top:1px;">${summary.totalParticipants}</div>
            </td>
            <td style="width:25%;border:1px solid #cbd5e1;border-radius:8px;padding:6px 9px;background:#ffffff;">
              <div style="font-size:9px;color:#64748b;">Comprehension</div>
              <div style="font-size:16px;font-weight:700;color:#059669;margin-top:1px;">${summary.overallComprehensionPct}%</div>
            </td>
            <td style="width:25%;border:1px solid #cbd5e1;border-radius:8px;padding:6px 9px;background:#ffffff;">
              <div style="font-size:9px;color:#64748b;">Topics Covered</div>
              <div style="font-size:16px;font-weight:700;color:#0284c7;margin-top:1px;">${summary.totalTopics}</div>
            </td>
            <td style="width:25%;border:1px solid #cbd5e1;border-radius:8px;padding:6px 9px;background:#ffffff;">
              <div style="font-size:9px;color:#64748b;">Spikes (&gt;30%)</div>
              <div style="font-size:16px;font-weight:700;color:#e11d48;margin-top:1px;">${summary.spikes.length}</div>
            </td>
          </tr>
        </table>

        ${chartsRowHtml}
        ${spikesHtml}
        ${recheckHtml}

        <div style="margin-top:2px;">
          <div style="font-size:10.5px;font-weight:700;color:#0f172a;border-bottom:1px solid #cbd5e1;padding-bottom:3px;margin-bottom:4px;">Topics to Revisit Action Table</div>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid #cbd5e1;text-align:left;font-size:8.5px;color:#475569;">
                <th style="padding:3.5px 5px;">Rank</th>
                <th style="padding:3.5px 5px;">Topic</th>
                <th style="padding:3.5px 5px;text-align:right;">Peak %</th>
                <th style="padding:3.5px 5px;text-align:right;">Avg %</th>
                <th style="padding:3.5px 5px;">Top Reason</th>
                <th style="padding:3.5px 5px;">Spike Times</th>
                <th style="padding:3.5px 5px;text-align:right;">Action</th>
              </tr>
            </thead>
            <tbody>${
              topicsRowsHtml ||
              `<tr><td colspan="7" style="padding:6px;font-size:9.5px;color:#64748b;">No topics recorded.</td></tr>`
            }</tbody>
          </table>
        </div>

        ${pollsHtml}
        ${studentRecapHtml}

        <div style="margin-top:8px;padding-top:5px;border-top:1px solid #e2e8f0;font-size:9px;color:#64748b;text-align:center;">
          PulsePoint - The Learning Portal · 1-Page Classroom Analytics &amp; Micro-Poll Report · Room ${escapeHtml(formatRoomCode(roomCode))}
        </div>
      `;

      hostWrapper.appendChild(container);
      document.body.appendChild(hostWrapper);

      const canvas = await html2canvasFn(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        scrollX: 0,
        scrollY: 0,
        ignoreElements: (el: Element) =>
          el.id === "root" ||
          el.tagName === "STYLE" ||
          (el.tagName === "LINK" &&
            (el as HTMLLinkElement).rel.toLowerCase() === "stylesheet"),
        onclone: (clonedDoc: Document) => {
          clonedDoc
            .querySelectorAll('style, link[rel="stylesheet"]')
            .forEach((node) => node.remove());

          clonedDoc.documentElement.removeAttribute("class");
          clonedDoc.documentElement.removeAttribute("data-theme");
          clonedDoc.documentElement.style.cssText =
            "background:#ffffff;color:#0f172a;margin:0;padding:0;";

          clonedDoc.body.removeAttribute("class");
          clonedDoc.body.style.cssText =
            "background:#ffffff;color:#0f172a;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;";

          const clonedHost = clonedDoc.querySelector(
            '[data-pp-pdf-host="true"]'
          ) as HTMLElement | null;
          if (clonedHost) {
            clonedHost.style.position = "static";
            clonedHost.style.left = "0";
            clonedHost.style.top = "0";
            clonedHost.style.opacity = "1";
          }

          const pdfRoot = clonedDoc.querySelector(
            '[data-pp-pdf-root="true"]'
          ) as HTMLElement | null;
          if (pdfRoot) {
            pdfRoot.style.position = "static";
            pdfRoot.style.left = "0";
            pdfRoot.style.top = "0";
            pdfRoot.style.opacity = "1";
            pdfRoot.style.margin = "0 auto";
          }
        },
      });

      const pdf = new JsPdfCtor({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
        compress: true,
      });

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const availW = pageW - margin * 2;
      const availH = pageH - margin * 2;

      const ratio = Math.min(availW / canvas.width, availH / canvas.height);
      const drawW = canvas.width * ratio;
      const drawH = canvas.height * ratio;
      const offsetX = (pageW - drawW) / 2;
      const offsetY = margin;

      const imgData = canvas.toDataURL("image/jpeg", 0.94);
      pdf.addImage(imgData, "JPEG", offsetX, offsetY, drawW, drawH);
      pdf.save(`PulsePoint_Report_${roomCode}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
      setPdfNotice("Direct PDF export failed — opening print fallback.");
      window.print();
    } finally {
      if (hostWrapper.parentNode) {
        hostWrapper.parentNode.removeChild(hostWrapper);
      }
      setExportingPdf(false);
    }
  };

  if (loading) {
    return (
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
        <div className="pp-card border rounded-2xl p-8 text-sm text-slate-400">
          Loading post-class analytics report...
        </div>
      </main>
    );
  }

  if (!accessVerified) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="pp-card border rounded-2xl p-8 space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-100">
            Access Restricted
          </h1>
          <p className="text-sm text-slate-400">
            Access restricted — please scan the classroom QR or enter the live
            join code to unlock this class.
          </p>
          <button
            type="button"
            onClick={onBackToLobby}
            className="min-h-[44px] px-4 py-2 rounded-xl pp-primary-btn text-white text-sm font-medium"
          >
            Return to Join a Lecture
          </button>
        </div>
      </main>
    );
  }

  if (!summary) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="pp-card border rounded-2xl p-8 space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-100">
            Summary Not Ready Yet
          </h1>
          <p className="text-sm text-slate-400">
            The post-class report for room {formatRoomCode(roomCode)} will appear
            once the instructor ends the session.
          </p>
          <button
            type="button"
            onClick={onBackToLobby}
            className="min-h-[44px] px-4 py-2 rounded-xl pp-primary-btn text-white text-sm font-medium"
          >
            Back to Lobby
          </button>
        </div>
      </main>
    );
  }

  const optionLetters = ["A", "B", "C", "D"];

  return (
    <main
      ref={reportRef}
      className="max-w-5xl mx-auto px-3 sm:px-6 py-6 sm:py-8 space-y-6"
    >
      {/* Report Header */}
      <section className="print-surface pp-card backdrop-blur-xl border rounded-2xl p-5 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 print-muted">
            <span className="font-semibold text-sky-400">
              PulsePoint - The Learning Portal
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {mode === "student"
                ? "Student Revision & Poll Comparison Report"
                : "Post-Class Analytics Report"}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{formatRoomCode(roomCode)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDateLabel(createdAtMs)}</span>
          </div>
          <h1 className="print-heading font-display text-2xl sm:text-3xl font-bold text-slate-100 break-words">
            {title || `Lecture ${formatRoomCode(roomCode)}`}
          </h1>
          <p className="text-xs text-slate-400 print-muted">
            Lecture Duration:{" "}
            <span className="font-mono tabular-nums">
              {formatDuration(summary.durationSeconds)}
            </span>{" "}
            · Strictly Anonymous Telemetry
          </p>
          {pdfNotice && (
            <p className="text-xs text-amber-300 mt-1">{pdfNotice}</p>
          )}
        </div>

        <div className="no-print flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onBackToLobby}
            className="min-h-[46px] px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Lobby</span>
          </button>
          <button
            type="button"
            disabled={exportingPdf}
            onClick={() => void handleDownloadPdf()}
            className="min-h-[46px] px-5 py-2.5 rounded-xl pp-primary-btn disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>
              {exportingPdf ? "Generating PDF..." : "📥 Download PDF Report"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[46px] px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium inline-flex items-center gap-2"
            title="Print view"
          >
            <Printer className="w-4 h-4" />
            <span>Print</span>
          </button>
        </div>
      </section>

      {/* 1. Summary KPI Cards */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="print-surface pp-card border rounded-2xl p-4 sm:p-5">
          <div className="text-xs text-slate-400 print-muted">
            Unique Students
          </div>
          <div className="font-mono text-2xl sm:text-3xl font-bold text-slate-100 print-heading mt-1 tabular-nums">
            {summary.totalParticipants}
          </div>
        </div>

        <div className="print-surface pp-card border rounded-2xl p-4 sm:p-5">
          <div className="text-xs text-slate-400 print-muted">
            Class Comprehension
          </div>
          <div className="font-mono text-2xl sm:text-3xl font-bold text-emerald-400 mt-1 tabular-nums">
            {summary.overallComprehensionPct}%
          </div>
        </div>

        <div className="print-surface pp-card border rounded-2xl p-4 sm:p-5">
          <div className="text-xs text-slate-400 print-muted">
            Topics Covered
          </div>
          <div className="font-mono text-2xl sm:text-3xl font-bold text-sky-400 mt-1 tabular-nums">
            {summary.totalTopics}
          </div>
        </div>

        <div className="print-surface pp-card border rounded-2xl p-4 sm:p-5">
          <div className="text-xs text-slate-400 print-muted">
            Confusion Spikes (&gt;30%)
          </div>
          <div className="font-mono text-2xl sm:text-3xl font-bold text-rose-400 mt-1 tabular-nums">
            {summary.spikes.length}
          </div>
        </div>
      </section>

      {/* Re-Check Recovery Proof Section (if instructor triggered Re-Check Pulse) */}
      {summary.recheckHistory && summary.recheckHistory.length > 0 && (
        <section className="print-surface pp-card border border-sky-500/35 rounded-2xl p-4 sm:p-6 space-y-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-sky-400 shrink-0" />
            <h2 className="print-heading font-display text-lg font-bold text-slate-100">
              Smart Re-Check Recovery Proof
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {summary.recheckHistory.map((rc) => (
              <div
                key={rc.id}
                className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-sky-200 truncate">
                    {rc.topic}
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5 tabular-nums">
                    Confusion shifted from {rc.baselineConfusionPct}% →{" "}
                    {rc.afterConfusionPct}%
                  </div>
                </div>
                <span className="font-mono text-xs font-bold text-emerald-400 shrink-0 tabular-nums">
                  {rc.dropPts > 0 ? `-${rc.dropPts} pts` : "Verified"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2. Chart 1 — Topic-Wise Confusion Comparison */}
      <section className="print-surface pp-card border rounded-2xl p-4 sm:p-6 space-y-4">
        <div>
          <h2 className="print-heading font-display text-lg font-bold text-slate-100">
            Chart 1 — Topic-Wise Confusion Comparison
          </h2>
          <p className="text-xs text-slate-400 print-muted mt-0.5">
            Peak vs. Average Confusion % across every topic taught (Red &gt;30%,
            Amber 15–30%, Emerald &lt;15%)
          </p>
        </div>

        <TopicBarChart topics={summary.topicsRanked} />
      </section>

      {/* 3. Chart 2 — 1-Minute Interval Full Lecture Master Timeline */}
      <section className="print-surface pp-card border rounded-2xl p-4 sm:p-6 space-y-5">
        <div>
          <h2 className="print-heading font-display text-lg font-bold text-slate-100">
            Chart 2 — 1-Minute Master Confusion Timeline
          </h2>
          <p className="text-xs text-slate-400 print-muted mt-0.5">
            1-minute interval timeline across all topics with vertical topic
            dividers and spike markers (&gt;30%)
          </p>
        </div>

        <ConfusionChart points={timelinePoints} showTopicDividers />

        {summary.spikes.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {summary.spikes.map((sp) => (
              <div
                key={sp.id}
                className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-semibold text-rose-300 break-words">
                    ⚠️ {sp.timeLabel} · {sp.topic}
                    {sp.subheading ? (
                      <span className="text-rose-200/80 font-normal">
                        {" "}
                        · {sp.subheading}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-400 print-muted tabular-nums">
                    {sp.confusedCount} of {sp.totalParticipants} students confused
                    {sp.topReason ? ` · ${sp.topReason}` : ""}
                  </div>
                </div>
                <div className="font-mono text-lg font-bold text-rose-400 shrink-0 tabular-nums">
                  {sp.confusionPct}%
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Student Personalized AI Study Recap & Self-Check */}
      {mode === "student" && revisionPacks.length > 0 && (
        <section className="print-surface pp-card border pp-accent-border rounded-2xl p-4 sm:p-6 space-y-5">
          <div className="flex items-start gap-2.5">
            <BookOpenCheck className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="print-heading font-display text-lg font-bold text-slate-100">
                AI Study Recap &amp; Self-Check
              </h2>
              <p className="text-xs text-slate-400 print-muted mt-0.5">
                Targeted 3-point revision summaries and 2 practice questions for
                topics where class confusion spiked
              </p>
            </div>
          </div>

          <div className="space-y-5">
            {revisionPacks.map((pack, pIdx) => (
              <div
                key={`${pack.topic}-${pIdx}`}
                className="p-4 sm:p-5 rounded-2xl pp-input print-surface border space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-base font-bold text-slate-100 print-heading">
                    {pack.topic}
                  </h3>
                  <span className="font-mono text-xs font-semibold text-rose-400 tabular-nums">
                    Peak Confusion: {pack.peakConfusionPct}%
                    {pack.topReason ? ` · ${pack.topReason}` : ""}
                  </span>
                </div>

                <ul className="space-y-2 text-xs sm:text-sm text-slate-200 print-muted list-disc pl-5">
                  {pack.bullets.map((bullet, bIdx) => (
                    <li key={bIdx} className="leading-relaxed">
                      {bullet}
                    </li>
                  ))}
                </ul>

                <div className="space-y-3 pt-2 border-t border-slate-800/80">
                  <div className="text-xs font-semibold text-sky-400">
                    Self-Check Practice Questions
                  </div>
                  {pack.practiceQuestions.map((pq, qIdx) => {
                    const qKey = `${pIdx}-${qIdx}`;
                    const shown = Boolean(revealedQuestions[qKey]);
                    return (
                      <div
                        key={qKey}
                        className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5"
                      >
                        <div className="text-xs sm:text-sm font-semibold text-slate-100 print-heading">
                          Q{qIdx + 1}. {pq.question}
                        </div>
                        <div className="space-y-1 text-xs text-slate-300 print-muted">
                          {pq.options.map((opt, oIdx) => (
                            <div key={oIdx}>
                              <span className="font-mono text-slate-500 mr-1.5">
                                {optionLetters[oIdx]}.
                              </span>
                              <span
                                className={
                                  shown && oIdx === pq.correctIndex
                                    ? "text-emerald-400 font-semibold"
                                    : ""
                                }
                              >
                                {opt}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="no-print">
                          <button
                            type="button"
                            onClick={() =>
                              setRevealedQuestions((prev) => ({
                                ...prev,
                                [qKey]: !prev[qKey],
                              }))
                            }
                            className="min-h-[34px] px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-sky-300 inline-flex items-center gap-1.5"
                          >
                            {shown ? (
                              <>
                                <EyeOff className="w-3.5 h-3.5" />
                                <span>Hide Answer</span>
                              </>
                            ) : (
                              <>
                                <Eye className="w-3.5 h-3.5" />
                                <span>Reveal Answer</span>
                              </>
                            )}
                          </button>
                        </div>
                        {shown && (
                          <div className="p-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-xs text-emerald-200">
                            <strong>
                              Answer {optionLetters[pq.correctIndex]}:
                            </strong>{" "}
                            {pq.explanation}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. Ranked "Topics to Revisit" Action Table */}
      <section className="print-surface pp-card border rounded-2xl p-4 sm:p-6 space-y-4">
        <div>
          <h2 className="print-heading font-display text-lg font-bold text-slate-100">
            Ranked &ldquo;Topics to Revisit&rdquo; Action Table
          </h2>
          <p className="text-xs text-slate-400 print-muted mt-0.5">
            Sorted from highest peak confusion to lowest, paired with top
            student reason tags and spike timestamps.
          </p>
        </div>

        {summary.topicsRanked.length === 0 ? (
          <p className="text-sm text-slate-400 print-muted">
            No topics were broadcast during this lecture.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm min-w-[540px]">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400 print-muted">
                  <th className="py-2.5 pr-3 font-medium">Rank</th>
                  <th className="py-2.5 pr-3 font-medium">Topic</th>
                  <th className="py-2.5 pr-3 font-medium text-right">Peak %</th>
                  <th className="py-2.5 pr-3 font-medium text-right">Avg %</th>
                  <th className="py-2.5 pr-3 font-medium">Top Reason</th>
                  <th className="py-2.5 pr-3 font-medium">Spike Times</th>
                  <th className="py-2.5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {summary.topicsRanked.map((t, idx) => (
                  <tr key={`${t.topicVersion}-${t.topic}`}>
                    <td className="py-3 pr-3 font-mono text-xs text-slate-400 tabular-nums">
                      #{idx + 1}
                    </td>
                    <td className="py-3 pr-3 font-medium text-slate-100 print-heading">
                      <div>{t.mainTopic || t.topic}</div>
                      {t.subheadings && t.subheadings.length > 0 && (
                        <div className="text-[11px] font-normal text-slate-400 print-muted mt-0.5">
                          Subheadings: {t.subheadings.join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-right font-mono tabular-nums">
                      <span
                        className={
                          t.peakConfusionPct > 30
                            ? "text-rose-400 font-bold"
                            : t.peakConfusionPct >= 15
                            ? "text-amber-400 font-semibold"
                            : "text-emerald-400"
                        }
                      >
                        {t.peakConfusionPct}%
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-right font-mono text-slate-300 print-muted tabular-nums">
                      {t.avgConfusionPct}%
                    </td>
                    <td className="py-3 pr-3 text-xs text-slate-300 print-muted">
                      {t.topReason || "—"}
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs text-slate-400 print-muted">
                      {t.spikeTimestamps.length > 0
                        ? t.spikeTimestamps.join(", ")
                        : "None"}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      {t.label === "Must Revisit" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-400">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Must Revisit</span>
                        </span>
                      ) : t.label === "Quick Recap Needed" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Quick Recap Needed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Well Understood</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Top Anonymous Doubts Raised */}
      {summary.topDoubts && summary.topDoubts.length > 0 && (
        <section className="print-surface pp-card border rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-sky-400" />
            <h2 className="print-heading font-display text-lg font-bold text-slate-100">
              Top Upvoted Student Doubts
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {summary.topDoubts.map((d) => (
              <div
                key={d.id}
                className="p-3.5 rounded-xl pp-input print-surface border flex items-start justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-[11px] text-slate-400 print-muted">
                    {d.topic} {d.resolved ? "· Resolved" : ""}
                  </div>
                  <div className="text-xs sm:text-sm text-slate-100 print-heading break-words">
                    {d.text}
                  </div>
                </div>
                <span className="font-mono text-xs font-bold text-sky-400 shrink-0 tabular-nums">
                  +{d.upvoterUids?.length || 0}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. Micro-Poll Performance Summary & Answer Comparison */}
      <section className="print-surface pp-card border rounded-2xl p-4 sm:p-6 space-y-4">
        <div>
          <h2 className="print-heading font-display text-lg font-bold text-slate-100">
            Micro-Poll Performance Summary
          </h2>
          <p className="text-xs text-slate-400 print-muted mt-0.5">
            Every poll conducted during this session with its correct answer and
            exact percentage of students who answered correctly
          </p>
        </div>

        {summary.polls.length === 0 ? (
          <p className="text-sm text-slate-400 print-muted">
            No micro-polls were launched during this lecture.
          </p>
        ) : (
          <div className="space-y-4">
            {summary.polls.map((poll, pIdx) => {
              const studentPick = myPollAnswers[poll.pollId];
              const hasStudentPick = studentPick !== undefined;
              const hasCorrect =
                poll.correctOptionIndex !== null &&
                poll.correctOptionIndex >= 0 &&
                poll.correctOptionIndex < poll.options.length;
              const correctIdx = hasCorrect ? poll.correctOptionIndex! : -1;
              const correctCount =
                hasCorrect && poll.counts ? poll.counts[correctIdx] ?? 0 : 0;
              const correctnessPct =
                hasCorrect && poll.totalVotes > 0
                  ? Math.round((correctCount / poll.totalVotes) * 100)
                  : poll.accuracyPct;
              const studentMatched =
                hasStudentPick &&
                hasCorrect &&
                studentPick === poll.correctOptionIndex;

              return (
                <div
                  key={poll.pollId}
                  className="p-4 rounded-xl pp-input print-surface border space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-400 print-muted">
                        Poll {pIdx + 1} · {poll.topic}
                      </div>
                      <div className="font-semibold text-slate-100 print-heading mt-0.5 break-words">
                        {poll.question}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs shrink-0 tabular-nums">
                      <span className="text-slate-400 print-muted">
                        {poll.totalVotes}{" "}
                        {poll.totalVotes === 1 ? "vote" : "votes"}
                      </span>
                      {hasCorrect && correctnessPct !== null && (
                        <span
                          className={`font-mono font-bold ${
                            correctnessPct >= 70
                              ? "text-emerald-400"
                              : correctnessPct >= 45
                              ? "text-amber-400"
                              : "text-rose-400"
                          }`}
                        >
                          {correctnessPct}% Correct ({correctCount}/
                          {poll.totalVotes})
                        </span>
                      )}
                    </div>
                  </div>

                  {hasCorrect && (
                    <div className="text-xs text-emerald-300 font-medium">
                      Correct Answer: Option{" "}
                      {optionLetters[correctIdx] ?? correctIdx + 1} —{" "}
                      {poll.options[correctIdx]}
                    </div>
                  )}

                  {hasStudentPick && hasCorrect && (
                    <div
                      className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                        studentMatched
                          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                          : "bg-rose-500/15 border-rose-500/40 text-rose-300"
                      }`}
                    >
                      {studentMatched ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span>✅ Correct! You matched the right answer</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>
                            ❌ Your Pick: Option{" "}
                            {optionLetters[studentPick] ?? studentPick + 1} ·
                            Correct Answer: Option{" "}
                            {optionLetters[poll.correctOptionIndex!] ??
                              poll.correctOptionIndex! + 1}
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    {poll.options.map((opt, idx) => {
                      const count = poll.counts[idx] ?? 0;
                      const pct =
                        poll.totalVotes > 0
                          ? Math.round((count / poll.totalVotes) * 100)
                          : 0;
                      const isCorrect = poll.correctOptionIndex === idx;
                      const isMyPick = hasStudentPick && studentPick === idx;
                      return (
                        <div key={idx} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-200 print-heading break-words">
                              <span className="font-mono text-slate-400 mr-1.5">
                                {optionLetters[idx] ?? idx + 1}.
                              </span>
                              {opt}{" "}
                              {isCorrect && (
                                <span className="text-emerald-400 font-semibold">
                                  (Correct Answer)
                                </span>
                              )}
                              {isMyPick && (
                                <span className="text-sky-400 font-semibold">
                                  {" "}
                                  · Your Answer
                                </span>
                              )}
                            </span>
                            <span className="font-mono text-slate-400 print-muted shrink-0 tabular-nums">
                              {count} ({pct}%)
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
                            <div
                              className={`h-full ${
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
              );
            })}
          </div>
        )}
      </section>

      {/* Lecture Notes & Resources (Interactive, excluded from 1-page print) */}
      <div className="no-print">
        <LectureNotesPanel
          roomCode={roomCode}
          user={user}
          canUpload={mode === "teacher"}
        />
      </div>

      {/* Post-Class Anonymous Doubt Portal (Interactive, excluded from 1-page print) */}
      <div className="no-print">
        <PostClassDoubtPortal
          roomCode={roomCode}
          user={user}
          isTeacher={mode === "teacher"}
          topicOptions={summary.topicsRanked.map((t) => t.mainTopic || t.topic)}
        />
      </div>
    </main>
  );
}
