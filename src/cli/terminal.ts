import type { Writer } from "./output.js";

const ESC = "\x1b[";

export function colorize(value: string, code: number, enabled: boolean) {
  return enabled ? `${ESC}${code}m${value}${ESC}0m` : value;
}

export function createProgress(writer: Writer, enabled: boolean, color: boolean, intervalMs = 120) {
  let phase = "Preparing";
  let started = Date.now();
  let frame = 0;
  let timer: NodeJS.Timeout | undefined;
  const width = 12;

  const render = () => {
    if (!enabled) return;
    const elapsed = Math.max(0, Date.now() - started);
    const position = frame % (width * 2 - 2);
    const cursor = position < width ? position : width * 2 - 2 - position;
    const cells = Array.from({ length: width }, (_value, index) => index === cursor ? "●" : index < cursor ? "━" : "·").join("");
    const bar = colorize(cells, 36, color);
    writer(`\r\x1b[2K${bar} ${colorize(phase, 1, color)} ${formatElapsed(elapsed)}`);
    frame += 1;
  };

  return {
    start(nextPhase = "Preparing") {
      phase = nextPhase;
      started = Date.now();
      if (!enabled || timer) return;
      render();
      timer = setInterval(render, Math.max(10, intervalMs));
      timer.unref?.();
    },
    update(nextPhase: string) {
      phase = nextPhase;
      render();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (enabled) writer("\r\x1b[2K");
    },
  };
}

export function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, milliseconds) / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}
