export type FactLensClientOptions = {
  apiKey?: string;
  developerToken?: string;
  baseUrl?: string;
  runtimeBaseUrl?: string;
  managementBaseUrl?: string;
  dangerouslyAllowBrowser?: boolean;
  fetch?: typeof globalThis.fetch;
};

export type VerifyProgressState = "sending" | "waiting" | "transcribing" | "retrying" | "complete";

export type VerifyProgress = {
  state: VerifyProgressState;
  elapsedMs: number;
  elapsedSeconds: number;
  requestId?: string;
  attempt: number;
};

export type RequestOptions = {
  signal?: AbortSignal;
  timeout?: number;
  timeoutSeconds?: number;
  requestId?: string;
  maxRetries?: number;
  onProgress?: (progress: VerifyProgress) => void;
};

export type UsageSnapshot = {
  requests_charged?: number;
  charge_source?: "free" | "paid";
  free_daily_limit_requests?: number;
  free_used_today_requests?: number;
  free_remaining_today_requests?: number;
  paid_balance_requests?: number;
  billing_debt_requests?: number;
  requests_used_total?: number;
  rate_limit_per_minute?: number;
  [key: string]: unknown;
};

export type RuntimeResponse = {
  request_id?: string;
  response_time_ms?: number;
  usage?: UsageSnapshot;
  [key: string]: unknown;
};

export type VerdictInput = {
  id?: string;
  name?: string;
  color?: string;
  rule?: string;
  rules?: string[];
  guidance?: string;
  enabled?: boolean;
};

export type VerifyInput = {
  mode: "text" | "audio_video" | "image_post";
  claim?: string;
  text?: string;
  texts?: string[];
  transcript?: string;
  speaker?: string;
  audio_base64?: string;
  audio_url?: string;
  image_base64?: string;
  content_type?: string;
  language?: string;
  search_query?: string;
  results_per_search?: number;
  trusted_domains?: string[];
  blocked_domains?: string[];
  verdicts?: VerdictInput[];
  instructions?: string;
};

export type VerifySource = {
  url: string;
  title?: string;
  [key: string]: unknown;
};

export type VerifyResult = {
  claim?: string;
  verdictId?: string;
  verdictColor?: string;
  explanation?: string;
  confidence?: "LOW" | "MEDIUM" | "HIGH";
  evidenceStrength?: "NONE" | "WEAK" | "MODERATE" | "STRONG";
  sources?: VerifySource[];
  visibleText?: string;
  [key: string]: unknown;
};

export type VerifyClaimFailure = {
  claim?: string;
  error?: string;
  stage?: "transcription" | "search" | "analysis" | "moderation" | "verification" | string;
  message?: string;
  [key: string]: unknown;
};

export type VerifyResponse = RuntimeResponse & VerifyResult & {
  mode?: VerifyInput["mode"];
  transcript?: string | null;
  claim_count?: number;
  results?: VerifyResult[];
  failed_claims?: VerifyClaimFailure[];
  message?: string;
};

export type Account = {
  id?: string;
  user_id?: string;
  tier?: "free" | "paid";
  project_limit?: number;
  key_limit_per_project?: number;
  rate_limit_per_minute?: number;
  [key: string]: unknown;
};

export type Project = {
  id: string;
  name?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type ApiKey = {
  id: string;
  project_id?: string;
  label?: string;
  key_prefix?: string;
  last4?: string;
  enabled?: boolean;
  trusted_domains?: string[];
  blocked_domains?: string[];
  created_at?: string;
  last_used_at?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  [key: string]: unknown;
};

export type CreatedApiKey = {
  api_key: string;
  key: ApiKey;
  message?: string;
};

export type ProjectInput = { name: string };
export type ProjectReference = { projectId?: string };
export type KeyListOptions = ProjectReference;
export type KeyCreateOptions = ProjectReference & { label: string };
export type KeyRevokeOptions = { projectId?: string; keyId: string };
export type KeyReference = ProjectReference & { keyId: string };

export type ApiCustomizationMode = "text" | "audio" | "image";
export type ApiPromptStage = "claim_extraction" | "evidence_evaluation" | "image_extraction" | "image_evaluation" | "image_analysis";
export type ApiPromptMode = "guided" | "exact";

export type ApiKeyPromptConfig = {
  api_key_id?: string;
  mode: ApiCustomizationMode;
  stage: ApiPromptStage;
  instruction: string;
  input_budget_tokens: number;
  output_token_limit?: number | null;
  enabled: boolean;
  prompt_mode: ApiPromptMode;
  revision?: number;
  updated_at?: string | null;
  [key: string]: unknown;
};

export type ApiVerdictRule = string;
export type ApiVerdict = {
  id: string;
  name: string;
  color: string;
  rules: ApiVerdictRule[];
  guidance?: string;
  enabled: boolean;
  order: number;
};
export type ApiVerdictModeConfig = { instruction: string; catalog: ApiVerdict[] };
export type ApiVerdictConfig = {
  version: 3;
  modes: {
    text: ApiVerdictModeConfig;
    audio: ApiVerdictModeConfig;
    image: ApiVerdictModeConfig;
  };
};
export type ApiKeyVerdictConfigRecord = {
  api_key_id?: string;
  config: ApiVerdictConfig;
  schema_version?: number;
  contract_version?: string;
  revision?: number;
  updated_at?: string | null;
  [key: string]: unknown;
};

export type ApiPromptDefault = {
  mode: ApiCustomizationMode;
  stage: ApiPromptStage;
  name?: string;
  base_prompt?: string;
  runtime_template?: string;
  tags?: string[];
  estimated_output?: string;
  compatibility?: boolean;
  [key: string]: unknown;
};

export type ApiKeyCustomizationState = {
  key: ApiKey;
  prompts: ApiKeyPromptConfig[];
  verdict_config: ApiKeyVerdictConfigRecord | null;
  prompt_defaults?: ApiPromptDefault[];
  defaults?: { input_budget_tokens?: number; [key: string]: unknown };
};

export type KeyPreferencesUpdate = KeyReference & {
  trustedDomains?: string[];
  blockedDomains?: string[];
};

export type KeyPromptSaveInput = KeyReference & {
  mode: ApiCustomizationMode;
  stage: ApiPromptStage;
  instruction: string;
  inputBudgetTokens: number;
  outputTokenLimit?: number | null;
  enabled?: boolean;
  promptMode?: ApiPromptMode;
};

export type KeyPromptResetInput = KeyReference & {
  mode: ApiCustomizationMode;
  stage: ApiPromptStage;
};

export type KeyVerdictsSaveInput = KeyReference & { config: ApiVerdictConfig };

export type LogEntry = {
  project_id?: string;
  request_id: string;
  endpoint?: string;
  mode?: string;
  http_status?: number;
  duration_ms?: number;
  error_code?: string | null;
  sdk_name?: string | null;
  sdk_version?: string | null;
  received_at?: string;
  completed_at?: string | null;
  [key: string]: unknown;
};

export type LogListOptions = ProjectReference & {
  limit?: number;
  before?: string;
  endpoint?: string;
  status?: "success" | "failed";
};

export type LogPage = {
  logs: LogEntry[];
  has_more: boolean;
  next_cursor: string | null;
};

export type RequestDetail = LogEntry & Record<string, unknown>;

export type AccountUsageOptions = ProjectReference;
export type AccountUsageResponse = {
  account: Account;
  project?: Project | null;
  project_usage?: Record<string, unknown> | null;
};
