export type FactLensClientOptions = {
  apiKey?: string;
  developerToken?: string;
  baseUrl?: string;
  runtimeBaseUrl?: string;
  managementBaseUrl?: string;
  dangerouslyAllowBrowser?: boolean;
  fetch?: typeof globalThis.fetch;
};

export type RequestOptions = {
  signal?: AbortSignal;
  timeout?: number;
  requestId?: string;
  maxRetries?: number;
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
  rule?: string;
  guidance?: string;
};

export type VerifyInput = {
  mode: "text" | "audio_video" | "image_post";
  claim?: string;
  text?: string;
  texts?: string[];
  transcript?: string;
  audio_base64?: string;
  image_base64?: string;
  content_type?: string;
  language?: string;
  search_query?: string;
  results_per_search?: number;
  verdicts?: VerdictInput[];
  instructions?: string;
};

export type VerifyResult = {
  claim?: string;
  verdictId?: string;
  explanation?: string;
  confidence?: "LOW" | "MEDIUM" | "HIGH";
  evidenceStrength?: "NONE" | "WEAK" | "MODERATE" | "STRONG";
  sources?: Array<{ url: string; title?: string; [key: string]: unknown }>;
};

export type VerifyResponse = RuntimeResponse & VerifyResult & {
  mode?: VerifyInput["mode"];
  transcript?: string | null;
  claim_count?: number;
  results?: VerifyResult[];
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
