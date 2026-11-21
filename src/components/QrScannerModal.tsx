import React, { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import {
  AlertCircle,
  Camera,
  ImagePlus,
  RefreshCw,
  X,
} from "lucide-react";
import { normalizeRoomCode } from "../utils/roomUtils";

interface QrScannerModalProps {
  open: boolean;
  onClose: () => void;
  onCodeDetected: (code: string) => void;
}

export function extractJoinCodeFromQrPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.includes("://") || trimmed.includes("?")) {
      const url = new URL(
        trimmed.startsWith("http") ? trimmed : `https://pulsepoint.app/${trimmed.replace(/^\//, "")}`
      );
      const param = url.searchParams.get("code") || url.searchParams.get("room");
      if (param) {
        const clean = normalizeRoomCode(param);
        if (clean.length === 6) return clean;
      }
    }
  } catch {
    // Fall back to regex extraction
  }

  const queryMatch = trimmed.match(/(?:code|room)=([A-Za-z0-9-]{6,7})/i);
  if (queryMatch) {
    const clean = normalizeRoomCode(queryMatch[1]);
    if (clean.length === 6) return clean;
  }

  const direct = normalizeRoomCode(trimmed);
  if (direct.length === 6) return direct;

  const embedded = trimmed.match(/\b([A-Za-z0-9]{2}-?[A-Za-z0-9]{4})\b/);
  if (embedded) {
    const clean = normalizeRoomCode(embedded[1]);
    if (clean.length === 6) return clean;
  }

  return null;
}

export function QrScannerModal({
  open,
  onClose,
  onCodeDetected,
}: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectedRef = useRef(false);

  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [manualInput, setManualInput] = useState("");

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }

    let cancelled = false;
    detectedRef.current = false;
    setCameraError(null);
    setCameraReady(false);

    const startScanner = async () => {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        setCameraError(
          "Camera access is unavailable in this browser/preview. Upload a QR screenshot or enter the 6-character code below."
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setCameraReady(true);

        let lastScanMs = 0;
        const scanFrame = (timestamp: number) => {
          if (cancelled || detectedRef.current) return;
          if (timestamp - lastScanMs >= 110 && video.readyState >= 2) {
            lastScanMs = timestamp;
            const width = video.videoWidth;
            const height = video.videoHeight;
            const canvas = canvasRef.current;
            if (canvas && width > 0 && height > 0) {
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(video, 0, 0, width, height);
                const imgData = ctx.getImageData(0, 0, width, height);
                const decoded = jsQR(imgData.data, width, height, {
                  inversionAttempts: "dontInvert",
                });
                if (decoded?.data) {
                  const code = extractJoinCodeFromQrPayload(decoded.data);
                  if (code) {
                    detectedRef.current = true;
                    stopCamera();
                    onCodeDetected(code);
                    return;
                  }
                }
              }
            }
          }
          rafRef.current = requestAnimationFrame(scanFrame);
        };

        rafRef.current = requestAnimationFrame(scanFrame);
      } catch {
        if (!cancelled) {
          setCameraError(
            "Camera permission was blocked or no camera was detected. You can upload a QR screenshot or type the 6-character code below."
          );
        }
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, facingMode, onCodeDetected, stopCamera]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCameraError(null);

    const objectUrl = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Could not read image."));
        img.src = objectUrl;
      });

      const canvas = canvasRef.current || document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas unavailable.");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(data.data, canvas.width, canvas.height);
      const code = decoded?.data ? extractJoinCodeFromQrPayload(decoded.data) : null;
      if (!code) {
        setCameraError("No valid PulsePoint QR code found in that image. Please try again.");
        return;
      }
      stopCamera();
      onCodeDetected(code);
    } catch {
      setCameraError("Could not decode QR image. Try another screenshot or enter the code.");
    } finally {
      URL.revokeObjectURL(objectUrl);
      e.target.value = "";
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="max-w-md w-full pp-card-strong border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <Camera className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-slate-100">
                Scan Classroom QR Code
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                Point your camera at the instructor&apos;s projected QR
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close QR scanner"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Camera Viewfinder */}
          <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-[4/3] flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`w-full h-full object-cover ${
                cameraReady ? "opacity-100" : "opacity-0"
              }`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {cameraReady && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
              >
                <div className="w-48 h-48 rounded-2xl border-2 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(2,6,23,0.45)]" />
              </div>
            )}

            {!cameraReady && !cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-slate-400 px-4 text-center">
                <Camera className="w-6 h-6 text-emerald-400" />
                <span>Starting camera viewfinder...</span>
              </div>
            )}
          </div>

          {cameraError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs leading-relaxed">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>{cameraError}</span>
            </div>
          )}

          {/* Camera Controls & QR Screenshot Upload */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setFacingMode((prev) =>
                  prev === "environment" ? "user" : "environment"
                )
              }
              className="flex-1 min-h-[42px] px-3 py-2 rounded-xl pp-input border hover:border-slate-600 text-xs font-medium text-slate-200 inline-flex items-center justify-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
              <span>Flip Camera</span>
            </button>

            <label className="flex-1 min-h-[42px] px-3 py-2 rounded-xl pp-input border hover:border-emerald-500/60 text-xs font-medium text-emerald-200 inline-flex items-center justify-center gap-1.5 cursor-pointer">
              <ImagePlus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Upload QR Image</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="sr-only"
              />
            </label>
          </div>

          {/* Quick Manual Code Fallback inside Modal */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const clean = normalizeRoomCode(manualInput);
              if (clean.length === 6) {
                stopCamera();
                onCodeDetected(clean);
              }
            }}
            className="flex items-center gap-2 pt-2 border-t border-slate-800/80"
          >
            <input
              type="text"
              value={manualInput}
              onChange={(e) => {
                const clean = normalizeRoomCode(e.target.value);
                setManualInput(
                  clean.length > 2 ? `${clean.slice(0, 2)}-${clean.slice(2)}` : clean
                );
              }}
              maxLength={7}
              placeholder="Or enter code: CS-8492"
              className="flex-1 min-h-[42px] px-3 py-2 rounded-xl pp-input border focus:border-emerald-400 focus:outline-none font-mono text-sm text-center uppercase text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={normalizeRoomCode(manualInput).length !== 6}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold"
            >
              Join
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
