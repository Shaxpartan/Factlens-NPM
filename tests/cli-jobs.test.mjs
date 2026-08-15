import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listJobs, registerJob, killJobs } from '../dist/esm/cli/jobs.js';

test('job registry reports concurrent active requests with state and speaker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-jobs-'));
  try {
    await registerJob(root, { id: '11111111-1111-4111-8111-111111111111', requestId: '11111111-1111-4111-8111-111111111111', pid: 101, mode: 'audio_video', state: 'verifying', startedAt: 1_000, speaker: 'Jane Doe' });
    await registerJob(root, { id: '22222222-2222-4222-8222-222222222222', requestId: '22222222-2222-4222-8222-222222222222', pid: 202, mode: 'text', state: 'waiting', startedAt: 2_000 });

    const jobs = await listJobs(root, () => true);
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].mode, 'audio_video');
    assert.equal(jobs[0].speaker, 'Jane Doe');
    assert.deepEqual(jobs.map((job) => job.state), ['verifying', 'waiting']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('kill supports a unique job prefix and all without killing stale entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factlens-kill-'));
  try {
    await registerJob(root, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pid: 303, mode: 'text', state: 'verifying', startedAt: 1_000 });
    await registerJob(root, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pid: 404, mode: 'image_post', state: 'verifying', startedAt: 2_000 });
    const killed = [];
    const signal = (pid, signalName) => { killed.push([pid, signalName]); };

    const one = await killJobs(root, 'aaaaaaaa', () => true, signal);
    assert.deepEqual(one.map((job) => job.pid), [303]);
    assert.deepEqual(killed, [[303, 'SIGTERM']]);

    const rest = await killJobs(root, 'all', () => true, signal);
    assert.deepEqual(rest.map((job) => job.pid), [404]);
    assert.deepEqual(killed, [[303, 'SIGTERM'], [404, 'SIGTERM']]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
