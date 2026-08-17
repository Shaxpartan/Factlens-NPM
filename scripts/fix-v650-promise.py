from pathlib import Path
p = Path('src/cli/index.ts')
s = p.read_text()
old = 'let pendingJobUpdate = Promise.resolve();'
count = s.count(old)
if count != 2:
    raise SystemExit(f'expected 2 pendingJobUpdate declarations, found {count}')
s = s.replace(old, 'let pendingJobUpdate: Promise<unknown> = Promise.resolve();')
p.write_text(s)
print('Widened serialized local-job update queue type.')
