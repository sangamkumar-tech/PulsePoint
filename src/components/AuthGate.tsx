import React, { useState } from "react";
import { User } from "firebase/auth";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import {
  auth,
  createUserWithEmailAndPassword,
  googleProvider,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "../firebase";
import { executeRecaptchaEnterprise } from "../recaptcha";

interface AuthGateProps {
  existingUser: User | null;
  recaptchaVerified: boolean;
  verifyingExistingSession: boolean;
  onRecaptchaVerified: () => void;
  onEmailVerifiedCheck: () => Promise<boolean>;
  onSignOut: () => void;
}

export function AuthGate({
  existingUser,
  recaptchaVerified,
  verifyingExistingSession,
  onRecaptchaVerified,
  onEmailVerifiedCheck,
  onSignOut,
}: AuthGateProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);

  const mapAuthError = (err: unknown): string => {
    if (err instanceof Error) {
      const msg = err.message;
      if (msg.includes("auth/invalid-credential") || msg.includes("auth/wrong-password")) {
        return "Invalid email or password. Please check your credentials and try again.";
      }
      if (msg.includes("auth/user-not-found")) {
        return "No account found with that email. Switch to Create Account to register.";
      }
      if (msg.includes("auth/email-already-in-use")) {
        return "An account with this email already exists. Please sign in instead.";
      }
      if (msg.includes("auth/weak-password")) {
        return "Password should be at least 6 characters long.";
      }
      if (msg.includes("auth/unauthorized-domain")) {
        const host =
          typeof window !== "undefined" ? window.location.hostname : "this domain";
        return `Domain "${host}" is not authorized in Firebase Authentication yet. Add it in Firebase Console → Authentication → Settings → Authorized domains.`;
      }
      if (msg.includes("auth/popup-blocked")) {
        return "Browser blocked the Google sign-in popup. Allow popups or sign in with Email & Password.";
      }
      if (msg.includes("auth/popup-closed-by-user")) {
        return "Google sign-in popup was closed before completing authentication.";
      }
      if (msg.includes("auth/too-many-requests")) {
        return "Too many verification requests. Please wait a minute before trying again.";
      }
      if (msg.includes("auth/operation-not-allowed")) {
        return "This sign-in provider is not enabled in Firebase Authentication for pulsepoint-effeb.";
      }
      return msg;
    }
    return "Authentication failed. Please try again.";
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerificationNotice(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setLoading(true);
    try {
      setStatusMessage("Verifying Google reCAPTCHA Enterprise...");
      await executeRecaptchaEnterprise(mode === "signin" ? "LOGIN" : "SIGNUP");
      onRecaptchaVerified();

      setStatusMessage(
        mode === "signin" ? "Signing in with Firebase..." : "Creating account & sending verification email..."
      );
      if (mode === "signin") {
        const cred = await signInWithEmailAndPassword(auth, trimmedEmail, password);
        if (!cred.user.emailVerified) {
          setVerificationNotice(
            "Your email address is not verified yet. Please click the verification link in your inbox."
          );
        }
      } else {
        const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        if (name.trim()) {
          await updateProfile(cred.user, { displayName: name.trim() });
        }
        await sendEmailVerification(cred.user);
        setVerificationNotice(
          `Verification link sent to ${trimmedEmail}. Click the link in your email before continuing.`
        );
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
      setStatusMessage(null);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setVerificationNotice(null);
    setLoading(true);
    try {
      setStatusMessage("Verifying Google reCAPTCHA Enterprise...");
      await executeRecaptchaEnterprise("LOGIN");
      onRecaptchaVerified();

      setStatusMessage("Connecting with Google Account...");
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
      setStatusMessage(null);
    }
  };

  const handleVerifyExistingSession = async () => {
    setError(null);
    setLoading(true);
    try {
      setStatusMessage("Running reCAPTCHA Enterprise security check...");
      await executeRecaptchaEnterprise("SESSION_VERIFY");
      onRecaptchaVerified();
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
      setStatusMessage(null);
    }
  };

  const handleCheckEmailVerification = async () => {
    setError(null);
    setVerificationNotice(null);
    setLoading(true);
    try {
      const verified = await onEmailVerifiedCheck();
      if (!verified) {
        setError(
          "Your email is still unverified. Click the verification link in your inbox (check Spam/Junk too), then try again."
        );
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!auth.currentUser) return;
    setError(null);
    setVerificationNotice(null);
    setLoading(true);
    try {
      await sendEmailVerification(auth.currentUser);
      setVerificationNotice(
        `A fresh verification email has been sent to ${auth.currentUser.email}.`
      );
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  // Case 1: Signed in via Email/Password, but email address has NOT been verified yet
  if (existingUser && !existingUser.emailVerified) {
    return (
      <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full pp-card backdrop-blur-xl border rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <Mail className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold text-slate-100">
                Verify Your Email to Continue
              </h1>
              <p className="text-xs text-slate-400 truncate max-w-[260px]">
                {existingUser.email}
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-300 leading-relaxed">
            Access to PulsePoint classroom sessions is blocked until you confirm
            ownership of your email address. Open the verification link sent by
            Firebase to <span className="font-semibold text-slate-100">{existingUser.email}</span>,
            then click the button below.
          </p>

          {verificationNotice && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs leading-relaxed">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{verificationNotice}</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs leading-relaxed">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              disabled={loading}
              onClick={handleCheckEmailVerification}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl pp-primary-btn disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span>I&apos;ve Verified My Email — Continue</span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={handleResendVerification}
              className="w-full min-h-[42px] px-4 py-2 rounded-xl border border-slate-700 bg-slate-800/70 hover:bg-slate-800 disabled:opacity-60 text-slate-200 text-xs font-medium transition-colors"
            >
              Resend Verification Email
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={onSignOut}
              className="w-full min-h-[42px] px-4 py-2 rounded-xl border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors"
            >
              Switch Account / Sign Out
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Case 2: Signed in & email verified via persisted Firebase session, awaiting reCAPTCHA verification
  if (existingUser && !recaptchaVerified) {
    return (
      <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full pp-card backdrop-blur-xl border rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-100">
                Security Verification Required
              </h1>
              <p className="text-xs text-slate-400 truncate max-w-[260px]">
                {existingUser.email}
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-300 leading-relaxed">
            Your Firebase session is active. Complete Google reCAPTCHA Enterprise
            verification before entering classroom sessions.
          </p>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs leading-relaxed">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              disabled={loading || verifyingExistingSession}
              onClick={handleVerifyExistingSession}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl pp-primary-btn disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>
                {loading || verifyingExistingSession
                  ? statusMessage || "Verifying..."
                  : "Verify with reCAPTCHA Enterprise"}
              </span>
            </button>

            <button
              type="button"
              onClick={onSignOut}
              className="w-full min-h-[42px] px-4 py-2 rounded-xl border border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors"
            >
              Switch Account / Sign Out
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 sm:px-6 py-8 lg:py-12">
      <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-stretch">
        {/* Left column: Hero visual & value proposition */}
        <section className="lg:col-span-7 relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between min-h-[300px] lg:min-h-[580px]">
          <img
            src="/src/assets/images/lecture_hall_pulse_1795277934246.jpg"
            alt="University lecture hall with real-time comprehension data waves"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-55"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-slate-950/30" />

          <div className="relative z-10 p-6 sm:p-8 flex flex-wrap items-center gap-2.5 text-xs text-slate-300">
            <Activity className="w-4 h-4 text-sky-400" />
            <span className="font-semibold text-slate-100">
              PulsePoint - The Learning Portal
            </span>
            <span aria-hidden="true">·</span>
            <span>100+ Concurrent Students</span>
          </div>

          <div className="relative z-10 p-6 sm:p-8 space-y-5">
            <h1 className="font-display text-2xl sm:text-4xl font-bold text-slate-50 tracking-tight text-balance leading-tight">
              Know the exact moment confusion spikes in your lecture.
            </h1>
            <p className="text-sm sm:text-base text-slate-300 max-w-xl leading-relaxed">
              PulsePoint gives 80+ students an anonymous, zero-friction way to
              signal comprehension and vote in live micro-polls—while giving
              instructors a real-time topic timeline and post-class review report.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-800/80 text-xs">
              <div>
                <div className="font-semibold text-slate-100">100% Anonymous</div>
                <div className="text-slate-400 mt-0.5">
                  Verified logins block bots while keeping student feedback private.
                </div>
              </div>
              <div>
                <div className="font-semibold text-slate-100">Spike Detection</div>
                <div className="text-slate-400 mt-0.5">
                  Flags exact timestamps and topics when confusion crosses 30%.
                </div>
              </div>
              <div>
                <div className="font-semibold text-slate-100">Post-Class Report</div>
                <div className="text-slate-400 mt-0.5">
                  Ranks topics to revisit and breaks down micro-poll accuracy.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right column: Strict Auth Gate Card */}
        <section className="lg:col-span-5 pp-card backdrop-blur-xl border rounded-2xl p-6 sm:p-8 flex flex-col justify-center">
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-sky-400 mb-2">
                <Lock className="w-3.5 h-3.5" />
                <span>Authenticated Access Only</span>
              </div>
              <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-100">
                {mode === "signin"
                  ? "Sign in to PulsePoint - The Learning Portal"
                  : "Join PulsePoint - The Learning Portal"}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Verify with Google reCAPTCHA Enterprise and Firebase Auth to host
                or join a live classroom session.
              </p>
            </div>

            {/* Segmented Mode Toggle */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl pp-input border">
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
                className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  mode === "signin"
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  mode === "signup"
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Create Account
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs leading-relaxed">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleEmailAuth} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-name"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Full Name (optional)
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="auth-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Prof. Ada Lovelace"
                      maxLength={80}
                      className="w-full min-h-[48px] pl-10 pr-3.5 py-2.5 rounded-xl pp-input text-sm text-slate-100 placeholder:text-slate-600"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="auth-email"
                  className="block text-xs font-medium text-slate-300"
                >
                  University or Work Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                    className="w-full min-h-[48px] pl-10 pr-3.5 py-2.5 rounded-xl pp-input text-sm text-slate-100 placeholder:text-slate-600"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-medium text-slate-300"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full min-h-[48px] pl-10 pr-3.5 py-2.5 rounded-xl pp-input text-sm text-slate-100 placeholder:text-slate-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[48px] px-4 py-2.5 rounded-xl pp-primary-btn disabled:opacity-60 text-white text-sm font-semibold transition-colors"
              >
                {loading
                  ? statusMessage || "Verifying..."
                  : mode === "signin"
                  ? "Verify & Sign In"
                  : "Verify & Create Account"}
              </button>
            </form>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-slate-800" />
              <span className="shrink mx-3 text-xs text-slate-500">or</span>
              <div className="flex-grow border-t border-slate-800" />
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={handleGoogleSignIn}
              className="w-full min-h-[48px] px-4 py-2.5 rounded-xl pp-input hover:bg-slate-800/80 disabled:opacity-60 text-slate-100 text-sm font-medium transition-colors flex items-center justify-center gap-2.5"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500 pt-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80 shrink-0" />
              <span>
                Protected by Google reCAPTCHA Enterprise · No guest access
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
