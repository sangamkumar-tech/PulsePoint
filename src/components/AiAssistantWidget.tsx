import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Bot,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { AppView } from "../types";
import { askAiAssistant } from "../utils/aiApi";
import { PULSEPOINT_FAQS, searchFaqs } from "../utils/aiKnowledgeBase";

interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
}

interface AiAssistantWidgetProps {
  view: AppView;
  activeTopic?: string;
  activeSubheading?: string;
  roomTitle?: string;
}

function renderInlineFormatting(text: string): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return tokens.map((token, idx) => {
    if (token.startsWith("`") && token.endsWith("`") && token.length >= 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-slate-900/90 border border-slate-700/80 font-mono text-[11px] text-sky-300"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith("**") && token.endsWith("**") && token.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-50">
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (token.startsWith("*") && token.endsWith("*") && token.length >= 3) {
      return (
        <em key={idx} className="italic text-slate-300">
          {token.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{token}</React.Fragment>;
  });
}

function renderFormattedReply(raw: string): React.ReactNode {
  const segments = raw.split(/(```[\s\S]*?```)/g);
  return (
    <div className="space-y-2 break-words">
      {segments.map((segment, segIdx) => {
        if (segment.startsWith("```") && segment.endsWith("```")) {
          const inner = segment.slice(3, -3).replace(/^\n/, "");
          const firstNewline = inner.indexOf("\n");
          const firstLine =
            firstNewline >= 0 ? inner.slice(0, firstNewline).trim() : "";
          const hasLangTag =
            firstNewline >= 0 && /^[a-zA-Z0-9_+-]{1,20}$/.test(firstLine);
          const codeBody = hasLangTag ? inner.slice(firstNewline + 1) : inner;

          return (
            <div
              key={segIdx}
              className="rounded-xl bg-slate-950/90 border border-slate-800 overflow-x-auto"
            >
              {hasLangTag && (
                <div className="px-2.5 py-1 border-b border-slate-800/80 text-[10px] font-mono uppercase tracking-wide text-slate-400">
                  {firstLine}
                </div>
              )}
              <pre className="p-2.5 text-[11px] font-mono text-sky-200 leading-relaxed whitespace-pre">
                <code>{codeBody.trimEnd()}</code>
              </pre>
            </div>
          );
        }

        const lines = segment.split("\n");
        const blocks: React.ReactNode[] = [];
        let listItems: string[] = [];

        const flushList = (keyPrefix: string) => {
          if (listItems.length === 0) return;
          blocks.push(
            <ul key={`${keyPrefix}-list`} className="space-y-1 pl-4 list-disc">
              {listItems.map((item, i) => (
                <li key={i} className="leading-relaxed">
                  {renderInlineFormatting(item)}
                </li>
              ))}
            </ul>
          );
          listItems = [];
        };

        lines.forEach((line, lineIdx) => {
          const trimmed = line.trim();
          const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
          if (bulletMatch) {
            listItems.push(bulletMatch[1]);
          } else {
            flushList(`${segIdx}-${lineIdx}`);
            if (trimmed.length > 0) {
              blocks.push(
                <p key={`${segIdx}-p-${lineIdx}`} className="leading-relaxed">
                  {renderInlineFormatting(trimmed)}
                </p>
              );
            }
          }
        });
        flushList(`${segIdx}-end`);

        return <React.Fragment key={segIdx}>{blocks}</React.Fragment>;
      })}
    </div>
  );
}

export function AiAssistantWidget({
  view,
  activeTopic = "",
  activeSubheading = "",
  roomTitle = "",
}: AiAssistantWidgetProps) {
  const [open, setOpen] = useState(false);
  const [showFaqDrawer, setShowFaqDrawer] = useState(false);
  const [faqQuery, setFaqQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const role: "student" | "teacher" | "user" =
    view === "student" ? "student" : view === "teacher" ? "teacher" : "user";

  const filteredFaqs = useMemo(() => searchFaqs(faqQuery), [faqQuery]);

  const suggestedPrompts =
    view === "student"
      ? [
          activeTopic
            ? `Explain "${activeTopic}" simply`
            : "Explain this topic simply",
          "Give me a real-world example",
          "How do I use the built-in webcam QR scanner?",
          "How do the 3 Student Identity Privacy Modes work?",
        ]
      : view === "teacher"
      ? [
          "How does the 10-second rotating QR & join code work?",
          "How do Main Topics and Subheadings work during a lecture?",
          "How does the AI 5-Question Conceptual Set generator work?",
          "How do I download the 1-Page Post-Class PDF Report?",
        ]
      : [
          "How do I host a live lecture on PulsePoint?",
          "How do I use the built-in webcam QR scanner?",
          "Why can only joined students view a class's notes, polls, and doubts?",
          "How do I download the 1-Page Post-Class PDF Report?",
        ];

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open, sending]);

  const sendMessage = async (textOverride?: string, faqId?: string) => {
    const clean = (textOverride ?? input).trim();
    if (!clean || sending) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      text: clean,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    if (!textOverride) {
      setInput("");
    }
    if (faqId) {
      setShowFaqDrawer(false);
    }
    setSending(true);

    try {
      const { reply } = await askAiAssistant({
        message: clean,
        history: messages.slice(-8).map((m) => ({
          role: m.role,
          text: m.text,
        })),
        role,
        view,
        activeTopic,
        activeSubheading,
        roomTitle,
        faqId,
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `m_${Date.now()}`,
          role: "model",
          text: reply,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="no-print fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <section
          aria-label="AI Assistant"
          className="w-[calc(100vw-2rem)] sm:w-[420px] max-h-[82vh] pp-card-strong backdrop-blur-xl border pp-accent-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Drawer Header */}
          <div className="px-4 py-3 border-b border-slate-800/90 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-sky-400" />
              </div>
              <div className="min-w-0">
                <div className="font-display text-sm font-bold text-slate-100 truncate">
                  AI Assistant
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {activeTopic
                    ? `${activeTopic}${activeSubheading ? ` · ${activeSubheading}` : ""}`
                    : view === "teacher"
                    ? "Academic & Teaching Assistant"
                    : "30-FAQ Knowledge Engine & Study Help"}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setShowFaqDrawer((v) => !v)}
                className={`px-2 py-1 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 transition-colors border ${
                  showFaqDrawer
                    ? "bg-sky-500/20 border-sky-400/50 text-sky-200"
                    : "bg-slate-900/70 border-slate-700/80 text-slate-300 hover:text-white"
                }`}
                title="Browse 30 Quick Help Topics"
              >
                <BookOpen className="w-3 h-3" />
                <span>30 FAQs</span>
                {showFaqDrawer ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMessages([])}
                  title="Clear chat"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close AI Assistant"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Searchable 30-Question Quick Help Topics Drawer */}
          {showFaqDrawer && (
            <div className="p-3 border-b border-slate-800/90 bg-slate-950/60 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-sky-300">
                  Quick Help Topics ({PULSEPOINT_FAQS.length} FAQs)
                </span>
                <span className="text-slate-400 tabular-nums">
                  {filteredFaqs.length} shown
                </span>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={faqQuery}
                  onChange={(e) => setFaqQuery(e.target.value)}
                  placeholder="Search 30 help topics (QR, privacy, 5 MCQs, PDF)..."
                  className="w-full min-h-[34px] pl-8 pr-3 py-1 rounded-lg pp-input border focus:border-sky-400 focus:outline-none text-xs text-slate-100 placeholder:text-slate-500"
                />
              </div>

              <div className="max-h-[180px] overflow-y-auto space-y-1.5 pr-1">
                {filteredFaqs.length === 0 ? (
                  <p className="text-[11px] text-slate-400 py-2 text-center">
                    No matching FAQ — type your question below to ask AI Assistant.
                  </p>
                ) : (
                  filteredFaqs.map((faq) => (
                    <button
                      key={faq.id}
                      type="button"
                      onClick={() => void sendMessage(faq.question, faq.id)}
                      className="w-full text-left px-2.5 py-2 rounded-xl pp-input hover:bg-slate-800 border hover:border-sky-500/50 transition-colors space-y-0.5"
                    >
                      <div className="text-[10px] font-semibold text-sky-400">
                        {faq.category}
                      </div>
                      <div className="text-xs text-slate-200 leading-snug">
                        {faq.question}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Messages Viewport */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 min-h-[220px] max-h-[380px]">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <div className="p-3 rounded-xl pp-input border text-xs text-slate-300 leading-relaxed">
                  <div className="flex items-center gap-1.5 font-semibold text-sky-300 mb-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Welcome to AI Assistant</span>
                  </div>
                  {view === "student" ? (
                    <span>
                      Ask anything about{" "}
                      <strong className="text-slate-100">
                        {activeTopic || "your current lecture"}
                      </strong>
                      , coding, or tap <strong className="text-sky-300">30 FAQs</strong>{" "}
                      above for instant PulsePoint help.
                    </span>
                  ) : (
                    <span>
                      Ask any academic, coding, or math question—or tap{" "}
                      <strong className="text-sky-300">30 FAQs</strong> above for
                      instant help with rotating QR codes, quizzes, notes, and PDF
                      reports.
                    </span>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-slate-400">
                    Suggested Questions
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => void sendMessage(prompt)}
                        className="text-left px-2.5 py-1.5 rounded-xl pp-input hover:bg-slate-800 border hover:border-sky-500/50 text-xs text-sky-200 transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${
                      m.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed break-words ${
                        m.role === "user"
                          ? "pp-primary-btn text-white whitespace-pre-wrap"
                          : "pp-input border text-slate-200"
                      }`}
                    >
                      {m.role === "user"
                        ? m.text
                        : renderFormattedReply(m.text)}
                    </div>
                  </div>
                ))}

                {sending && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl px-3.5 py-2.5 pp-input border text-xs text-slate-400 inline-flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                      <span>Thinking...</span>
                    </div>
                  </div>
                )}

                {messages.length > 0 && !sending && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {suggestedPrompts.slice(0, 2).map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => void sendMessage(prompt)}
                        className="px-2.5 py-1 rounded-lg pp-input hover:bg-slate-800 border text-[11px] text-slate-300 transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Form */}
          <form
            onSubmit={(e: React.FormEvent) => {
              e.preventDefault();
              void sendMessage();
            }}
            className="p-3 border-t border-slate-800/90 flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                view === "student" && activeTopic
                  ? `Ask about ${activeTopic} or any PulsePoint topic...`
                  : "Ask any study, coding, or PulsePoint question..."
              }
              maxLength={1500}
              className="flex-1 min-w-0 min-h-[40px] px-3 py-2 rounded-xl pp-input border focus:border-sky-400 focus:outline-none text-xs text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message"
              className="min-h-[40px] min-w-[40px] px-3 rounded-xl pp-primary-btn disabled:opacity-50 text-white flex items-center justify-center transition-colors shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </section>
      )}

      {/* Floating Toggle Button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="min-h-[48px] px-4 py-2.5 rounded-full pp-primary-btn text-white text-xs sm:text-sm font-semibold shadow-xl shadow-sky-950/50 border border-sky-400/40 flex items-center gap-2 transition-transform active:scale-95"
      >
        <MessageSquare className="w-4 h-4 shrink-0" />
        <span>💬 AI Assistant</span>
      </button>
    </div>
  );
}
