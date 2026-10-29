#!/usr/bin/env bash
# Set up a fresh Metabase for `mb ci run`: admin, API key, warehouse, transforms on, import content.
# Env: MB_URL, CONTENT_DIR,
#      WH_NAME, WH_URL (optional: postgresql://user:password@host:port/dbname[?sslmode=require]),
#      WH_DIR (the warehouse's folder under databases/, whose schemas limit the sync)
# Prints `export MB_API_KEY=...` on stdout, before importing; exits non-zero if the import fails.
set -euo pipefail
api() { curl -fsS -H 'content-type: application/json' ${SESSION:+-H "X-Metabase-Session: $SESSION"} "$@"; }

until curl -fsS "$MB_URL/api/health" >/dev/null 2>&1; do sleep 2; done
setup_token=$(api "$MB_URL/api/session/properties" | jq -r '."setup-token"')
password="ci-$(openssl rand -hex 12)"
SESSION=$(api -X POST "$MB_URL/api/setup" -d "$(jq -n --arg t "$setup_token" --arg p "$password" \
  '{token:$t, user:{email:"ci@example.com", password:$p, first_name:"CI", last_name:"Runner"}, prefs:{site_name:"mb-ci"}}')" | jq -r .id)

api -X PUT "$MB_URL/api/setting/transforms-enabled" -d '{"value":true}' >/dev/null

if [ -n "${WH_URL:-}" ]; then
  [[ "$WH_URL" =~ ^postgres(ql)?://([^:]+):([^@]+)@([^:/]+):([0-9]+)/([^?]+)(\?sslmode=require)?$ ]] \
    || { echo "WH_URL is not postgresql://user:password@host:port/dbname[?sslmode=require]" >&2; exit 1; }
  # Sync only the schemas the content uses: the warehouse holds far more.
  schemas=$(ls "$CONTENT_DIR/databases/$WH_DIR/schemas" | paste -sd, -)
  db_id=$(api -X POST "$MB_URL/api/database" -d "$(jq -n --arg n "$WH_NAME" --arg u "${BASH_REMATCH[2]}" \
    --arg pw "${BASH_REMATCH[3]}" --arg h "${BASH_REMATCH[4]}" --argjson port "${BASH_REMATCH[5]}" \
    --arg d "${BASH_REMATCH[6]}" --argjson ssl "$([ -n "${BASH_REMATCH[7]}" ] && echo true || echo false)" \
    --arg s "$schemas" \
    '{name:$n, engine:"postgres", details:{host:$h, port:$port, dbname:$d, user:$u, password:$pw, ssl:$ssl,
      "ssl-mode":"require", "schema-filters-type":"inclusion", "schema-filters-patterns":$s}}')" | jq -r .id)
  # Bounded: an unreachable warehouse must fail the step, not hang until the job times out.
  for _ in $(seq 450); do
    status=$(api "$MB_URL/api/database/$db_id" | jq -r .initial_sync_status)
    [ "$status" = complete ] && break
    [ "$status" = aborted ] && { echo "warehouse sync aborted" >&2; exit 1; }
    sleep 2
  done
  [ "$status" = complete ] || { echo "warehouse sync did not finish in 15 minutes" >&2; exit 1; }
  echo "warehouse $WH_NAME synced as database $db_id (schemas: $schemas)" >&2
else
  echo "::warning::No warehouse login (WH_URL), so transform tests can't run." >&2
fi

# The key comes before the import, so `mb ci run` can still run (and lint) when the import fails.
key=$(api -X POST "$MB_URL/api/api-key" -d '{"name":"mb-ci","group_id":2}' | jq -r .unmasked_key)
echo "export MB_API_KEY=$key"

archive=$(mktemp -d)/content.tgz
tar czf "$archive" -C "$CONTENT_DIR" --exclude .git .
curl -fsS -H "X-Metabase-Session: $SESSION" -F "file=@$archive" \
  "$MB_URL/api/ee/serialization/import?continue_on_error=false" >&2
# The content uses databases CI doesn't connect; their transforms' tests can't run.
stubs=$(api "$MB_URL/api/database?include_stubs=true" | jq -r '[.data[] | select(.is_stub) | .name] | join(", ")')
if [ -n "$stubs" ]; then
  echo "::warning::Content refers to databases CI doesn't connect, so their transforms' tests can't run: $stubs" >&2
fi
