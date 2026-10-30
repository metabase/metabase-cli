#!/usr/bin/env bash
# Set up a fresh Metabase for `mb ci run`: admin, API key, databases, transforms on, import content.
# Env: MB_URL, CONTENT_DIR,
#      CI_DATABASES (a JSON array of POST /api/database bodies: name, engine, details)
# Prints `export MB_API_KEY=...` on stdout, before importing; exits non-zero if the import fails.
set -euo pipefail
api() { curl -fsS -H 'content-type: application/json' ${SESSION:+-H "X-Metabase-Session: $SESSION"} "$@"; }

until curl -fsS "$MB_URL/api/health" >/dev/null 2>&1; do sleep 2; done
setup_token=$(api "$MB_URL/api/session/properties" | jq -r '."setup-token"')
password="ci-$(openssl rand -hex 12)"
SESSION=$(api -X POST "$MB_URL/api/setup" -d "$(jq -n --arg t "$setup_token" --arg p "$password" \
  '{token:$t, user:{email:"ci@example.com", password:$p, first_name:"CI", last_name:"Runner"}, prefs:{site_name:"mb-ci"}}')" | jq -r .id)

api -X PUT "$MB_URL/api/setting/transforms-enabled" -d '{"value":true}' >/dev/null

# Empty stand-ins: transform tests build their inputs as temp tables, so nothing needs syncing.
jq -c '.[]' <<<"$CI_DATABASES" | while read -r db; do
  api -X POST "$MB_URL/api/database" -d "$db" | jq -r '"connected \(.name) as database \(.id)"' >&2
done

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
