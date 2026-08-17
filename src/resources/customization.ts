import { FactLensConfigurationError } from "../errors.js";
import type { HttpTransport } from "../http.js";
import type {
  ApiKeyCustomizationState,
  KeyPreferencesUpdate,
  KeyPromptResetInput,
  KeyPromptSaveInput,
  KeyReference,
  KeyVerdictsSaveInput,
  RequestOptions,
} from "../types/index.js";

export class CustomizationResource {
  constructor(
    private readonly transport: HttpTransport,
    private readonly selectedProject: () => string | undefined,
  ) {}

  get(input: KeyReference, options?: RequestOptions) {
    const path = this.basePath(input);
    return this.transport.request<ApiKeyCustomizationState>(path, {
      method: "GET",
      auth: "management",
      timeout: 60_000,
      ...(options === undefined ? {} : { options }),
    });
  }

  updatePreferences(input: KeyPreferencesUpdate, options?: RequestOptions) {
    const path = `${this.basePath(input)}/preferences`;
    return this.transport.request<ApiKeyCustomizationState>(path, {
      method: "PATCH",
      auth: "management",
      body: {
        trusted_domains: input.trustedDomains ?? [],
        blocked_domains: input.blockedDomains ?? [],
      },
      timeout: 60_000,
      automaticRequestId: true,
      ...(options === undefined ? {} : { options }),
    });
  }

  savePrompt(input: KeyPromptSaveInput, options?: RequestOptions) {
    const path = `${this.basePath(input)}/prompts/${encodeURIComponent(input.mode)}/${encodeURIComponent(input.stage)}`;
    return this.transport.request<ApiKeyCustomizationState>(path, {
      method: "PUT",
      auth: "management",
      body: {
        instruction: input.instruction,
        input_budget_tokens: input.inputBudgetTokens,
        output_token_limit: input.outputTokenLimit ?? null,
        enabled: input.enabled ?? Boolean(String(input.instruction || "").trim()),
        prompt_mode: input.promptMode ?? "guided",
      },
      timeout: 60_000,
      automaticRequestId: true,
      ...(options === undefined ? {} : { options }),
    });
  }

  resetPrompt(input: KeyPromptResetInput, options?: RequestOptions) {
    const path = `${this.basePath(input)}/prompts/${encodeURIComponent(input.mode)}/${encodeURIComponent(input.stage)}`;
    return this.transport.request<ApiKeyCustomizationState>(path, {
      method: "DELETE",
      auth: "management",
      timeout: 60_000,
      automaticRequestId: true,
      ...(options === undefined ? {} : { options }),
    });
  }

  saveVerdicts(input: KeyVerdictsSaveInput, options?: RequestOptions) {
    const path = `${this.basePath(input)}/verdicts`;
    return this.transport.request<ApiKeyCustomizationState>(path, {
      method: "PUT",
      auth: "management",
      body: { config: input.config },
      timeout: 60_000,
      automaticRequestId: true,
      ...(options === undefined ? {} : { options }),
    });
  }

  resetVerdicts(input: KeyReference, options?: RequestOptions) {
    const path = `${this.basePath(input)}/verdicts`;
    return this.transport.request<ApiKeyCustomizationState>(path, {
      method: "DELETE",
      auth: "management",
      timeout: 60_000,
      automaticRequestId: true,
      ...(options === undefined ? {} : { options }),
    });
  }

  private basePath(input: KeyReference) {
    const projectId = String(input.projectId ?? this.selectedProject() ?? "").trim();
    const keyId = String(input.keyId ?? "").trim();
    if (!projectId) throw new FactLensConfigurationError("Select a project or pass projectId for this customization operation.");
    if (!keyId) throw new FactLensConfigurationError("keyId is required for API key customization.");
    return `/v1/projects/${encodeURIComponent(projectId)}/keys/${encodeURIComponent(keyId)}/customization`;
  }
}
