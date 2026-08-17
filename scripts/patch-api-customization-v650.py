from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
platform = root / 'supabase/functions/factlens-api-platform/index.ts'
source = platform.read_text()

if 'DEFAULT_API_INPUT_BUDGET_TOKENS' not in source:
    source = source.replace(
        'import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";\n',
        'import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";\nimport {\n  DEFAULT_API_INPUT_BUDGET_TOKENS,\n  isAllowedApiPrompt,\n  normalizeApiPromptConfig,\n  normalizeVerdictSet,\n} from "../_shared/api-key-customization.mjs";\n',
        1,
    )

source = source.replace('type Method = "GET" | "POST" | "PATCH" | "DELETE";', 'type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";')

route_comment = '// DELETE /v1/projects/:projectId/keys/:keyId\n'
if '// GET /v1/projects/:projectId/keys/:keyId/customization' not in source:
    source = source.replace(route_comment, route_comment + '// GET /v1/projects/:projectId/keys/:keyId/customization\n// PATCH /v1/projects/:projectId/keys/:keyId/customization/preferences\n// PUT|DELETE /v1/projects/:projectId/keys/:keyId/customization/prompts/:mode/:stage\n// PUT|DELETE /v1/projects/:projectId/keys/:keyId/customization/verdicts\n')

bounded_marker = 'const bounded = (value: unknown, max: number) => String(value ?? "").replace(/\\s+/g, " ").trim().slice(0, max);\n'
if 'function normalizeSourceDomain' not in source:
    helpers = r'''

function normalizeSourceDomain(value: unknown) {
  if (typeof value !== "string" || value.length > 500) return "";
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    const host = parsed.hostname.replace(/^www\./, "").replace(/\.$/, "");
    if (!host || host.length > 253 || host.includes("..")) return "";
    return host;
  } catch { return ""; }
}

function normalizeDomainList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const domain = normalizeSourceDomain(item);
    if (!domain) return null;
    if (!seen.has(domain)) { seen.add(domain); out.push(domain); }
  }
  return out;
}
'''
    if bounded_marker not in source:
        raise SystemExit('bounded marker missing')
    source = source.replace(bounded_marker, bounded_marker + helpers, 1)

if 'customization_read:' not in source:
    source = source.replace('  key_delete: 20,\n', '  key_delete: 20,\n  customization_read: 180,\n  customization_write: 60,\n', 1)

owned_marker = 'function publicAudit(row: Json) {'
if 'async function ownedApiKey' not in source:
    api_helpers = r'''
async function ownedApiKey(client: ReturnType<typeof db>, userId: string, projectId: string, keyId: string) {
  const project = await ownedProject(client, userId, projectId);
  if (!project) return { project: null, key: null };
  if (!uuidPattern.test(keyId)) return { project, key: null };
  const { data, error } = await client
    .from("factlens_api_keys")
    .select("id,project_id,label,key_prefix,last4,enabled,created_at,last_used_at,expires_at,revoked_at,trusted_domains,blocked_domains")
    .eq("id", keyId)
    .eq("project_id", project.id)
    .maybeSingle();
  if (error) throw new Error("KEY_LOOKUP_FAILED");
  return { project, key: data || null };
}

async function apiKeyCustomizationState(client: ReturnType<typeof db>, key: Json) {
  const [promptRes, verdictRes] = await Promise.all([
    client.from("factlens_api_key_prompt_configs")
      .select("api_key_id,mode,stage,instruction,input_budget_tokens,output_token_limit,enabled,prompt_mode,schema_version,contract_version,revision,updated_at")
      .eq("api_key_id", key.id)
      .order("mode")
      .order("stage"),
    client.from("factlens_api_key_verdict_configs")
      .select("api_key_id,config,schema_version,contract_version,revision,updated_at")
      .eq("api_key_id", key.id)
      .maybeSingle(),
  ]);
  if (promptRes.error || verdictRes.error) throw new Error("CUSTOMIZATION_LOAD_FAILED");
  return {
    key: {
      id: key.id,
      project_id: key.project_id,
      label: key.label,
      key_prefix: key.key_prefix,
      last4: key.last4,
      enabled: key.enabled,
      created_at: key.created_at,
      last_used_at: key.last_used_at,
      expires_at: key.expires_at,
      revoked_at: key.revoked_at,
      trusted_domains: key.trusted_domains || [],
      blocked_domains: key.blocked_domains || [],
    },
    prompts: promptRes.data || [],
    verdict_config: verdictRes.data || null,
    defaults: { input_budget_tokens: DEFAULT_API_INPUT_BUDGET_TOKENS },
  };
}

'''
    if owned_marker not in source:
        raise SystemExit('publicAudit marker missing')
    source = source.replace(owned_marker, api_helpers + owned_marker, 1)

route_marker = '    const keyItemMatch = path.match(/^\\/v1\\/projects\\/([0-9a-f-]{36})\\/keys\\/([0-9a-f-]{36})$/i);\n'
if 'customizationBaseMatch' not in source:
    routes = r'''    const customizationBaseMatch = path.match(/^\/v1\/projects\/([0-9a-f-]{36})\/keys\/([0-9a-f-]{36})\/customization$/i);
    if (customizationBaseMatch && method === "GET") {
      const limited = await readRate("customization_read"); if (limited) return limited;
      const owned = await ownedApiKey(client, userId, customizationBaseMatch[1], customizationBaseMatch[2]);
      if (!owned.project) return reply(req, 404, { error: "PROJECT_NOT_FOUND" });
      if (!owned.key) return reply(req, 404, { error: "KEY_NOT_FOUND" });
      return reply(req, 200, await apiKeyCustomizationState(client, owned.key));
    }

    const customizationPreferencesMatch = path.match(/^\/v1\/projects\/([0-9a-f-]{36})\/keys\/([0-9a-f-]{36})\/customization\/preferences$/i);
    if (customizationPreferencesMatch && method === "PATCH") {
      const body = await readJson(req, MAX_MANAGEMENT_BODY_BYTES);
      return runMutation(req, client, userId, "customization_write", path, body, async () => {
        const owned = await ownedApiKey(client, userId, customizationPreferencesMatch[1], customizationPreferencesMatch[2]);
        if (!owned.project) return reply(req, 404, { error: "PROJECT_NOT_FOUND" });
        if (!owned.key) return reply(req, 404, { error: "KEY_NOT_FOUND" });
        const hasTrusted = Object.prototype.hasOwnProperty.call(body, "trusted_domains");
        const hasBlocked = Object.prototype.hasOwnProperty.call(body, "blocked_domains");
        if (!hasTrusted && !hasBlocked) return reply(req, 400, { error: "SOURCE_PREFERENCES_REQUIRED" });
        const trusted = hasTrusted ? normalizeDomainList(body.trusted_domains) : [...(owned.key.trusted_domains || [])];
        const blocked = hasBlocked ? normalizeDomainList(body.blocked_domains) : [...(owned.key.blocked_domains || [])];
        if (trusted === null || blocked === null) return reply(req, 400, { error: "SOURCE_PREFERENCES_INVALID", message: "Source preferences must contain at most 50 valid domains per list." });
        const blockedSet = new Set(blocked);
        const normalizedTrusted = trusted.filter((domain) => !blockedSet.has(domain));
        const { data: key, error } = await client.from("factlens_api_keys")
          .update({ trusted_domains: normalizedTrusted, blocked_domains: blocked, updated_at: new Date().toISOString() })
          .eq("id", owned.key.id)
          .eq("project_id", owned.project.id)
          .select("id,project_id,label,key_prefix,last4,enabled,created_at,last_used_at,expires_at,revoked_at,trusted_domains,blocked_domains")
          .maybeSingle();
        if (error) throw new Error("KEY_PREFERENCES_UPDATE_FAILED");
        if (!key) return reply(req, 404, { error: "KEY_NOT_FOUND" });
        return reply(req, 200, await apiKeyCustomizationState(client, key));
      });
    }

    const customizationPromptMatch = path.match(/^\/v1\/projects\/([0-9a-f-]{36})\/keys\/([0-9a-f-]{36})\/customization\/prompts\/([^/]+)\/([^/]+)$/i);
    if (customizationPromptMatch && (method === "PUT" || method === "DELETE")) {
      const mode = bounded(decodeURIComponent(customizationPromptMatch[3]), 20);
      const stage = bounded(decodeURIComponent(customizationPromptMatch[4]), 80);
      if (!isAllowedApiPrompt(mode, stage)) return reply(req, 400, { error: "PROMPT_STAGE_NOT_ALLOWED" });
      const body = method === "PUT" ? await readJson(req, MAX_MANAGEMENT_BODY_BYTES) : {};
      return runMutation(req, client, userId, "customization_write", path, body, async () => {
        const owned = await ownedApiKey(client, userId, customizationPromptMatch[1], customizationPromptMatch[2]);
        if (!owned.project) return reply(req, 404, { error: "PROJECT_NOT_FOUND" });
        if (!owned.key) return reply(req, 404, { error: "KEY_NOT_FOUND" });
        if (method === "DELETE") {
          const { error } = await client.from("factlens_api_key_prompt_configs").delete().eq("api_key_id", owned.key.id).eq("mode", mode).eq("stage", stage);
          if (error) throw new Error("PROMPT_RESET_FAILED");
          return reply(req, 200, await apiKeyCustomizationState(client, owned.key));
        }
        const rawBudget = Number(body.input_budget_tokens ?? DEFAULT_API_INPUT_BUDGET_TOKENS);
        if (!Number.isFinite(rawBudget) || !Number.isInteger(rawBudget) || rawBudget < 2000 || rawBudget > 20000 || rawBudget % 100 !== 0) {
          return reply(req, 400, { error: "PROMPT_BUDGET_INVALID", message: "Input budget must be 2,000–20,000 tokens in 100-token increments." });
        }
        const config = normalizeApiPromptConfig({
          mode,
          stage,
          instruction: typeof body.instruction === "string" ? body.instruction : "",
          input_budget_tokens: rawBudget,
          output_token_limit: body.output_token_limit,
          enabled: body.enabled,
          prompt_mode: body.prompt_mode,
        });
        const { data: existing, error: existingError } = await client.from("factlens_api_key_prompt_configs")
          .select("revision").eq("api_key_id", owned.key.id).eq("mode", mode).eq("stage", stage).maybeSingle();
        if (existingError) throw new Error("PROMPT_LOOKUP_FAILED");
        const { error } = await client.from("factlens_api_key_prompt_configs").upsert({
          api_key_id: owned.key.id,
          mode,
          stage,
          instruction: config.instruction,
          input_budget_tokens: config.input_budget_tokens,
          output_token_limit: config.output_token_limit,
          enabled: config.enabled,
          prompt_mode: config.prompt_mode,
          schema_version: 1,
          contract_version: "api-key-prompts-v1",
          revision: Number(existing?.revision || 0) + 1,
          updated_at: new Date().toISOString(),
        }, { onConflict: "api_key_id,mode,stage" });
        if (error) throw new Error("PROMPT_SAVE_FAILED");
        return reply(req, 200, await apiKeyCustomizationState(client, owned.key));
      });
    }

    const customizationVerdictsMatch = path.match(/^\/v1\/projects\/([0-9a-f-]{36})\/keys\/([0-9a-f-]{36})\/customization\/verdicts$/i);
    if (customizationVerdictsMatch && (method === "PUT" || method === "DELETE")) {
      const body = method === "PUT" ? await readJson(req, MAX_MANAGEMENT_BODY_BYTES) : {};
      return runMutation(req, client, userId, "customization_write", path, body, async () => {
        const owned = await ownedApiKey(client, userId, customizationVerdictsMatch[1], customizationVerdictsMatch[2]);
        if (!owned.project) return reply(req, 404, { error: "PROJECT_NOT_FOUND" });
        if (!owned.key) return reply(req, 404, { error: "KEY_NOT_FOUND" });
        if (method === "DELETE") {
          const { error } = await client.from("factlens_api_key_verdict_configs").delete().eq("api_key_id", owned.key.id);
          if (error) throw new Error("VERDICT_RESET_FAILED");
          return reply(req, 200, await apiKeyCustomizationState(client, owned.key));
        }
        const normalized = normalizeVerdictSet(body.config);
        const { data: existing, error: existingError } = await client.from("factlens_api_key_verdict_configs")
          .select("revision").eq("api_key_id", owned.key.id).maybeSingle();
        if (existingError) throw new Error("VERDICT_LOOKUP_FAILED");
        const { error } = await client.from("factlens_api_key_verdict_configs").upsert({
          api_key_id: owned.key.id,
          config: normalized,
          schema_version: 3,
          contract_version: "verdict-catalog-v3",
          revision: Number(existing?.revision || 0) + 1,
          updated_at: new Date().toISOString(),
        }, { onConflict: "api_key_id" });
        if (error) throw new Error("VERDICT_SAVE_FAILED");
        return reply(req, 200, await apiKeyCustomizationState(client, owned.key));
      });
    }

'''
    if route_marker not in source:
        raise SystemExit('key route marker missing')
    source = source.replace(route_marker, routes + route_marker, 1)

platform.write_text(source)

# Fix the stale source-shape assertion so the current guarded v83 wrapper is allowed.
preauth = root / 'tests/preauth-wiring.test.mjs'
text = preauth.read_text()
text = text.replace(
    "assert.match(config, /\\[functions\\.factlens-api\\][\\s\\S]*entrypoint = '\\.\\/functions\\/factlens-api\\/entrypoint\\.ts'/);",
    "assert.match(config, /\\[functions\\.factlens-api\\][\\s\\S]*entrypoint = '\\.\\/functions\\/factlens-api\\/(?:entrypoint-v83\\.mjs|entrypoint\\.ts)'/);",
)
preauth.write_text(text)

# Add a focused source-contract regression suite.
test_path = root / 'tests/api-key-customization-platform-v84.test.mjs'
test_path.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('developer-token platform exposes project-owned API-key customization routes', async () => {
  const source = await read('supabase/functions/factlens-api-platform/index.ts');
  assert.match(source, /customizationBaseMatch/);
  assert.match(source, /customizationPreferencesMatch/);
  assert.match(source, /customizationPromptMatch/);
  assert.match(source, /customizationVerdictsMatch/);
  assert.match(source, /ownedApiKey\(client, userId/);
  assert.match(source, /factlens_api_key_prompt_configs/);
  assert.match(source, /factlens_api_key_verdict_configs/);
});

test('customization route reuses canonical normalization and 8k prompt defaults', async () => {
  const source = await read('supabase/functions/factlens-api-platform/index.ts');
  assert.match(source, /DEFAULT_API_INPUT_BUDGET_TOKENS/);
  assert.match(source, /isAllowedApiPrompt/);
  assert.match(source, /normalizeApiPromptConfig/);
  assert.match(source, /normalizeVerdictSet/);
  assert.match(source, /rawBudget < 2000/);
  assert.match(source, /rawBudget > 20000/);
  assert.match(source, /rawBudget % 100 !== 0/);
  assert.match(source, /contract_version: "verdict-catalog-v3"/);
});

test('preferences preserve omitted lists, normalize domains, and blocked wins overlap', async () => {
  const source = await read('supabase/functions/factlens-api-platform/index.ts');
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(body, "trusted_domains"\)/);
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(body, "blocked_domains"\)/);
  assert.match(source, /normalizeDomainList/);
  assert.match(source, /trusted\.filter\(\(domain\) => !blockedSet\.has\(domain\)\)/);
});
''')

print('Prepared FactLens API customization platform candidate.')
