import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type CliJobState = "preparing" | "uploading" | "transcribing" | "verifying" | "waiting" | "retrying";
export type CliJob = {
  id: string;
  requestId: string;
  pid: number;
  mode: "text" | "audio_video" | "image_post";
  state: CliJobState;
  startedAt: number;
  speaker?: string;
};

type AliveCheck = (pid: number) => boolean;
type SignalProcess = (pid: number, signal: NodeJS.Signals) => void;

function filePath(root: string, id: string) {
  return join(root, `${id}.json`);
}

export async function registerJob(root: string, job: CliJob) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(filePath(root, job.id), `${JSON.stringify(job)}\n`, { encoding: "utf8", mode: 0o600 });
  return job;
}

export async function updateJob(root: string, id: string, patch: Partial<Pick<CliJob, "state" | "speaker">>) {
  const current = await readJob(root, id);
  if (!current) return null;
  const next = { ...current, ...patch };
  await registerJob(root, next);
  return next;
}

export async function removeJob(root: string, id: string) {
  await rm(filePath(root, id), { force: true });
}

export async function listJobs(root: string, alive: AliveCheck = processAlive) {
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const jobs: CliJob[] = [];
  for (const name of names.filter((value) => value.endsWith(".json"))) {
    const id = name.slice(0, -5);
    const job = await readJob(root, id);
    if (!job) continue;
    if (!alive(job.pid)) {
      await removeJob(root, id);
      continue;
    }
    jobs.push(job);
  }
  return jobs.sort((left, right) => left.startedAt - right.startedAt);
}

export async function killJobs(root: string, target: string, alive: AliveCheck = processAlive, signal: SignalProcess = signalProcess) {
  const jobs = await listJobs(root, alive);
  const normalized = String(target || "").trim().toLowerCase();
  const selected = normalized === "all"
    ? jobs
    : jobs.filter((job) => job.id.toLowerCase().startsWith(normalized) || job.requestId.toLowerCase().startsWith(normalized));
  if (!selected.length) return [];
  if (normalized !== "all" && selected.length > 1) throw new Error("JOB_ID_AMBIGUOUS");
  for (const job of selected) {
    if (alive(job.pid)) signal(job.pid, "SIGTERM");
    await removeJob(root, job.id);
  }
  return selected;
}

async function readJob(root: string, id: string): Promise<CliJob | null> {
  try {
    const value = JSON.parse(await readFile(filePath(root, id), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (typeof value.id !== "string" || typeof value.requestId !== "string" || !Number.isInteger(value.pid) || !Number.isFinite(value.startedAt)) return null;
    if (!["text", "audio_video", "image_post"].includes(value.mode)) return null;
    if (!["preparing", "uploading", "transcribing", "verifying", "waiting", "retrying"].includes(value.state)) return null;
    return value as CliJob;
  } catch (error: any) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals) {
  process.kill(pid, signal);
}
