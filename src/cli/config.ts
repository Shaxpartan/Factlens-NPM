import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type CliConfig = {
  apiKey?: string;
  developerToken?: string;
  selectedProjectId?: string;
};

export type ResolvedCliConfig = CliConfig & {
  runtimeBaseUrl?: string;
  managementBaseUrl?: string;
};

type PathContext = {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
};

export function configPath(context: PathContext = {}) {
  const platform = context.platform ?? process.platform;
  const env = context.env ?? process.env;
  const home = context.home ?? homedir();
  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"), "FactLens", "config.json");
  }
  if (platform === "darwin") return join(home, "Library", "Application Support", "FactLens", "config.json");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "factlens", "config.json");
}

export async function loadConfig(path = configPath()): Promise<CliConfig> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return compactConfig(value as Record<string, unknown>);
  } catch (error: any) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

export async function saveConfig(config: CliConfig, path = configPath()) {
  const clean = compactConfig(config as Record<string, unknown>);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(clean, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(path, 0o600).catch(() => {});
  return path;
}

export async function clearConfig(path = configPath()) {
  await rm(path, { force: true });
}

export function resolveCredentials(saved: CliConfig, env: NodeJS.ProcessEnv = process.env): ResolvedCliConfig {
  const apiKey = clean(env.FACTLENS_API_KEY) ?? clean(saved.apiKey);
  const developerToken = clean(env.FACTLENS_DEVELOPER_TOKEN) ?? clean(saved.developerToken);
  const selectedProjectId = clean(saved.selectedProjectId);
  const runtimeBaseUrl = clean(env.FACTLENS_RUNTIME_BASE_URL);
  const managementBaseUrl = clean(env.FACTLENS_MANAGEMENT_BASE_URL);
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(developerToken ? { developerToken } : {}),
    ...(selectedProjectId ? { selectedProjectId } : {}),
    ...(runtimeBaseUrl ? { runtimeBaseUrl } : {}),
    ...(managementBaseUrl ? { managementBaseUrl } : {}),
  };
}

export function maskSecret(value: string | undefined) {
  const text = clean(value);
  if (!text) return "not configured";
  if (text.length <= 10) return `${text.slice(0, 2)}••••`;
  return `${text.slice(0, Math.min(8, text.indexOf("_") > 0 ? text.lastIndexOf("_") + 1 : 6))}••••${text.slice(-4)}`;
}

function compactConfig(value: Record<string, unknown>): CliConfig {
  const apiKey = clean(value.apiKey);
  const developerToken = clean(value.developerToken);
  const selectedProjectId = clean(value.selectedProjectId);
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(developerToken ? { developerToken } : {}),
    ...(selectedProjectId ? { selectedProjectId } : {}),
  };
}

function clean(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}
