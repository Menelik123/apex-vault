"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Button } from "@/components/ui/button";

interface BarcodeScannerProps {
  onScan: (result: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [status, setStatus] = useState<"scanning" | "success" | "error">("scanning");
  const [scannedValue, setScannedValue] = useState("");

  useEffect(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const reader = new BrowserMultiFormatReader(hints);
    readerRef.current = reader;

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current!,
        (result, err) => {
          if (result) {
            const text = result.getText();
            setScannedValue(text);
            setStatus("success");
            reader.reset();
            setTimeout(() => onScan(text), 800);
          }
          if (err && !(err.message?.includes("No MultiFormat"))) {
            // suppress normal "not found yet" errors
          }
        }
      )
      .catch(() => setStatus("error"));

    return () => {
      reader.reset();
    };
  }, [onScan]);

  const borderColor =
    status === "success" ? "border-green-500 shadow-lg shadow-green-500/30" :
    status === "error"   ? "border-red-500" :
                           "border-red-400";

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-muted-foreground text-center">
        Point camera at the barcode on the shoe box
      </p>

      {/* Clean single camera view */}
      <div className={`w-full rounded-xl border-4 overflow-hidden transition-all duration-300 ${borderColor}`}>
        <video
          ref={videoRef}
          className="w-full h-auto block"
          autoPlay
          muted
          playsInline
        />
      </div>

      {/* Status */}
      <p className={`text-sm font-semibold text-center transition-colors duration-300 ${
        status === "success" ? "text-green-600" :
        status === "error"   ? "text-red-500" :
                               "text-muted-foreground"
      }`}>
        {status === "success" && `✓ Got it — ${scannedValue}`}
        {status === "error"   && "✗ Camera failed. Check permissions."}
        {status === "scanning" && "Searching..."}
      </p>

      {/* Scanning bar animation */}
      {status === "scanning" && (
        <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-1/3 bg-red-400 rounded-full" style={{ animation: "scan 1.5s ease-in-out infinite" }} />
        </div>
      )}
      {status === "success" && (
        <div className="w-full h-1 rounded-full bg-green-500" />
      )}

      <Button type="button" variant="outline" className="w-full" onClick={onClose}>
        Cancel
      </Button>
    </div>
  );
}
