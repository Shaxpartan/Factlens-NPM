from pathlib import Path

path = Path('src/cli/index.ts')
source = path.read_text()
start = source.index('function outputSuccess(')
end = source.index('\nasync function mediaFile', start)
replacement = r'''function outputSuccess(command: string, result: any, context: CliContext) {
  if (context.json) { writeJson(context.writeOut, result); return; }
  if (command === "verify") {
    if (context.quiet) {
      const items = Array.isArray(result?.results) && result.results.length ? result.results : [result];
      context.writeOut(`${items.map((item: any) => item?.verdictId || "").filter(Boolean).join("\n")}\n`);
      return;
    }
    context.writeOut(humanVerify(result, context.color, context.timeUnit, context.verbose));
    return;
  }
  if (command === "doctor") {
    context.writeOut(`FactLens doctor\n${(result.checks || []).map((check: any) => `${check.ok ? "OK" : "WARN"}  ${check.name}${check.message ? ` — ${check.message}` : ""}`).join("\n")}\n`);
    return;
  }
  if (command === "projects" && result?.selectedProjectId) { context.writeOut(`Selected project: ${result.selectedProjectId}\n`); return; }
  if (command === "keys" && result?.api_key) { context.writeOut(`API key created. This secret is shown once.\n${result.api_key}\nStore it securely; FactLens cannot show it again.\n`); return; }
  context.writeOut(`${JSON.stringify(result, null, 2)}\n`);
}

function appendHumanVerifyResult(lines: string[], result: any, index?: number, color = false, verbose = false) {
  if (result?.claim) lines.push(index === undefined ? `Claim: ${result.claim}` : `Claim ${index + 1}: ${result.claim}`);
  if (result?.verdictId) {
    const id = String(result.verdictId);
    const colored = colorizeHex(id, result.verdictColor, color);
    const hex = String(result.verdictColor || "");
    lines.push(`Verdict: ${colored}${!color && /^#[0-9a-f]{6}$/i.test(hex) ? `  ${hex}` : ""}`);
  }
  if (result?.confidence) lines.push(`Confidence: ${result.confidence}`);
  if (result?.evidenceStrength) lines.push(`Evidence: ${result.evidenceStrength}`);
  if (result?.explanation) lines.push(`\n${result.explanation}`);
  if (Array.isArray(result?.sources) && result.sources.length) {
    lines.push("\nSources:");
    result.sources.forEach((source: any, sourceIndex: number) => {
      if (verbose) lines.push(`${sourceIndex + 1}. ${source.title ? `${source.title} — ` : ""}${source.url}`);
      else {
        let domain = source.url;
        try { domain = new URL(source.url).hostname.replace(/^www\./, ""); } catch {}
        lines.push(`${sourceIndex + 1}. ${source.title || domain}${source.title ? ` — ${domain}` : ""}`);
      }
    });
  }
}

function humanVerify(result: VerifyResponse, color = false, timeUnit: TimeUnit = "auto", verbose = false) {
  const claimCount = Number(result.claim_count || (Array.isArray(result.results) ? result.results.length : result.claim ? 1 : 0));
  const lines = [colorize(`FactLens verification complete${claimCount > 1 ? ` · ${claimCount} claims` : ""}`, 1, color)];
  const results = Array.isArray(result.results) && result.results.length ? result.results : null;
  if (results) results.forEach((item, index) => { if (index > 0) lines.push(""); appendHumanVerifyResult(lines, item, index, color, verbose); });
  else appendHumanVerifyResult(lines, result, undefined, color, verbose);
  if (Array.isArray(result.failed_claims) && result.failed_claims.length) {
    lines.push("\nFailed claims:");
    result.failed_claims.forEach((item: any, index: number) => lines.push(`${index + 1}. ${item.claim || "Unknown claim"} — ${item.error || item.message || "failed"}`));
  }
  if (!claimCount && result.message) lines.push(`\n${result.message}`);
  if (result.request_id) lines.push(`\nRequest ID: ${result.request_id}`);
  if (result.response_time_ms !== undefined) lines.push(`Response time: ${result.response_time_ms} ms`);
  const clientMs = Number((result as any).__clientElapsedMs);
  if (Number.isFinite(clientMs) || result.response_time_ms !== undefined) {
    const total = Number.isFinite(clientMs) ? formatDuration(clientMs, timeUnit) : "n/a";
    const server = result.response_time_ms === undefined ? "n/a" : formatDuration(result.response_time_ms, timeUnit);
    lines.push(`Timing: ${total} total · ${server} server`);
  }
  if (result.usage) lines.push(`Usage: ${JSON.stringify(result.usage)}`);
  return `${lines.join("\n")}\n`;
}
'''
source = source[:start] + replacement + source[end:]
path.write_text(source)
print('Finalized v6.5.0 CLI output block.')
