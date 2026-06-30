#!/usr/bin/env python3
"""Apply the metadata plan (apply.jsonl) to a Metabase instance via the mb CLI.

Each line is {kind: table|field, id, name, body}. We call:
  mb table update <id> --body <json> --profile <p>
  mb field update <id> --body <json> --profile <p>
Failures are logged and skipped; the run continues. Re-running is safe/idempotent
because the plan only contains diffs (already-correct values produce no row).

Usage:
  python3 apply.py --apply apply.jsonl --profile localhost [--dry-run] [--limit N]
"""
import argparse, json, subprocess, sys, time

def run(kind, mid, body, profile):
    cmd = ['mb', f'{kind}', 'update', str(mid), '--body', json.dumps(body),
           '--profile', profile, '--json']
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', required=True)
    ap.add_argument('--profile', required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--log', default='apply.log')
    a = ap.parse_args()

    rows = [json.loads(l) for l in open(a.apply) if l.strip()]
    if a.limit:
        rows = rows[:a.limit]
    ok = fail = 0
    failures = []
    log = open(a.log, 'w')
    t0 = time.time()
    for i, r in enumerate(rows, 1):
        kind, mid, body, name = r['kind'], r['id'], r['body'], r.get('name', '')
        if a.dry_run:
            print(f'[dry] {kind} {mid} {name} {body}')
            continue
        rc, out, err = run(kind, mid, body, a.profile)
        if rc == 0:
            ok += 1
        else:
            fail += 1
            msg = (err or out or '').strip().replace('\n', ' ')[:300]
            failures.append({'name': name, 'kind': kind, 'id': mid, 'error': msg})
            log.write(f'FAIL {kind} {mid} {name}: {msg}\n')
        if i % 100 == 0:
            print(f'{i}/{len(rows)}  ok={ok} fail={fail}  ({time.time()-t0:.0f}s)', file=sys.stderr)
    log.write(f'\nDONE ok={ok} fail={fail}\n')
    for f in failures:
        log.write(json.dumps(f) + '\n')
    log.close()
    print(f'\nDONE ok={ok} fail={fail} in {time.time()-t0:.0f}s', file=sys.stderr)
    if failures:
        print(f'{len(failures)} failures (see {a.log}):', file=sys.stderr)
        for f in failures[:20]:
            print('  ', f['name'], '->', f['error'], file=sys.stderr)

if __name__ == '__main__':
    main()
