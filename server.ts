import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  generateAssistantReply,
  generateConceptualMcqPool,
  getServerGeminiClient,
  mapAiRouteError,
  type ServerChatHistoryMessage,
} from "./server/gemini.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";

interface ChatRequestBody {
  message?: unknown;
  history?: unknown;
  role?: unknown;
  activeTopic?: unknown;
  activeSubheading?: unknown;
  roomTitle?: unknown;
  view?: unknown;
}

interface QuizGenerateRequestBody {
  mainTopic?: unknown;
  subheading?: unknown;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const body = (req.body || {}) as ChatRequestBody;
      const rawMessage = typeof body.message === "string" ? body.message.trim() : "";

      if (!rawMessage) {
        res.status(400).json({ error: "Please enter a question before sending." });
        return;
      }

      if (rawMessage.length > 1500) {
        res
          .status(400)
          .json({ error: "Message is too long. Keep questions under 1500 characters." });
        return;
      }

      const ai = getServerGeminiClient();
      if (!ai) {
        res.status(503).json({
          error:
            "AI Assistant is unavailable because the server API key is not configured in Settings > Secrets.",
        });
        return;
      }

      const role =
        body.role === "teacher" || body.role === "student" ? body.role : "user";
      const view = typeof body.view === "string" ? body.view.slice(0, 40) : "lobby";
      const activeTopic =
        typeof body.activeTopic === "string" ? body.activeTopic.trim().slice(0, 140) : "";
      const activeSubheading =
        typeof body.activeSubheading === "string"
          ? body.activeSubheading.trim().slice(0, 140)
          : "";
      const roomTitle =
        typeof body.roomTitle === "string" ? body.roomTitle.trim().slice(0, 140) : "";

      const sanitizedHistory: ServerChatHistoryMessage[] = Array.isArray(body.history)
        ? body.history
            .filter(
              (item): item is ServerChatHistoryMessage =>
                Boolean(item) &&
                typeof item === "object" &&
                ((item as ServerChatHistoryMessage).role === "user" ||
                  (item as ServerChatHistoryMessage).role === "model") &&
                typeof (item as ServerChatHistoryMessage).text === "string" &&
                (item as ServerChatHistoryMessage).text.trim().length > 0
            )
            .slice(-8)
        : [];

      const reply = await generateAssistantReply(ai, {
        message: rawMessage,
        history: sanitizedHistory,
        role,
        view,
        activeTopic,
        activeSubheading,
        roomTitle,
      });

      res.json({ reply });
    } catch (err) {
      console.error("Error in /api/chat:", err);
      const mapped = mapAiRouteError(err);
      res.status(mapped.status).json({ error: mapped.error });
    }
  });

  app.post("/api/quiz/generate", async (req, res) => {
    try {
      const body = (req.body || {}) as QuizGenerateRequestBody;
      const mainTopic =
        typeof body.mainTopic === "string" ? body.mainTopic.trim().slice(0, 140) : "";
      const subheading =
        typeof body.subheading === "string" ? body.subheading.trim().slice(0, 140) : "";

      if (!mainTopic) {
        res.status(400).json({ error: "Please provide a topic to generate questions." });
        return;
      }

      const ai = getServerGeminiClient();
      if (!ai) {
        res.status(503).json({
          error:
            "Question generation is unavailable because the server API key is not configured in Settings > Secrets.",
        });
        return;
      }

      const questions = await generateConceptualMcqPool(ai, mainTopic, subheading);
      res.json({ questions });
    } catch (err) {
      console.error("Error in /api/quiz/generate:", err);
      const mapped = mapAiRouteError(err);
      res.status(mapped.status).json({ error: mapped.error });
    }
  });

  // Ensure unknown /api/* routes always return JSON rather than falling through to SPA HTML
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found." });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PulsePoint server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
