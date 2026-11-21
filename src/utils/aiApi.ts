import { AppView, ConceptualCategory, ConceptualMcqItem } from "../types";
import {
  PULSEPOINT_FAQS,
  buildSmartLocalReply,
  findBestFaqMatches,
} from "./aiKnowledgeBase";

export interface ClientChatMessage {
  role: "user" | "model";
  text: string;
}

export interface ClientChatParams {
  message: string;
  history: ClientChatMessage[];
  role: "student" | "teacher" | "user";
  view: AppView;
  activeTopic?: string;
  activeSubheading?: string;
  roomTitle?: string;
  faqId?: string;
}

async function parseJsonResponse<T>(res: Response): Promise<T & { error?: string }> {
  const rawText = await res.text();
  try {
    return JSON.parse(rawText) as T & { error?: string };
  } catch {
    throw new Error("Non-JSON response");
  }
}

export async function askAiAssistant(
  params: ClientChatParams
): Promise<{ reply: string }> {
  const cleanMessage = params.message.trim();
  if (!cleanMessage) {
    return {
      reply:
        "Type a study question or browse **Quick Help Topics (30 FAQs)** above for instant help!",
    };
  }

  // 1. Direct FAQ chip click -> instant answer from the 30-question knowledge base
  if (params.faqId) {
    const exact = PULSEPOINT_FAQS.find((f) => f.id === params.faqId);
    if (exact) {
      return { reply: exact.answer };
    }
  }

  // 2. High-confidence PulsePoint platform FAQ match -> instant crystal-clear answer
  const faqMatches = findBestFaqMatches(cleanMessage, 2);
  if (faqMatches.length > 0 && faqMatches[0].score >= 8) {
    return {
      reply: buildSmartLocalReply({
        message: cleanMessage,
        view: params.view,
        activeTopic: params.activeTopic,
        activeSubheading: params.activeSubheading,
      }),
    };
  }

  // 3. Try server-side AI endpoint (/api/chat), seamlessly falling back to smart local engine so it NEVER errors
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        message: cleanMessage,
        history: params.history.slice(-8),
        role: params.role,
        view: params.view,
        activeTopic: params.activeTopic || "",
        activeSubheading: params.activeSubheading || "",
        roomTitle: params.roomTitle || "",
      }),
    });
    clearTimeout(timer);

    const data = await parseJsonResponse<{ reply?: string }>(res);
    if (res.ok && data.reply && data.reply.trim()) {
      return { reply: data.reply.trim() };
    }
  } catch {
    // Graceful fallback below — never surface raw JSON/API errors to the user
  }

  return {
    reply: buildSmartLocalReply({
      message: cleanMessage,
      view: params.view,
      activeTopic: params.activeTopic,
      activeSubheading: params.activeSubheading,
    }),
  };
}

function buildFallbackQuestionPool(
  mainTopic: string,
  subheading: string
): ConceptualMcqItem[] {
  const topic = mainTopic.trim() || "Current Concept";
  const sub = subheading.trim();
  const focus = sub ? `${topic} (${sub})` : topic;
  const stamp = Date.now().toString(36).slice(-4);
  const categories: ConceptualCategory[] = [
    "Meaning / Definition",
    "Formula / Principle",
    "Practical Uses & Applications",
    "Conceptual Edge Cases",
  ];

  const templates: Array<{
    category: ConceptualCategory;
    question: string;
    options: [string, string, string, string];
    correctIndex: number;
    explanation: string;
  }> = [
    {
      category: categories[0],
      question: `Which statement best defines the core purpose of ${focus}?`,
      options: [
        `Establishing the exact rules, valid inputs, and guaranteed outcomes of ${topic}`,
        "Memorizing numbers without understanding prerequisites",
        "Skipping validation checks for unverified output",
        "Replacing logical invariants with random guesses",
      ],
      correctIndex: 0,
      explanation: `${focus} relies on explicit input rules and transformation invariants.`,
    },
    {
      category: categories[0],
      question: `In ${focus}, what does an invariant mean?`,
      options: [
        "A temporary variable ignored after step one",
        "A condition that stays true across every valid step",
        "An error raised when inputs are valid",
        "A formatting style with no logical meaning",
      ],
      correctIndex: 1,
      explanation: "Invariants guarantee each transition preserves correctness.",
    },
    {
      category: categories[0],
      question: `Why must prerequisites be checked before applying ${focus}?`,
      options: [
        "Applying a rule outside its valid domain leads to wrong outcomes",
        "Prerequisites only affect visual colors",
        "All inputs automatically obey every constraint",
        "Checking constraints removes the need for outputs",
      ],
      correctIndex: 0,
      explanation: "Every principle holds only when its required assumptions are satisfied.",
    },
    {
      category: categories[0],
      question: `What separates structured reasoning in ${topic} from trial-and-error?`,
      options: [
        "Ignoring small boundary cases",
        "Assuming errors self-correct randomly",
        `Predictable transitions guided by ${sub || "clear preconditions"}`,
        "Avoiding intermediate verification",
      ],
      correctIndex: 2,
      explanation: "Clear preconditions guarantee repeatable, verifiable behavior.",
    },
    {
      category: categories[1],
      question: `When analyzing how ${focus} scales with size n, what should you determine first?`,
      options: [
        "How inputs map through each elementary step or transition",
        "A random constant ignoring input size",
        "Skipping loop or step termination checks",
        "Assuming O(1) cost without counting work",
      ],
      correctIndex: 0,
      explanation: "Counting work per input size reveals time and resource growth.",
    },
    {
      category: categories[1],
      question: `Which habit best verifies the underlying principle of ${focus}?`,
      options: [
        "Checking only the final value blindly",
        "Tracing intermediate state values step-by-step on a 3-item example",
        "Skipping 0 and 1 inputs intentionally",
        "Changing three rules at once without testing",
      ],
      correctIndex: 1,
      explanation: "Step-by-step trace tables catch off-by-one and state drift bugs early.",
    },
    {
      category: categories[1],
      question: `How does ${focus} guarantee termination and convergence?`,
      options: [
        "Each step resets progress randomly",
        "Termination checks are left out",
        "Each transition moves monotonically closer to a stopping state while preserving invariants",
        "Intermediate states are discarded",
      ],
      correctIndex: 2,
      explanation: "Monotonic progress plus preserved invariants guarantee termination.",
    },
    {
      category: categories[1],
      question: `If an intermediate check in ${focus} fails, what is the strongest diagnostic step?`,
      options: [
        "Re-check units, inequalities, and precondition assumptions at that step",
        "Double the input size blindly",
        "Ignore the failure if the start looked right",
        "Hardcode the expected answer",
      ],
      correctIndex: 0,
      explanation: "Verifying assumptions pinpoints exactly where logic diverged.",
    },
    {
      category: categories[2],
      question: `Where is ${focus} applied most effectively in practice?`,
      options: [
        "Skipping documentation and error handling",
        "Structured workflows where predictable rules safely transform inputs",
        "Replacing clear interfaces with hidden side effects",
        "Writing unvalidated data directly into storage",
      ],
      correctIndex: 1,
      explanation: "Reliable systems combine core principles with explicit validation.",
    },
    {
      category: categories[2],
      question: `When debugging a real implementation of ${focus}, which workflow saves the most time?`,
      options: [
        "Rewriting unrelated files first",
        "Guessing fixes without reproducing",
        "Isolating the minimal failing input and tracing each state transition",
        "Disabling error alerts",
      ],
      correctIndex: 2,
      explanation: "Minimal reproducible traces expose the exact failing transition.",
    },
    {
      category: categories[2],
      question: `Which practical engineering trade-off commonly guides ${focus}?`,
      options: [
        "Maximizing code verbosity",
        "Balancing clarity, speed, and memory overhead",
        "Removing all abstractions everywhere",
        "Ignoring maintainability",
      ],
      correctIndex: 1,
      explanation: "Sound design balances readability alongside time and space budgets.",
    },
    {
      category: categories[2],
      question: `After studying one worked example of ${focus}, how do you confirm mastery?`,
      options: [
        "Re-read the slide header without solving",
        "Copy the numbers without checking assumptions",
        "Skip edge cases intentionally",
        "Solve a fresh variant from scratch and justify each step",
      ],
      correctIndex: 3,
      explanation: "Active retrieval on novel variants proves real conceptual transfer.",
    },
    {
      category: categories[3],
      question: `Which boundary input class should be tested FIRST for ${focus}?`,
      options: [
        "Empty (size 0), single-item (size 1), and min/max limit values",
        "Only pre-sorted arrays of size 10",
        "Inputs where the result is already hardcoded",
        "Random values ignoring type rules",
      ],
      correctIndex: 0,
      explanation: "Zero, single-item, and extreme bounds expose most edge failures.",
    },
    {
      category: categories[3],
      question: `Why do naive implementations of ${focus} often fail on boundary cases?`,
      options: [
        "Off-by-one comparisons (< vs <=), null dereferences, or unguarded bounds",
        "CPUs run slower on boundary values",
        "Conditionals are unnecessary for correct logic",
        "Out-of-bounds values fix themselves automatically",
      ],
      correctIndex: 0,
      explanation: "Strict boundary guards prevent off-by-one and overflow errors.",
    },
    {
      category: categories[3],
      question: `What happens when ${focus} receives duplicate or out-of-domain values without guards?`,
      options: [
        "The system automatically invents new rules",
        "Unless explicitly guarded by preconditions, invariants can silently break",
        "Execution becomes infinitely fast",
        "Duplicates never change outputs",
      ],
      correctIndex: 1,
      explanation: "Explicit guards for degenerate inputs keep behavior deterministic.",
    },
    {
      category: categories[3],
      question: `Which numeric precision hazard should you guard near large limits in ${focus}?`,
      options: [
        "Using descriptive variable names",
        "Checking bounds before indexing",
        "Returning early on empty inputs",
        "Adding two large bounds directly instead of computing `low + (high - low) / 2`",
      ],
      correctIndex: 3,
      explanation: "Preventing intermediate overflow keeps large-scale arithmetic accurate.",
    },
  ];

  return templates.map((t, idx) => ({
    id: `fbq_${stamp}_${idx + 1}`,
    ...t,
  }));
}

export async function generateConceptualQuestionBank(
  mainTopic: string,
  subheading: string
): Promise<{ questions: ConceptualMcqItem[] }> {
  const cleanTopic = mainTopic.trim() || "Current Lecture Topic";
  const cleanSub = subheading.trim();

  try {
    const res = await fetch("/api/quiz/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mainTopic: cleanTopic,
        subheading: cleanSub,
      }),
    });

    const data = await parseJsonResponse<{ questions?: ConceptualMcqItem[] }>(res);
    if (res.ok && Array.isArray(data.questions) && data.questions.length >= 5) {
      return { questions: data.questions };
    }
  } catch {
    // Fallback cleanly so live classrooms are never blocked
  }

  return { questions: buildFallbackQuestionPool(cleanTopic, cleanSub) };
}
