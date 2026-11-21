import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeBoxProps {
  roomCode: string;
  size?: number;
  queryParam?: "code" | "room";
  secondsRemaining?: number;
}

export function QrCodeBox({
  roomCode,
  size = 160,
  queryParam = "code",
  secondsRemaining,
}: QrCodeBoxProps) {
  const [dataUrl, setDataUrl] = useState<string>("");

  const joinUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/?${queryParam}=${roomCode}`
      : `?${queryParam}=${roomCode}`;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(joinUrl, {
      width: size,
      margin: 2,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl("");
      });
    return () => {
      active = false;
    };
  }, [joinUrl, size]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-xl bg-white/95 flex items-center justify-center text-xs text-slate-600"
      >
        Generating QR...
      </div>
    );
  }

  const pct =
    secondsRemaining !== undefined
      ? Math.max(0, Math.min(100, (secondsRemaining / 10) * 100))
      : null;

  return (
    <div className="inline-flex flex-col items-center gap-2 p-2.5 rounded-2xl bg-white border border-slate-200 shadow-sm">
      <img
        src={dataUrl}
        alt={`QR code to join room ${roomCode}`}
        width={size}
        height={size}
        className="rounded-lg block"
      />
      <div className="w-full space-y-1 text-center">
        <span className="font-mono text-[11px] font-semibold text-slate-700 block">
          ?{queryParam}={roomCode}
        </span>
        {pct !== null && (
          <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                secondsRemaining !== undefined && secondsRemaining <= 3
                  ? "bg-amber-500"
                  : "bg-sky-600"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
