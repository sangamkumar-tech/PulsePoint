import { AppView } from "../types";

export interface FaqEntry {
  id: string;
  category:
    | "Getting Started"
    | "QR & Anti-Proxy"
    | "Privacy & Access"
    | "Live Teaching & Graphs"
    | "AI Quizzes & Flashcards"
    | "Notes, Doubts & Reports";
  question: string;
  keywords: string[];
  answer: string;
}

export const PULSEPOINT_FAQS: FaqEntry[] = [
  {
    id: "faq-01",
    category: "Getting Started",
    question: "How do I host a live lecture on PulsePoint?",
    keywords: ["host", "create", "lecture", "teacher", "start", "room", "new class"],
    answer: [
      "**How to Host a Live Lecture:**",
      "- Open the **Teacher Section (Host a Lecture)** card in the Lobby.",
      "- Enter your **Lecture Title** (e.g., *CS 201: Pointers & Dynamic Memory*) and click **Host a Lecture & Generate QR**.",
      "- PulsePoint creates a permanent session ID, shows a live **10-second rotating Join Code & QR code**, and saves the class under **Classes Conducted**.",
    ].join("\n"),
  },
  {
    id: "faq-02",
    category: "Getting Started",
    question: "How do students join a lecture safely?",
    keywords: ["join", "student", "enter", "code", "enroll", "unlock", "class"],
    answer: [
      "**Joining a Lecture as a Student:**",
      "- In the Lobby's **Join a Lecture** card, either type the 6-character code shown on the teacher's screen or click **📷 Scan QR Code** to scan the live QR.",
      "- Choose your **Identity Privacy Mode** (*Anonymous*, *Teacher Only*, or *Show to All*) and submit.",
      "- Once verified, your device locks into the permanent classroom session and adds the lecture to your private **Classes Attended** list.",
    ].join("\n"),
  },
  {
    id: "faq-03",
    category: "QR & Anti-Proxy",
    question: "How does the strict 10-second rotating QR & join code work?",
    keywords: ["10 second", "10s", "rotate", "rotating", "anti-proxy", "proxy", "qr", "codeexpiresat"],
    answer: [
      "**Strict Anti-Proxy 10-Second Rotation:**",
      "- On the Teacher Dashboard and Lobby preview, a brand-new **6-character Join Code & QR code** is generated every **10 seconds** with an exact `codeExpiresAt` deadline (`Date.now() + 10000`).",
      "- Each rotation immediately invalidates and deletes the previous code so absent students cannot join using screenshots or shared codes.",
      "- Meanwhile, students who already joined stay connected to the underlying session continuously.",
    ].join("\n"),
  },
  {
    id: "faq-04",
    category: "QR & Anti-Proxy",
    question: "Do old QR codes or join codes still work after 10 seconds?",
    keywords: ["grace", "buffer", "old code", "validjoincodes", "after 10", "timeout"],
    answer: [
      "**Zero-Tolerance 10-Second Expiry (No Grace Buffer):**",
      "- No. PulsePoint enforces **strict zero-tolerance expiry**—as soon as the 10-second countdown resets or the instructor leaves/ends class, previous codes are immediately overwritten and rejected.",
      "- If your timer runs out mid-scan, wait for the next 10-second code to appear on screen and scan/enter that live code.",
    ].join("\n"),
  },
  {
    id: "faq-05",
    category: "QR & Anti-Proxy",
    question: "Why did I see 'QR / Join Code Expired' when joining?",
    keywords: ["expired", "code expired", "latest qr", "invalid code", "rejected", "proxy sharing"],
    answer: [
      "**Why a Join Code Is Blocked as Expired:**",
      "- Your submitted code either did not match the room's current `activeJoinCode`, exceeded the **strict 10-second `codeExpiresAt` window**, or the instructor closed/ended the live session.",
      "- Simply look at the instructor's live screen and scan the current QR with **📷 Scan QR Code** or type the active 6-character code within 10 seconds.",
    ].join("\n"),
  },
  {
    id: "faq-06",
    category: "QR & Anti-Proxy",
    question: "How do I use the built-in webcam QR scanner?",
    keywords: ["camera", "webcam", "scan qr", "scanner", "lens", "front", "rear"],
    answer: [
      "**Using the Built-In Camera QR Scanner:**",
      "- Click **📷 Scan QR Code** next to the 6-character input box in **Join a Lecture**.",
      "- Allow camera access when prompted and point your laptop or phone camera at the projected QR code.",
      "- PulsePoint reads `?code=XXXXXX` automatically, enrolls you into the room, closes the scanner, and opens the live student view immediately.",
    ].join("\n"),
  },
  {
    id: "faq-07",
    category: "QR & Anti-Proxy",
    question: "What if my browser or laptop camera is blocked in the QR scanner?",
    keywords: ["camera blocked", "permission denied", "no camera", "upload qr", "fallback"],
    answer: [
      "**Camera Unavailable or Blocked Fallback:**",
      "- Inside the **QR Scanner Modal**, you can switch cameras (**Flip Camera**), upload a QR screenshot directly (**Upload QR Image**), or type the 6-character code shown beside the projector QR.",
      "- On preview iframes without camera permissions, manual 6-character entry or QR image upload works instantly.",
    ].join("\n"),
  },
  {
    id: "faq-08",
    category: "QR & Anti-Proxy",
    question: "Do already-joined students get disconnected when the QR rotates?",
    keywords: ["disconnect", "kick", "stay connected", "permanent", "rotation"],
    answer: [
      "**Zero Disconnections During Rotation:**",
      "- No! Only the *entry* join code rotates every 10 seconds.",
      "- Once enrolled via a valid join code, your session stays bound to the permanent classroom ID (`roomCode`) for the entire lecture and post-class review.",
    ].join("\n"),
  },
  {
    id: "faq-09",
    category: "Privacy & Access",
    question: "Why can only joined students view a class's notes, polls, and doubts?",
    keywords: ["access restricted", "permission", "enrolled", "private", "unlock", "security", "notes access"],
    answer: [
      "**Strict Per-Class Access Control:**",
      "- Every classroom's Lecture Notes, Flashcards, Polls, Doubts, and Analytics Reports are locked exclusively to that room's **host teacher** and **legitimately enrolled students**.",
      "- Non-members or unauthenticated visitors cannot list other classrooms or access notes directly—they are redirected to **Join a Lecture** to verify with a live QR/join code.",
    ].join("\n"),
  },
  {
    id: "faq-10",
    category: "Privacy & Access",
    question: "How do the 3 Student Identity Privacy Modes work?",
    keywords: ["privacy", "anonymous", "teacher only", "show to all", "public", "identity", "3 modes"],
    answer: [
      "**3 Student Identity Privacy Modes:**",
      "- **🔒 Anonymous:** Your name and email are completely hidden from both the instructor and classmates.",
      "- **👨‍🏫 Teacher Only:** Only your instructor sees your name next to confusion pulses, doubts, and written responses; classmates still see *Anonymous Student*.",
      "- **🌐 Show to All:** Your display name appears to both the instructor and classmates on the Doubt Wall.",
    ].join("\n"),
  },
  {
    id: "faq-11",
    category: "Privacy & Access",
    question: "Can I switch my privacy mode during a live lecture?",
    keywords: ["switch privacy", "change mode", "mid lecture", "toggle anonymity"],
    answer: [
      "**Switching Privacy Mid-Lecture:**",
      "- Yes! At the top of the **Student View**, use the **Identity Mode** pill bar (*Anonymous*, *Teacher Only*, or *Show to All*) at any time.",
      "- Your choice updates your live participant record immediately and applies to new doubts and responses.",
    ].join("\n"),
  },
  {
    id: "faq-12",
    category: "Privacy & Access",
    question: "Why does PulsePoint require email verification and reCAPTCHA?",
    keywords: ["email verification", "verify email", "recaptcha", "login", "auth", "blocked"],
    answer: [
      "**Verified Accounts & Anti-Bot Security:**",
      "- PulsePoint blocks unverified or guest access to protect classroom telemetry integrity.",
      "- Every sign-in/sign-up runs **Google reCAPTCHA Enterprise** and verifies `emailVerified === true` before granting access to the Lobby, while still keeping student identities anonymous inside rooms.",
    ].join("\n"),
  },
  {
    id: "faq-13",
    category: "Live Teaching & Graphs",
    question: "How do Main Topics and Subheadings work during a lecture?",
    keywords: ["main topic", "subheading", "sub-topic", "broadcast", "hierarchy", "section"],
    answer: [
      "**Main Topic + Subheading Hierarchy:**",
      "- On the Teacher Dashboard, type a **Main Topic** (and optional **Subheading**) and click **Broadcast** to start a new topic—student statuses automatically reset cleanly for accurate telemetry.",
      "- To advance within the same Main Topic without resetting student status, type a new **Subheading** and click **Update Subheading**.",
      "- Subheading transitions are tagged directly on the 1-minute timeline and ranked topic breakdown.",
    ].join("\n"),
  },
  {
    id: "faq-14",
    category: "Live Teaching & Graphs",
    question: "How do the 1-minute confusion timeline and >30% spike alerts work?",
    keywords: ["1-minute", "timeline", "graph", "chart", "spike", "30%", "threshold", "red"],
    answer: [
      "**1-Minute Confusion Timeline & Spike Alerts:**",
      "- Chart.js plots confusion percentage at strict **1-minute intervals** (`HH:MM`), updating the current minute live and locking each minute cleanly.",
      "- A horizontal dashed threshold marks **30% confusion**; any minute crossing 30% triggers a red **⚠️ Confusion Spike** marker and logs the timestamp plus top student confusion reasons.",
    ].join("\n"),
  },
  {
    id: "faq-15",
    category: "Live Teaching & Graphs",
    question: "What happens when a student taps 'I'm Following' vs 'I'm Confused'?",
    keywords: ["following", "confused", "pulse", "reason", "too fast", "need example", "missed step"],
    answer: [
      "**Live Comprehension Pulse & Reason Tags:**",
      "- Tapping **I'm Following 👍** marks the student as clear on the active topic.",
      "- Tapping **I'm Confused 😕** increments the live confusion meter and reveals optional 1-tap feedback tags (*Need Example*, *Too Fast*, *Missed a Step*, *Audio/Board Issue*) so the teacher immediately knows *why* students are stuck.",
    ].join("\n"),
  },
  {
    id: "faq-16",
    category: "Live Teaching & Graphs",
    question: "How does the Pace-O-Meter help instructors adjust speed?",
    keywords: ["pace", "pace-o-meter", "speed", "slow down", "fast", "gauge"],
    answer: [
      "**Real-Time Pace-O-Meter:**",
      "- The Pace-O-Meter combines overall confusion %, *Too Fast* reason counts, and recent telemetry deltas to classify lecture pacing as **Optimal Pace**, **Slightly Fast**, or **Slow Down Now**.",
      "- When confusion surges, it recommends pausing for a quick example or triggering a Rescue Poll.",
    ].join("\n"),
  },
  {
    id: "faq-17",
    category: "Live Teaching & Graphs",
    question: "What is 'Instructor Re-Check Pulse' and how does it prove recovery?",
    keywords: ["re-check", "recheck", "recovery", "clear doubt", "re-explanation"],
    answer: [
      "**Smart Re-Check Pulse:**",
      "- After re-explaining a confusing point, the teacher clicks **Re-Check Pulse**.",
      "- Students currently marked *Confused* receive a 1-tap prompt: *'Did that re-explanation clear your doubt?'* (**Yes, Got It!** / **Still Stuck**).",
      "- PulsePoint logs the before-and-after confusion drop (e.g., `48% → 14%`, `-34 pts recovery`) in the post-class report.",
    ].join("\n"),
  },
  {
    id: "faq-18",
    category: "Live Teaching & Graphs",
    question: "How does the Class Doubts Wall & '+1 Same Doubt' prevent spam?",
    keywords: ["doubt wall", "upvote", "+1", "same doubt", "duplicate", "question"],
    answer: [
      "**Upvoted Class Doubts Wall:**",
      "- Students submit 1-line questions under the active topic (following their selected privacy mode).",
      "- Instead of repeating identical questions, classmates tap **+1 Same Doubt** to push the highest-demand questions to the top of the instructor's queue, where teachers can mark them **Resolved**.",
    ].join("\n"),
  },
  {
    id: "faq-19",
    category: "Live Teaching & Graphs",
    question: "How does PulsePoint support 100+ concurrent students without lag?",
    keywords: ["100+", "concurrent", "scale", "lag", "performance", "demo simulator", "fast"],
    answer: [
      "**High-Concurrency Architecture (100+ Students):**",
      "- Each student updates only their own lightweight document (`rooms/{roomId}/participants/{uid}`)—avoiding array contention.",
      "- Timeline telemetry writes once per **1-minute bucket** (`timeline/{minute_topic}`) instead of flooding writes on every click.",
      "- Per-student 5-MCQ quiz shuffling runs deterministically in the browser via seeded hashing (`uid + quizId + batchVersion`) with zero extra database reads.",
    ].join("\n"),
  },
  {
    id: "faq-20",
    category: "Live Teaching & Graphs",
    question: "How do I test a full lecture with the 100-Student Demo Simulator?",
    keywords: ["simulator", "demo", "100 student", "fast-forward", "judge", "test"],
    answer: [
      "**Using the 100-Student Live Simulator:**",
      "- Inside the Teacher Dashboard, enable the **100-Student Demo Simulator** after broadcasting a topic.",
      "- You can simulate realistic confusion waves (>30% spikes), auto-generate doubts, and use **Fast-Forward +1 Min** to populate multiple 1-minute X-axis intervals in seconds.",
    ].join("\n"),
  },
  {
    id: "faq-21",
    category: "AI Quizzes & Flashcards",
    question: "How does 'Auto-Generate Rescue Poll' work during a confusion spike?",
    keywords: ["rescue poll", "auto-generate", "quick poll", "micro-poll", "spike poll"],
    answer: [
      "**Auto-Generated Rescue Micro-Poll:**",
      "- When confusion rises (>30%), click **✨ Auto-Generate Rescue Poll** in the Assessments panel.",
      "- PulsePoint drafts a targeted conceptual multiple-choice question with a marked correct option so you can diagnose the exact misconception in 15 seconds.",
    ].join("\n"),
  },
  {
    id: "faq-22",
    category: "AI Quizzes & Flashcards",
    question: "How does the AI 5-Question Conceptual Set generator work?",
    keywords: ["5-question", "5 q", "mcq", "generator", "conceptual", "categories"],
    answer: [
      "**AI 5-Question Conceptual Generator:**",
      "- Switch the Assessments card to **✨ AI 5-Q Sets** and click **Generate Question Bank**.",
      "- It produces **16+ conceptual MCQs** balanced across 4 categories: *Meaning / Definition*, *Formula / Principle*, *Practical Uses & Applications*, and *Conceptual Edge Cases*.",
      "- Review or toggle checkboxes, then click **Push Unique 5-Q Sets** to send live sets to students.",
    ].join("\n"),
  },
  {
    id: "faq-23",
    category: "AI Quizzes & Flashcards",
    question: "How does each student receive a unique 5-question set to prevent copying?",
    keywords: ["unique", "shuffle", "anti-cheat", "different questions", "copy", "seed"],
    answer: [
      "**Per-Student Seeded Question Shuffling:**",
      "- From the teacher's approved 15–20 MCQ pool, each student's client deterministically selects and orders **5 unique questions** seeded by `uid + quizId + batchVersion`.",
      "- Neighboring students receive different combinations and orders—preventing shoulder-surfing without extra server load.",
    ].join("\n"),
  },
  {
    id: "faq-24",
    category: "AI Quizzes & Flashcards",
    question: "What does 'Refresh & Resend New 5 Qs' do?",
    keywords: ["refresh", "resend", "new 5 qs", "batchversion", "unlock", "second round"],
    answer: [
      "**Refreshing & Resending a New 5-Question Round:**",
      "- Clicking **🔄 Refresh & Resend New 5 Qs** increments `batchVersion` on the active quiz.",
      "- Every student's quiz card immediately unlocks with a **brand-new shuffled 5-question set** drawn from the pool, and you can inspect scores and responses live.",
    ].join("\n"),
  },
  {
    id: "faq-25",
    category: "AI Quizzes & Flashcards",
    question: "How do Written Questions and AI Flashcards / Study Recaps work?",
    keywords: ["written", "short answer", "flashcard", "study recap", "open-ended", "self-check"],
    answer: [
      "**Written Questions & Study Recaps / Flashcards:**",
      "- **✍️ Written Q Mode:** Switch to the Written Q tab to send an open-ended prompt; students submit concise text explanations that appear live on your dashboard.",
      "- **Study Recaps & Self-Check:** When class ends, students see targeted 3-point revision takeaways and revealable self-check practice flashcards for spiked topics inside their Revision Report.",
    ].join("\n"),
  },
  {
    id: "faq-26",
    category: "Notes, Doubts & Reports",
    question: "How do teachers upload Lecture Notes (PDF, PPT, DOC, Images) for students?",
    keywords: ["upload", "notes", "ppt", "pdf", "doc", "slides", "handout", "resources"],
    answer: [
      "**Sharing Lecture Notes & Slides:**",
      "- In the **Lecture Notes & Resources** panel (on the Teacher Dashboard, Summary Report, or Lobby **Doubts & Notes** drawer), enter a title, choose a `.pdf`, `.ppt/.pptx`, `.doc/.docx`, `.txt`, or image file, and click **Upload Note**.",
      "- Only verified enrolled students of that room can see and click **⬇ Download Note** (during class, after class, or from **Classes Attended**).",
    ].join("\n"),
  },
  {
    id: "faq-27",
    category: "Notes, Doubts & Reports",
    question: "How does the Post-Class Anonymous Doubt Portal work after class ends?",
    keywords: ["post-class", "after class", "doubt portal", "reply", "resolve", "follow-up"],
    answer: [
      "**Post-Class Anonymous Doubt Portal:**",
      "- Once a lecture ends (`status === 'ended'`), students can submit follow-up doubts tagged by topic from the Lecture Ended screen, **Classes Attended → Notes & Doubts**, or the **Summary Report**.",
      "- Teachers open **Classes Conducted → Doubts & Notes** (or the Report) to type an official reply and click **✍️ Reply / Resolve**.",
    ].join("\n"),
  },
  {
    id: "faq-28",
    category: "Notes, Doubts & Reports",
    question: "How do I download the 1-Page Post-Class PDF Report?",
    keywords: ["pdf report", "download pdf", "export", "1-page", "a4", "print"],
    answer: [
      "**Downloading the 1-Page A4 PDF Report:**",
      "- Click **End Class Now** on the Teacher Dashboard (which compiles and opens the report automatically) or open any past class from **Classes Conducted / Attended**.",
      "- Click **📥 Download PDF Report** to export a single-page A4 PDF featuring KPI cards, Topic-Wise & 1-Minute Timeline charts, Spike Alerts, Ranked Topics to Revisit, and Micro-Poll accuracy.",
    ].join("\n"),
  },
  {
    id: "faq-29",
    category: "Notes, Doubts & Reports",
    question: "Where can I review my past conducted or attended classes and poll scores?",
    keywords: ["history", "classes conducted", "classes attended", "past report", "poll match", "my answer"],
    answer: [
      "**Persistent Class History & Poll Comparison:**",
      "- **Teachers:** View **Classes Conducted** in the Lobby (strictly filtered to rooms where you are the host) to resume live sessions, reply to doubts, upload notes, or open reports.",
      "- **Students:** View **Classes Attended** in the Lobby (strictly rooms you joined via valid QR/code) to download notes, ask post-class doubts, and verify whether your poll picks matched the correct answer.",
    ].join("\n"),
  },
  {
    id: "faq-30",
    category: "Notes, Doubts & Reports",
    question: "How do I switch between Dark Slate and Pitch Black themes?",
    keywords: ["theme", "dark slate", "pitch black", "amoled", "appearance", "color", "oled"],
    answer: [
      "**Dual-Theme Switcher (Dark Slate / Pitch Black):**",
      "- Click the theme toggle button in the top navigation bar anytime to switch between **Dark Slate** (deep glassmorphic slate) and **Pitch Black** (high-contrast OLED black).",
      "- Your preference saves automatically across sessions, while PDF exports remain crisp black-on-white for printing.",
    ].join("\n"),
  },
];

const STOP_WORDS = new Set([
  "the", "is", "a", "an", "to", "for", "of", "in", "on", "and", "or", "how",
  "do", "does", "what", "why", "where", "when", "can", "i", "my", "we", "me",
  "it", "this", "that", "with", "from", "are", "be", "if", "use", "get",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s+-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

export function searchFaqs(query: string): FaqEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return PULSEPOINT_FAQS;
  const tokens = tokenize(q);
  return PULSEPOINT_FAQS.filter((faq) => {
    const haystack = `${faq.category} ${faq.question} ${faq.keywords.join(" ")}`.toLowerCase();
    if (haystack.includes(q)) return true;
    return tokens.every((t) => haystack.includes(t));
  });
}

export function findBestFaqMatches(
  query: string,
  limit = 3
): Array<{ faq: FaqEntry; score: number }> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = tokenize(q);

  const scored = PULSEPOINT_FAQS.map((faq) => {
    let score = 0;
    const qLower = faq.question.toLowerCase();

    if (qLower === q) score += 20;
    else if (qLower.includes(q) && q.length >= 4) score += 10;

    for (const kw of faq.keywords) {
      const kwLower = kw.toLowerCase();
      if (q.includes(kwLower)) {
        score += kwLower.includes(" ") ? 6 : 4;
      }
    }

    for (const tok of tokens) {
      if (qLower.includes(tok)) score += 2;
      if (faq.keywords.some((k) => k.toLowerCase().includes(tok))) score += 2;
      if (faq.answer.toLowerCase().includes(tok)) score += 0.5;
    }

    return { faq, score };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

export function buildSmartLocalReply(params: {
  message: string;
  view: AppView;
  activeTopic?: string;
  activeSubheading?: string;
}): string {
  const cleanMsg = params.message.trim();
  const q = cleanMsg.toLowerCase();
  const matches = findBestFaqMatches(cleanMsg, 2);

  // Strong PulsePoint FAQ match -> return directly!
  if (matches.length > 0 && matches[0].score >= 6) {
    const top = matches[0].faq;
    if (matches[1] && matches[1].score >= 6 && matches[1].faq.id !== top.id) {
      return `${top.answer}\n\n**Related Topic (${matches[1].faq.question}):**\n${matches[1].faq.answer}`;
    }
    return top.answer;
  }

  const topicLabel = params.activeTopic?.trim() || "your current lecture topic";
  const subLabel = params.activeSubheading?.trim()
    ? ` (${params.activeSubheading.trim()})`
    : "";

  // Academic / Concept help tailored to active topic
  if (q.includes("recurs")) {
    return [
      `**Recursion Guide${subLabel}:**`,
      "- **Base Case:** A direct terminating condition that stops further self-calls.",
      "- **Recursive Step:** Moves input strictly closer to the base case on each call.",
      "- **Call Stack:** Each active call keeps its own stack frame with local variables until returning.",
      "```ts\nfunction factorial(n: number): number {\n  if (n <= 1) return 1;\n  return n * factorial(n - 1);\n}\n```",
    ].join("\n");
  }

  if (q.includes("pointer") || q.includes("memory") || q.includes("heap") || q.includes("stack")) {
    return [
      `**Memory & Pointers Guide${subLabel}:**`,
      "- **Address (`&x`) vs. Dereference (`*p`):** `&x` obtains the memory location; `*p` reads/writes the value at that address.",
      "- **Stack vs. Heap:** Stack memory frees automatically on return; heap allocations persist until freed.",
      "- **Safety Rule:** Always initialize pointers and check for `null` before dereferencing.",
    ].join("\n");
  }

  if (q.includes("example") || q.includes("real-world") || q.includes("real world") || q.includes("analogy")) {
    return [
      `**Real-World Example for ${topicLabel}${subLabel}:**`,
      `- Picture **${topicLabel}** as a structured 3-stage pipeline: **Input Check → Core Rule → Edge Guard**.`,
      "- **1. Input Check:** Confirm assumptions and valid bounds before starting.",
      "- **2. Core Rule:** Trace a tiny 3-step sample by hand so every state transition is visible.",
      "- **3. Edge Guard:** Verify zero/empty or extreme boundary inputs still behave safely.",
    ].join("\n");
  }

  if (q.includes("quiz") || q.includes("practice")) {
    return [
      `**Quick Self-Check on ${topicLabel}${subLabel}:**`,
      `- **Question:** What should you verify FIRST before applying **${topicLabel}**?`,
      "- **A)** Input preconditions and boundary limits hold",
      "- **B)** Memorized numbers from an unrelated problem",
      "- **C)** Skipping intermediate validation steps",
      "- **Answer:** **A** — Verifying preconditions and boundaries prevents most conceptual mistakes.",
    ].join("\n");
  }

  if (matches.length > 0 && matches[0].score >= 3) {
    return matches[0].faq.answer;
  }

  return [
    `**Study & Portal Breakdown — ${topicLabel}${subLabel}:**`,
    `- **1. Core Definition:** Clarify what problem **${topicLabel}** solves and the invariant it preserves.`,
    "- **2. Key Principle:** Break the workflow into explicit inputs, state transitions, and outputs.",
    "- **3. Worked Trace:** Walk through a small 2–3 step example before scaling up.",
    "- **4. Common Edge Cases:** Check empty (`0` / `null`), single-item, and max-bound cases.",
    "- *Tip:* Open **Quick Help Topics (30 FAQs)** above to browse or search all PulsePoint features anytime!",
  ].join("\n");
}
