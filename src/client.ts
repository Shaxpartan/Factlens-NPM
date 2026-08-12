import { FactLensConfigurationError } from "./errors.js";
import { HttpTransport } from "./http.js";
import { AccountResource } from "./resources/account.js";
import { KeysResource } from "./resources/keys.js";
import { LogsResource } from "./resources/logs.js";
import { ProjectsResource } from "./resources/projects.js";
import { UsageResource } from "./resources/usage.js";
import type {
  FactLensClientOptions,
  RequestOptions,
  VerifyInput,
  VerifyResponse,
} from "./types/index.js";

const DEFAULT_BASE_URL = "https://api.factlens.pro";

type NormalizedClientOptions = {
  apiKey?: string;
  developerToken?: string;
  baseUrl: string;
  runtimeBaseUrl: string;
  managementBaseUrl: string;
  dangerouslyAllowBrowser: boolean;
  fetch: typeof globalThis.fetch;
};

export default class FactLens {
  readonly account: AccountResource;
  readonly projects: ProjectsResource;
  readonly keys: KeysResource;
  readonly logs: LogsResource;
  readonly usage: UsageResource;

  private readonly config: NormalizedClientOptions;
  private readonly transport: HttpTransport;

  constructor(options: FactLensClientOptions = {}) {
    const apiKey = clean(options.apiKey ?? environment("FACTLENS_API_KEY"));
    const developerToken = clean(options.developerToken ?? environment("FACTLENS_DEVELOPER_TOKEN"));
    const dangerouslyAllowBrowser = options.dangerouslyAllowBrowser ?? false;
    if ((apiKey || developerToken) && browserLike() && !dangerouslyAllowBrowser) {
      throw new FactLensConfigurationError(
        "FactLens secret credentials cannot be used in a browser. Move this SDK call to your server or explicitly set dangerouslyAllowBrowser.",
      );
    }

    const fetchImplementation = options.fetch ?? globalThis.fetch;
    if (typeof fetchImplementation !== "function") {
      throw new FactLensConfigurationError("A Fetch API implementation is required. FactLens supports Node.js 18 or newer.");
    }

    const baseUrl = clean(options.baseUrl) ?? DEFAULT_BASE_URL;
    const runtimeBaseUrl = clean(options.runtimeBaseUrl ?? environment("FACTLENS_RUNTIME_BASE_URL")) ?? baseUrl;
    const managementBaseUrl = clean(options.managementBaseUrl ?? environment("FACTLENS_MANAGEMENT_BASE_URL")) ?? baseUrl;

    this.config = {
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(developerToken === undefined ? {} : { developerToken }),
      baseUrl,
      runtimeBaseUrl,
      managementBaseUrl,
      dangerouslyAllowBrowser,
      fetch: fetchImplementation,
    };
    this.transport = new HttpTransport(this.config);
    this.projects = new ProjectsResource(this.transport);
    this.account = new AccountResource(this.transport);
    this.keys = new KeysResource(this.transport, () => this.projects.selected());
    this.logs = new LogsResource(this.transport, () => this.projects.selected());
    this.usage = new UsageResource(this.transport, () => this.projects.selected());
  }

  verify(input: VerifyInput, options?: RequestOptions) {
    return this.transport.request<VerifyResponse>("/v1/verify", {
      method: "POST",
      auth: "runtime",
      body: input,
      timeout: 180_000,
      automaticRequestId: true,
      ...(options === undefined ? {} : { options }),
    });
  }

  withApiKey(apiKey: string) {
    return new FactLens({
      ...this.config,
      apiKey,
    });
  }
}

function clean(value: string | undefined) {
  const result = String(value ?? "").trim();
  return result || undefined;
}

function environment(name: string) {
  const processLike = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  return processLike?.env?.[name];
}

function browserLike() {
  const globals = globalThis as typeof globalThis & { window?: unknown; document?: unknown };
  return globals.window !== undefined && globals.document !== undefined;
}
