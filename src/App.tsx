import { useCallback, useEffect, useRef, useState } from "react";
import { User } from "firebase/auth";
import { Loader2 } from "lucide-react";
import { AiAssistantWidget } from "./components/AiAssistantWidget";
import { AuthGate } from "./components/AuthGate";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Navbar } from "./components/Navbar";
import { RoleLobby } from "./components/RoleLobby";
import { StudentView } from "./components/StudentView";
import { SummaryReport } from "./components/SummaryReport";
import { TeacherDashboard } from "./components/TeacherDashboard";
import {
  auth,
  db,
  deleteDoc,
  doc,
  getDoc,
  onAuthStateChanged,
  signOut,
  testConnection,
  updateDoc,
} from "./firebase";
import { executeRecaptchaEnterprise } from "./recaptcha";
import { AppView, ReportDoc, RoomDoc, ThemeMode } from "./types";

const THEME_STORAGE_KEY = "pulsepoint_theme";

function PulsePointApp() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [recaptchaVerified, setRecaptchaVerified] = useState(false);
  const [verifyingExistingSession, setVerifyingExistingSession] = useState(false);
  const [, setVerificationTick] = useState(0);

  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "slate";
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "black" ? "black" : "slate";
  });

  const [view, setView] = useState<AppView>("lobby");
  const [activeRoomCode, setActiveRoomCode] = useState<string>("");
  const [preloadedReport, setPreloadedReport] = useState<ReportDoc | null>(null);
  const [reportMode, setReportMode] = useState<"teacher" | "student">("teacher");
  const [accessNotice, setAccessNotice] = useState<string | null>(null);
  const [roomContext, setRoomContext] = useState<{
    activeTopic: string;
    activeSubheading?: string;
    roomTitle: string;
  }>({ activeTopic: "", activeSubheading: "", roomTitle: "" });

  const handleRoomContextChange = useCallback(
    (ctx: { activeTopic: string; activeSubheading?: string; roomTitle: string }) => {
      setRoomContext((prev) =>
        prev.activeTopic === ctx.activeTopic &&
        (prev.activeSubheading || "") === (ctx.activeSubheading || "") &&
        prev.roomTitle === ctx.roomTitle
          ? prev
          : ctx
      );
    },
    []
  );

  const [initialRoomParam] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("code") || params.get("room") || "";
  });

  const recaptchaVerifiedRef = useRef(false);
  recaptchaVerifiedRef.current = recaptchaVerified;

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "black") {
      root.setAttribute("data-theme", "black");
    } else {
      root.removeAttribute("data-theme");
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    void testConnection();
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      if (!nextUser || nextUser.isAnonymous) {
        setUser(null);
        setRecaptchaVerified(false);
        setView("lobby");
        setActiveRoomCode("");
        setPreloadedReport(null);
        setAuthReady(true);
        return;
      }

      setUser(nextUser);
      setAuthReady(true);

      if (!recaptchaVerifiedRef.current) {
        setVerifyingExistingSession(true);
        try {
          await executeRecaptchaEnterprise("SESSION_VERIFY");
          setRecaptchaVerified(true);
        } catch {
          setRecaptchaVerified(false);
        } finally {
          setVerifyingExistingSession(false);
        }
      }
    });

    return () => unsub();
  }, []);

  const handleSignOut = async () => {
    if (view === "teacher" && activeRoomCode) {
      try {
        const roomSnap = await getDoc(doc(db, "rooms", activeRoomCode));
        const activeCode = roomSnap.exists()
          ? (roomSnap.data() as RoomDoc).activeJoinCode
          : null;
        await Promise.allSettled([
          updateDoc(doc(db, "rooms", activeRoomCode), {
            activeJoinCode: null,
            previousJoinCode: null,
            codeExpiresAt: 0,
            validJoinCodes: [],
          }),
          ...(activeCode && activeCode !== activeRoomCode
            ? [deleteDoc(doc(db, "joinCodes", activeCode))]
            : []),
        ]);
      } catch {
        // Non-blocking cleanup before sign-out
      }
    }
    await signOut(auth);
    setRecaptchaVerified(false);
    setView("lobby");
    setActiveRoomCode("");
    setPreloadedReport(null);
  };

  const handleBackToLobby = () => {
    setView("lobby");
    setActiveRoomCode("");
    setPreloadedReport(null);
    setRoomContext({ activeTopic: "", activeSubheading: "", roomTitle: "" });
  };

  const handleAccessDenied = useCallback((message: string) => {
    setAccessNotice(message);
    setView("lobby");
    setActiveRoomCode("");
    setPreloadedReport(null);
    setRoomContext({ activeTopic: "", activeSubheading: "", roomTitle: "" });
  }, []);

  const handleRefreshVerifiedUser = async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    setUser(auth.currentUser);
    setVerificationTick((n) => n + 1);
    return Boolean(auth.currentUser.emailVerified);
  };

  const isFullyVerified = Boolean(
    user && !user.isAnonymous && user.emailVerified && recaptchaVerified
  );

  return (
    <div className="min-h-screen pp-canvas text-slate-100 relative overflow-x-hidden transition-colors duration-200">
      {/* Subtle ambient radial backdrop */}
      <div
        aria-hidden="true"
        className="no-print pointer-events-none fixed inset-0 pp-glow"
      />

      <Navbar
        user={user}
        recaptchaVerified={isFullyVerified}
        view={view}
        roomCode={activeRoomCode || undefined}
        theme={theme}
        onToggleTheme={() =>
          setTheme((prev) => (prev === "slate" ? "black" : "slate"))
        }
        onBackToLobby={handleBackToLobby}
        onSignOut={handleSignOut}
      />

      <div className="relative z-10">
        {!authReady ? (
          <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-6">
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
              <span>Checking verified session...</span>
            </div>
          </main>
        ) : !isFullyVerified ? (
          <AuthGate
            existingUser={user}
            recaptchaVerified={recaptchaVerified}
            verifyingExistingSession={verifyingExistingSession}
            onRecaptchaVerified={() => setRecaptchaVerified(true)}
            onEmailVerifiedCheck={handleRefreshVerifiedUser}
            onSignOut={handleSignOut}
          />
        ) : (
          <>
            {view === "lobby" && user && (
              <RoleLobby
                user={user}
                initialRoomCode={initialRoomParam}
                accessNotice={accessNotice}
                onClearAccessNotice={() => setAccessNotice(null)}
                onEnterTeacher={(code) => {
                  setAccessNotice(null);
                  setPreloadedReport(null);
                  setActiveRoomCode(code);
                  setView("teacher");
                }}
                onEnterStudent={(code) => {
                  setAccessNotice(null);
                  setPreloadedReport(null);
                  setActiveRoomCode(code);
                  setView("student");
                }}
                onOpenSummary={(code, mode) => {
                  setAccessNotice(null);
                  setPreloadedReport(null);
                  setReportMode(mode);
                  setActiveRoomCode(code);
                  setView("summary");
                }}
              />
            )}

            {view === "teacher" && user && activeRoomCode && (
              <TeacherDashboard
                roomCode={activeRoomCode}
                user={user}
                onRoomContextChange={handleRoomContextChange}
                onSessionEnded={(code, report) => {
                  setPreloadedReport(report ?? null);
                  setReportMode("teacher");
                  setActiveRoomCode(code);
                  setRoomContext({
                    activeTopic: "",
                    activeSubheading: "",
                    roomTitle: report?.title || "",
                  });
                  setView("summary");
                }}
                onBackToLobby={handleBackToLobby}
                onAccessDenied={handleAccessDenied}
              />
            )}

            {view === "student" && user && activeRoomCode && (
              <StudentView
                roomCode={activeRoomCode}
                user={user}
                onRoomContextChange={handleRoomContextChange}
                onBackToLobby={handleBackToLobby}
                onAccessDenied={handleAccessDenied}
                onViewStudentSummary={(code) => {
                  setPreloadedReport(null);
                  setReportMode("student");
                  setActiveRoomCode(code);
                  setRoomContext({
                    activeTopic: "",
                    activeSubheading: "",
                    roomTitle: "",
                  });
                  setView("summary");
                }}
              />
            )}

            {view === "summary" && user && activeRoomCode && (
              <SummaryReport
                roomCode={activeRoomCode}
                user={user}
                mode={reportMode}
                preloadedReport={preloadedReport}
                onBackToLobby={handleBackToLobby}
                onAccessDenied={handleAccessDenied}
              />
            )}

            <AiAssistantWidget
              view={view}
              activeTopic={roomContext.activeTopic}
              activeSubheading={roomContext.activeSubheading}
              roomTitle={roomContext.roomTitle}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <PulsePointApp />
    </ErrorBoundary>
  );
}
