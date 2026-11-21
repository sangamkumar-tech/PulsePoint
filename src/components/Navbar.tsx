import { User } from "firebase/auth";
import {
  Activity,
  ArrowLeft,
  LogOut,
  Moon,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppView, ThemeMode } from "../types";

interface NavbarProps {
  user: User | null;
  recaptchaVerified: boolean;
  view: AppView;
  roomCode?: string;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onBackToLobby?: () => void;
  onSignOut: () => void;
}

export function Navbar({
  user,
  recaptchaVerified,
  view,
  roomCode,
  theme,
  onToggleTheme,
  onBackToLobby,
  onSignOut,
}: NavbarProps) {
  return (
    <header className="no-print sticky top-0 z-40 border-b pp-card-strong backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-4">
        {/* Zone 1: Brand wordmark */}
        <div className="flex items-center gap-2.5 min-w-0 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5 text-sky-400" />
          </div>
          <div className="min-w-0 leading-none">
            <div className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap">
              PulsePoint
            </div>
            <div className="text-[10px] sm:text-[11px] font-medium text-sky-400/90 tracking-wide whitespace-nowrap mt-0.5">
              The Learning Portal
            </div>
          </div>
        </div>

        {/* Zone 2: Context navigation */}
        <div className="hidden lg:flex items-center gap-4 text-sm text-slate-400 min-w-0">
          {user && recaptchaVerified && (
            <>
              <span className="whitespace-nowrap">
                {view === "lobby" && "Classroom Lobby"}
                {view === "teacher" && "Teacher Live Dashboard"}
                {view === "student" && "Student Live Session"}
                {view === "summary" && "Post-Class Summary"}
              </span>
              {roomCode && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-200 whitespace-nowrap">
                    {roomCode}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        {/* Zone 3: Theme switcher, reCAPTCHA Verified badge & user actions */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            title={
              theme === "slate"
                ? "Switch to Pure Black (OLED) Mode"
                : "Switch to Dark Slate Mode"
            }
            className="min-h-[38px] px-2.5 py-1.5 rounded-lg border pp-input hover:bg-slate-800/70 text-slate-200 text-xs font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            {theme === "slate" ? (
              <>
                <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="hidden sm:inline">Pitch Black</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="hidden sm:inline">Dark Slate</span>
              </>
            )}
          </button>

          {recaptchaVerified && (
            <div
              className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] sm:text-xs font-medium whitespace-nowrap shrink-0"
              title="Session protected and verified by Google reCAPTCHA Enterprise"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="hidden md:inline">reCAPTCHA Verified</span>
            </div>
          )}

          {user && recaptchaVerified && view !== "lobby" && onBackToLobby && (
            <button
              type="button"
              onClick={onBackToLobby}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-900/70 hover:bg-slate-800 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Lobby</span>
            </button>
          )}

          {user && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden xl:inline text-xs text-slate-400 max-w-[160px] truncate">
                {user.displayName || user.email}
              </span>
              <button
                type="button"
                onClick={onSignOut}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
