from pathlib import Path

# Fix local-job update/remove ordering: progress callbacks are synchronous, but
# updateJob is async. Serialize those writes and drain them before removeJob.
cli = Path('src/cli/index.ts')
s = cli.read_text()

old = '''    const progress = createProgress(context.writeErr, interactive, context.color, context.progressIntervalMs, "audio");
    progress.start("Uploading audio");'''
new = '''    const progress = createProgress(context.writeErr, interactive, context.color, context.progressIntervalMs, "audio");
    let pendingJobUpdate = Promise.resolve();
    const queueJobUpdate = (state: CliJobState) => {
      pendingJobUpdate = pendingJobUpdate.then(() => updateJob(context.jobsDir, requestId, { state })).catch(() => {});
    };
    progress.start("Uploading audio");'''
if old not in s:
    raise SystemExit('audio queue insertion marker missing')
s = s.replace(old, new, 1)

old = '''      const result = await client.verify(pollInput, { ...requestOptions(flags, 1_800_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); void updateJob(context.jobsDir, requestId, { state: mapped }); progress.update(progressLabel(event.state)); } });'''
new = '''      const result = await client.verify(pollInput, { ...requestOptions(flags, 1_800_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); queueJobUpdate(mapped); progress.update(progressLabel(event.state)); } });'''
if old not in s:
    raise SystemExit('audio callback marker missing')
s = s.replace(old, new, 1)

old = '''    } finally {
      progress.stop();
      await removeJob(context.jobsDir, requestId);
    }
  } else if (audioUrl) {'''
new = '''    } finally {
      progress.stop();
      await pendingJobUpdate;
      await removeJob(context.jobsDir, requestId);
    }
  } else if (audioUrl) {'''
if old not in s:
    raise SystemExit('audio cleanup marker missing')
s = s.replace(old, new, 1)

old = '''  const progress = createProgress(context.writeErr, interactive, context.color, context.progressIntervalMs, progressMode);
  progress.start(mode === "image_post" ? "Verifying image" : "Verifying");'''
new = '''  const progress = createProgress(context.writeErr, interactive, context.color, context.progressIntervalMs, progressMode);
  let pendingJobUpdate = Promise.resolve();
  const queueJobUpdate = (state: CliJobState) => {
    pendingJobUpdate = pendingJobUpdate.then(() => updateJob(context.jobsDir, requestId, { state })).catch(() => {});
  };
  progress.start(mode === "image_post" ? "Verifying image" : "Verifying");'''
if old not in s:
    raise SystemExit('verify queue insertion marker missing')
s = s.replace(old, new, 1)

old = '''    const result = await client.verify(input, { ...requestOptions(flags, mode === "audio_video" ? 1_800_000 : 180_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); void updateJob(context.jobsDir, requestId, { state: mapped }); progress.update(progressLabel(event.state)); } });'''
new = '''    const result = await client.verify(input, { ...requestOptions(flags, mode === "audio_video" ? 1_800_000 : 180_000), requestId, onProgress: (event) => { const mapped = progressJobState(event.state); queueJobUpdate(mapped); progress.update(progressLabel(event.state)); } });'''
if old not in s:
    raise SystemExit('verify callback marker missing')
s = s.replace(old, new, 1)

old = '''  } finally {
    progress.stop();
    await removeJob(context.jobsDir, requestId);
  }
}'''
new = '''  } finally {
    progress.stop();
    await pendingJobUpdate;
    await removeJob(context.jobsDir, requestId);
  }
}'''
if old not in s:
    raise SystemExit('verify cleanup marker missing')
s = s.replace(old, new, 1)
cli.write_text(s)

# Release/version assertions.
p = Path('tests/cli-core.test.mjs')
t = p.read_text().replace('/^6\\.1\\.0$/', '/^6\\.5\\.0$/')
p.write_text(t)

p = Path('tests/runtime.test.mjs')
t = p.read_text().replace('"6.1.0"', '"6.5.0"')
p.write_text(t)

p = Path('tests/v6.5.0.test.mjs')
t = p.read_text().replace('/timeout and timeoutSeconds/i', '/timeout.*timeoutSeconds/i')
p.write_text(t)

# TTY progress test now verifies the approved forward rail and actual response color.
p = Path('tests/cli-speaker-progress.test.mjs')
t = p.read_text()
t = t.replace("return Response.json({ verdictId: 'TRUE', explanation: 'Supported.', confidence: 'HIGH', evidenceStrength: 'STRONG', sources: [] });",
              "return Response.json({ verdictId: 'TRUE', verdictColor: '#22c55e', explanation: 'Supported.', confidence: 'HIGH', evidenceStrength: 'STRONG', sources: [] });")
t = t.replace("{ configFile: join(root, 'config.json'), color: true, progressIntervalMs: 5 });",
              "{ configFile: join(root, 'config.json'), color: true, progressIntervalMs: 5, stdout: { isTTY: true } });", 1)
t = t.replace("assert.match(h.err.join(''), /[●━·]/);", "assert.match(h.err.join(''), /[◐◓◑◒━✓]/);")
p.write_text(t)

# Timeout contract should follow the new mode-aware common path.
p = Path('tests/verify-timeout-contract.test.mjs')
t = p.read_text().replace(
    'assert.match(cliSource, /requestOptions\\(flags, 180_000\\)/);',
    'assert.match(cliSource, /requestOptions\\(flags, mode === "audio_video" \\? 1_800_000 : 180_000\\)/);'
)
p.write_text(t)

# Rewrite the legacy release source assertions around the current 6.5.0 contract.
p = Path('tests/version-6.0.0.test.mjs')
t = p.read_text()
t = t.replace("test('6.1.0 release metadata and runtime SDK header stay synchronized'", "test('6.5.0 release metadata and runtime SDK header stay synchronized'")
t = t.replace("'6.1.0'", "'6.5.0'")
t = t.replace('/SDK_VERSION\\s*=\\s*["\']6\\.1\\.0["\']/', '/SDK_VERSION\\s*=\\s*["\']6\\.5\\.0["\']/')
t = t.replace("test('6.1.0 keeps image claims optional in CLI and SDK'", "test('6.5.0 keeps image claims optional in CLI and SDK'")
t = t.replace('assert.match(changelog, /## 6\\.1\\.0/);', 'assert.match(changelog, /## 6\\.5\\.0/);')
t = t.replace("test('6.1.0 keeps multi result rendering and request in progress recovery'", "test('6.5.0 keeps multi result rendering and request in progress recovery'")
t = t.replace('appendHumanVerifyResult\\(lines, item, index, color\\)', 'appendHumanVerifyResult\\(lines, item, index, color, verbose\\)')
t = t.replace("test('6.1.0 preserves existing media, progress, and source preference documentation'", "test('6.5.0 preserves existing media, progress, and source preference documentation'")
p.write_text(t)

print('Applied v6.5.0 regression fixes.')
