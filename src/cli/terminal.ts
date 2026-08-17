import type { Writer } from "./output.js";

const ESC = "\x1b[";

export type ProgressMode = "text" | "image" | "audio";
export type TimeUnit = "auto" | "ms" | "s";

export function colorize(value: string, code: number, enabled: boolean) {
  return enabled ? `${ESC}${code}m${value}${ESC}0m` : value;
}

export function colorizeHex(value: string, hex: string | undefined, enabled: boolean) {
  const match = String(hex || "").trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!enabled || !match) return value;
  const [, r, g, b] = match;
  return `${ESC}38;2;${Number.parseInt(r, 16)};${Number.parseInt(g, 16)};${Number.parseInt(b, 16)}m${value}${ESC}0m`;
}

export function createProgress(writer: Writer, enabled: boolean, color: boolean, intervalMs = 120, mode: ProgressMode = "text") {
  let phase = "Preparing";
  let started = monotonicNow();
  let frame = 0;
  let highestStage = 0;
  let uploadPercent: number | undefined;
  let timer: NodeJS.Timeout | undefined;

  const render = () => {
    if (!enabled) return;
    const elapsed = Math.max(0, monotonicNow() - started);
    const cells = progressCells(mode, highestStage, frame, color, uploadPercent, phase);
    writer(`\r\x1b[2KFactLens  ${mode.toUpperCase().padEnd(5)}  ${formatDuration(elapsed, "s").padStart(6)}   ${cells}`);
    frame = (frame + 1) % 4;
  };

  return {
    start(nextPhase = "Preparing") {
      phase = nextPhase;
      started = monotonicNow();
      highestStage = stageFor(mode, nextPhase);
      if (!enabled || timer) return;
      render();
      timer = setInterval(render, Math.max(10, intervalMs));
      timer.unref?.();
    },
    update(nextPhase: string) {
      phase = nextPhase;
      highestStage = Math.max(highestStage, stageFor(mode, nextPhase));
      if (/complete|result/i.test(nextPhase)) highestStage = maxStage(mode) + 1;
      render();
    },
    upload(progress: { percent?: number } | number) {
      const value = typeof progress === "number" ? progress : progress.percent;
      if (Number.isFinite(value)) uploadPercent = Math.min(100, Math.max(0, Number(value)));
      highestStage = Math.max(highestStage, 1);
      phase = "Uploading audio";
      render();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (enabled) writer("\r\x1b[2K");
    },
  };
}

function progressCells(mode: ProgressMode, stage: number, frame: number, color: boolean, uploadPercent: number | undefined, phase: string) {
  if (mode === "audio") return audioCells(stage, frame, color, uploadPercent, phase);
  const labels = mode === "image" ? ["Image loaded", "Verifying image", "Result"] : ["Sent", "Verifying", "Result"];
  return labels.map((label, index) => cell(label, index, stage, frame, color)).join(` ${colorize("━━━", 36, color)} `);
}

function audioCells(stage: number, frame: number, color: boolean, uploadPercent: number | undefined, phase: string) {
  if (stage <= 1 && uploadPercent !== undefined && uploadPercent < 100) {
    const filled = Math.min(10, Math.max(0, Math.floor(uploadPercent / 10)));
    const bar = `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
    return `${cell("Prepared", 0, 1, frame, color)} ${colorize("━━━", 36, color)} [${colorize(bar, 36, color)}] ${uploadPercent.toFixed(0).padStart(3)}% Uploading`;
  }
  const labels = ["Prepared", "Uploaded", "Transcribing", "Verifying", "Complete"];
  const effective = /retry|waiting/i.test(phase) ? Math.max(stage, 3) : stage;
  return labels.map((label, index) => cell(label, index, effective, frame, color)).join(` ${colorize("━━━", 36, color)} `);
}

function cell(label: string, index: number, stage: number, frame: number, color: boolean) {
  if (index < stage) return `${colorize("[✓]", 32, color)} ${label}`;
  if (index === stage) return `${colorize(`[${["◐", "◓", "◑", "◒"][frame] ?? "◐"}]`, 36, color)} ${label}`;
  return `${colorize("[ ]", 90, color)} ${label}`;
}

function stageFor(mode: ProgressMode, phase: string) {
  const value = String(phase || "").toLowerCase();
  if (mode === "audio") {
    if (value.includes("complete")) return 5;
    if (value.includes("verify") || value.includes("waiting") || value.includes("reconnect")) return 3;
    if (value.includes("transcrib")) return 2;
    if (value.includes("upload")) return 1;
    return 0;
  }
  if (value.includes("complete") || value.includes("result")) return 3;
  if (value.includes("verify") || value.includes("waiting") || value.includes("reconnect")) return 1;
  return 0;
}

function maxStage(mode: ProgressMode) {
  return mode === "audio" ? 4 : 2;
}

function monotonicNow() {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

export function formatDuration(milliseconds: number, unit: TimeUnit = "auto") {
  const value = Math.max(0, Number(milliseconds) || 0);
  if (unit === "ms") return `${Math.round(value)}ms`;
  if (unit === "s") return `${(value / 1000).toFixed(3)}s`;
  const seconds = value / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function formatElapsed(milliseconds: number) {
  return formatDuration(milliseconds, "auto");
}
