import { FactLensConfigurationError } from "../errors.js";
import type { HttpTransport } from "../http.js";
import type { ApiKey, CreatedApiKey, KeyCreateOptions, KeyListOptions, KeyRevokeOptions, RequestOptions } from "../types/index.js";
import { CustomizationResource } from "./customization.js";

export class KeysResource {
  readonly customization: CustomizationResource;

  constructor(
    private readonly transport: HttpTransport,
    private readonly selectedProject: () => string | undefined,
  ) {
    this.customization = new CustomizationResource(transport, selectedProject);
  }

  async list(input: KeyListOptions = {}, options?: RequestOptions): Promise<ApiKey[]> {
    const projectId = this.projectId(input.projectId);
    const body = await this.transport.request<{ keys: ApiKey[] }>(`/v1/projects/${encodeURIComponent(projectId)}/keys`, {
      method: "GET",
      auth: "management",
      timeout: 60_000,
      ...(options === undefined ? {} : { options }),
    });
    return body.keys;
  }

  create(input: KeyCreateOptions, options?: RequestOptions) {
    const projectId = this.projectId(input.projectId);
    return this.transport.request<CreatedApiKey>(`/v1/projects/${encodeURIComponent(projectId)}/keys`, {
      method: "POST",
      auth: "management",
      body: { label: input.label },
      timeout: 60_000,
      automaticRequestId: true,
      ...(options === undefined ? {} : { options }),
    });
  }

  revoke(input: KeyRevokeOptions, options?: RequestOptions) {
    const projectId = this.projectId(input.projectId);
    return this.transport.request<{ ok: boolean }>(
      `/v1/projects/${encodeURIComponent(projectId)}/keys/${encodeURIComponent(input.keyId)}`,
      {
        method: "DELETE",
        auth: "management",
        timeout: 60_000,
        automaticRequestId: true,
        ...(options === undefined ? {} : { options }),
      },
    );
  }

  private projectId(explicit?: string) {
    const value = String(explicit ?? this.selectedProject() ?? "").trim();
    if (!value) throw new FactLensConfigurationError("Select a project or pass projectId for this key operation.");
    return value;
  }
}
