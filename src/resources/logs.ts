import { FactLensConfigurationError } from "../errors.js";
import type { HttpTransport } from "../http.js";
import type { LogListOptions, LogPage, RequestDetail, RequestOptions } from "../types/index.js";

export class LogsResource {
  constructor(
    private readonly transport: HttpTransport,
    private readonly selectedProject: () => string | undefined,
  ) {}

  async list(input: LogListOptions = {}, options?: RequestOptions) {
    const projectId = this.projectId(input.projectId);
    const query = new URLSearchParams();
    if (input.limit !== undefined) query.set("limit", String(Math.min(100, Math.max(1, Math.floor(input.limit)))));
    if (input.before) query.set("before", input.before);
    if (input.endpoint) query.set("endpoint", input.endpoint);
    if (input.status) query.set("status", input.status);
    const suffix = query.size ? `?${query}` : "";
    return this.transport.request<LogPage>(`/v1/projects/${encodeURIComponent(projectId)}/logs${suffix}`, {
      method: "GET",
      auth: "management",
      timeout: 60_000,
      ...(options === undefined ? {} : { options }),
    });
  }

  async get(requestId: string, options?: RequestOptions): Promise<RequestDetail> {
    const body = await this.transport.request<{ request: RequestDetail }>(`/v1/requests/${encodeURIComponent(requestId)}`, {
      method: "GET",
      auth: "management",
      timeout: 60_000,
      ...(options === undefined ? {} : { options }),
    });
    return body.request;
  }

  private projectId(explicit?: string) {
    const value = String(explicit ?? this.selectedProject() ?? "").trim();
    if (!value) throw new FactLensConfigurationError("Select a project or pass projectId for this log operation.");
    return value;
  }
}
