import type { HttpTransport } from "../http.js";
import type { AccountUsageOptions, AccountUsageResponse, RequestOptions, UsageSnapshot } from "../types/index.js";

export class UsageResource {
  constructor(
    private readonly transport: HttpTransport,
    private readonly selectedProject: () => string | undefined,
  ) {}

  get(options?: RequestOptions) {
    return this.getDetailed(options).then((response) => response.data);
  }

  getDetailed(options?: RequestOptions) {
    return this.transport.requestDetailed<UsageSnapshot>("/v1/usage", {
      method: "GET",
      auth: "runtime",
      timeout: 60_000,
      ...(options === undefined ? {} : { options }),
    });
  }

  getAccount(input: AccountUsageOptions = {}, options?: RequestOptions) {
    const projectId = input.projectId ?? this.selectedProject();
    const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return this.transport.request<AccountUsageResponse>(`/v1/account/usage${query}`, {
      method: "GET",
      auth: "management",
      timeout: 60_000,
      ...(options === undefined ? {} : { options }),
    });
  }
}
