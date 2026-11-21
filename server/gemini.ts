import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

export interface ServerChatHistoryMessage {
  role: "user" | "model";
  text: string;
}

export interface ServerChatParams {
  message: string;
  history: ServerChatHistoryMessage[];
  role: "student" | "teacher" | "user";
  view: string;
  activeTopic: string;
  activeSubheading: string;
  roomTitle: string;
}

export type ConceptualCategory =
  | "Meaning / Definition"
  | "Formula / Principle"
  | "Practical Uses & Applications"
  | "Conceptual Edge Cases";

export interface GeneratedMcqItem {
  id: string;
  category: ConceptualCategory;
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
}

const CONCEPTUAL_CATEGORIES: ConceptualCategory[] = [
  "Meaning / Definition",
  "Formula / Principle",
  "Practical Uses & Applications",
  "Conceptual Edge Cases",
];

const MODEL_NAME = "gemini-4-hydrogen";

function sanitizeAssistantText(raw: string): string {
  return raw
    .replace(/\bgemini\b/gi, "AI")
    .replace(/\bgoogle\s*ai\b/gi, "AI Assistant");
}

export function getServerGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function buildSystemInstruction(params: ServerChatParams): string {
  const topicText = params.activeTopic
    ? `Active Main Topic: "${params.activeTopic}"${
        params.activeSubheading
          ? ` · Current Subheading: "${params.activeSubheading}"`
          : ""
      }${params.roomTitle ? ` (Lecture: "${params.roomTitle}")` : ""}.`
    : params.roomTitle
    ? `Current lecture session: "${params.roomTitle}" (no active topic broadcast yet).`
    : "User is in the PulsePoint - The Learning Portal lobby or reviewing a post-class report.";

  return [
    "You are the AI Assistant inside PulsePoint - The Learning Portal.",
    "Never identify yourself as Gemini or Google AI. Always refer to yourself simply as AI Assistant.",
    `Current context: User role = ${params.role}, screen = ${params.view}. ${topicText}`,
    "",
    "Guidelines:",
    "1. Academic, Coding, Math & Conceptual Clarity: Answer academic, coding, math, science, or portal workflow questions clearly with structured bullets, **bold key terms**, and concise fenced code blocks where helpful.",
    "2. Active Lecture Context: Tailor answers to the active Main Topic and Subheading when the user asks for intuition, real-world analogies, or practice questions.",
    "3. Formatting: Use crisp bullet points and clean fenced code blocks (```lang ... ```). Keep explanations scannable on mobile phones during class unless deeper detail is requested.",
    "4. Portal Features: Rotating 10-second QR & join codes (with 5s grace window) prevent proxy attendance while permanent room IDs keep connected students live; 3 student privacy modes (Anonymous, Teacher Only, Show to All); Lecture Notes upload/download; Post-Class Anonymous Doubt Portal; 1-page PDF report export.",
  ].join("\n");
}

export async function generateAssistantReply(
  ai: GoogleGenAI,
  params: ServerChatParams
): Promise<string> {
  const contents = [
    ...params.history.slice(-8).map((m) => ({
      role: m.role,
      parts: [{ text: m.text.slice(0, 1500) }],
    })),
    {
      role: "user" as const,
      parts: [{ text: params.message.slice(0, 1500) }],
    },
  ];

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents,
    config: {
      systemInstruction: buildSystemInstruction(params),
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.LOW,
      },
    },
  });

  const replyText = (response.text || "").trim();
  if (!replyText) {
    throw new Error("No response generated. Please try rephrasing your question.");
  }

  return sanitizeAssistantText(replyText);
}

export async function generateConceptualMcqPool(
  ai: GoogleGenAI,
  mainTopic: string,
  subheading: string
): Promise<GeneratedMcqItem[]> {
  const cleanTopic = mainTopic.trim() || "Current Lecture Topic";
  const cleanSub = subheading.trim();

  const prompt = [
    "Generate 16 conceptual multiple-choice questions for a live college/university lecture.",
    `Main Topic: "${cleanTopic}"`,
    cleanSub ? `Active Subheading: "${cleanSub}"` : "",
    "",
    "Distribute the 16 questions evenly (4 each) across these exact 4 category strings:",
    '1. "Meaning / Definition"',
    '2. "Formula / Principle"',
    '3. "Practical Uses & Applications"',
    '4. "Conceptual Edge Cases"',
    "",
    "Requirements:",
    "- Each question must test genuine conceptual understanding (not trivia).",
    "- Exactly 4 concise answer options per question.",
    "- `correctIndex` must be integer 0, 1, 2, or 3.",
    "- Vary `correctIndex` across questions (do not put every correct answer at index 0).",
    "- Include a 1-sentence `explanation` for each question.",
    "- Never refer to yourself as Gemini or Google AI.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.LOW,
      },
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: {
              type: Type.STRING,
              enum: CONCEPTUAL_CATEGORIES,
            },
            question: { type: Type.STRING },
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            correctIndex: { type: Type.INTEGER },
            explanation: { type: Type.STRING },
          },
          required: [
            "category",
            "question",
            "options",
            "correctIndex",
            "explanation",
          ],
        },
      },
    },
  });

  const jsonStr = (response.text || "").trim();
  if (!jsonStr) {
    throw new Error("AI Assistant returned an empty question set.");
  }

  const parsed = JSON.parse(jsonStr) as Array<{
    category?: string;
    question?: string;
    options?: string[];
    correctIndex?: number;
    explanation?: string;
  }>;

  if (!Array.isArray(parsed) || parsed.length < 5) {
    throw new Error("AI Assistant returned fewer than 5 questions. Please try again.");
  }

  const stamp = Date.now().toString(36).slice(-4);
  return parsed.slice(0, 20).map((item, idx) => {
    const opts = Array.isArray(item.options)
      ? item.options.map((o) => String(o).trim()).filter(Boolean)
      : [];
    while (opts.length < 4) {
      opts.push(`Option ${opts.length + 1}`);
    }
    const safeCategory = CONCEPTUAL_CATEGORIES.includes(
      item.category as ConceptualCategory
    )
      ? (item.category as ConceptualCategory)
      : CONCEPTUAL_CATEGORIES[idx % CONCEPTUAL_CATEGORIES.length];
    const safeCorrect =
      typeof item.correctIndex === "number" &&
      item.correctIndex >= 0 &&
      item.correctIndex < 4
        ? item.correctIndex
        : 0;

    return {
      id: `aiq_${stamp}_${idx + 1}`,
      category: safeCategory,
      question: sanitizeAssistantText(
        String(item.question || `Conceptual check #${idx + 1} on ${cleanTopic}`)
      ).slice(0, 240),
      options: [
        sanitizeAssistantText(opts[0]).slice(0, 140),
        sanitizeAssistantText(opts[1]).slice(0, 140),
        sanitizeAssistantText(opts[2]).slice(0, 140),
        sanitizeAssistantText(opts[3]).slice(0, 140),
      ],
      correctIndex: safeCorrect,
      explanation: sanitizeAssistantText(
        String(item.explanation || "Review the underlying rule and preconditions.")
      ).slice(0, 220),
    };
  });
}

export function mapAiRouteError(err: unknown): { status: number; error: string } {
  const rawMsg = err instanceof Error ? err.message : String(err || "");
  const lower = rawMsg.toLowerCase();

  const rawStatus =
    typeof (err as { status?: unknown })?.status === "number"
      ? (err as { status: number }).status
      : 500;

  if (
    rawStatus === 400 ||
    rawStatus === 403 ||
    lower.includes("api_key_invalid") ||
    lower.includes("permission_denied") ||
    lower.includes("api key not valid")
  ) {
    return {
      status: rawStatus === 403 ? 403 : 400,
      error:
        "The server AI API key appears invalid or lacks permission. Please verify it in Settings > Secrets.",
    };
  }

  if (rawStatus === 429 || lower.includes("resource_exhausted") || lower.includes("quota")) {
    return {
      status: 429,
      error:
        "AI rate limit reached right now. Please wait a moment and try again, or check your quota in Settings > Secrets.",
    };
  }

  if (rawStatus === 404 || lower.includes("not_found")) {
    return {
      status: 502,
      error: "AI model configuration error on server. Please contact support.",
    };
  }

  const sanitized = sanitizeAssistantText(rawMsg).trim();
  const safeStatus = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
  return {
    status: safeStatus,
    error: sanitized || "Unable to reach AI Assistant right now. Please try again.",
  };
}
