#!/usr/bin/env bash
set -u

export PATH="/Users/tokutake/.nvm/versions/node/v24.18.0/bin:$PATH"
NODE="$(command -v node)"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EVAL="$ROOT/evaluation"
RUNS="$ROOT/runs"
TMP="${TMPDIR:-/private/tmp}"
HOOK="$TMP/luna-loopback-hook.mjs"
mkdir -p "$EVAL/results"

cat > "$HOOK" <<'EOF'
import net from 'node:net';
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'object' && args[0]?.host && !['127.0.0.1','::1','localhost'].includes(args[0].host)) args[0] = { ...args[0], host: '127.0.0.1' };
  else if (typeof args[1] === 'string' && !['127.0.0.1','::1','localhost'].includes(args[1])) args[1] = '127.0.0.1';
  return listen.apply(this,args);
};
EOF

RUNS_TO_TEST=(luna-study-01-none-on luna-study-01-none-off luna-study-01-nextjs-off luna-study-01-nextjs-on luna-study-01-tanstack-off luna-study-01-tanstack-on)
if [[ -n "${ONLY_RUNS:-}" ]]; then read -r -a RUNS_TO_TEST <<< "$ONLY_RUNS"; fi
PORT=4511 ISSUER=http://127.0.0.1:4511 "$NODE" "$EVAL/lib/mockIdp.js" >"$TMP/luna-mock-idp.log" 2>&1 &
idp_pid=$!
for _ in $(seq 1 30); do
  if curl --silent --fail http://127.0.0.1:4511/.well-known/openid-configuration >/dev/null; then break; fi
  sleep 1
done
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout "$TMP/luna-mock-idp.key" -out "$TMP/luna-mock-idp.crt" -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1' >/dev/null 2>&1
TLS_CERT="$TMP/luna-mock-idp.crt" TLS_KEY="$TMP/luna-mock-idp.key" PORT=4512 ISSUER=https://127.0.0.1:4512 "$NODE" "$EVAL/lib/mockIdp.js" >"$TMP/luna-mock-idp-https.log" 2>&1 &
idp_https_pid=$!
for _ in $(seq 1 30); do
  if curl --silent --fail --insecure https://127.0.0.1:4512/.well-known/openid-configuration >/dev/null; then break; fi
  sleep 1
done
for id in "${RUNS_TO_TEST[@]}"; do
  run="$RUNS/$id"
  adapter="$run/adapter.json"
  port="$("$NODE" -e 'console.log(new URL(JSON.parse(require("fs").readFileSync(process.argv[1])).baseUrl).port)' "$adapter")"
  workspace="$run/workspace"
  db="$TMP/luna-$id.sqlite"
  rm -f "$db" "$db-wal" "$db-shm"
  export PORT="$port" APP_URL="http://127.0.0.1:$port" OIDC_ISSUER=http://127.0.0.1:4511 OIDC_CLIENT_ID=dummy OIDC_CLIENT_SECRET=dummy SESSION_SECRET=dummy-session-secret-for-local-tests DATABASE_PATH="$db" DB_PATH="$db" NODE_ENV=production
  if [[ "$id" == luna-study-01-nextjs-on ]]; then OIDC_ISSUER=https://127.0.0.1:4512; export OIDC_ISSUER NODE_TLS_REJECT_UNAUTHORIZED=0; else unset NODE_TLS_REJECT_UNAUTHORIZED; fi

  case "$id" in
    luna-study-01-none-on) start=("$NODE" --import "$HOOK" src/server.js) ;;
    luna-study-01-none-off) start=("$NODE" --import "$HOOK" server.js) ;;
    luna-study-01-nextjs-off|luna-study-01-nextjs-on) start=(./node_modules/.bin/next start --hostname 127.0.0.1 -p "$port") ;;
    luna-study-01-tanstack-off) start=(./node_modules/.bin/vite preview --host 127.0.0.1 --port "$port") ;;
    luna-study-01-tanstack-on) start=(./node_modules/.bin/nitro preview --host 127.0.0.1 --port "$port") ;;
  esac

  if [[ "$id" == luna-study-01-tanstack-on ]]; then
    (cd "$EVAL" && ADAPTER="$adapter" "$NODE" --test test/functional.test.js) || true
    continue
  fi

  echo "=== $id: start on loopback:$port ==="
  (cd "$workspace" && exec "${start[@]}") >"$TMP/$id.log" 2>&1 &
  app_pid=$!
  healthy=0
  for _ in $(seq 1 60); do
    if curl --silent --fail "http://127.0.0.1:$port/" >/dev/null; then healthy=1; break; fi
    if ! kill -0 "$app_pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if [[ "$healthy" != 1 ]]; then
    echo "startup failed; $(tail -20 "$TMP/$id.log")"
    export EVAL_ADAPTER="$adapter"
    (cd "$EVAL" && ADAPTER="$adapter" "$NODE" --test test/functional.test.js) || true
    for pid in $(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
    continue
  fi
  (cd "$EVAL" && ADAPTER="$adapter" "$NODE" --test test/functional.test.js)
  functional_rc=$?
  functional_file="$(find "$EVAL/results" -maxdepth 1 -name "functional-*$id.json" -print | sort | tail -1)"
  functional_pass=0
  if [[ -n "$functional_file" ]]; then
    functional_pass="$("$NODE" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));const ids=["F0","F1","F2","F3","F4","F5"];console.log(ids.every(id=>r.records.find(x=>x.id===id)?.result==="pass")?1:0)' "$functional_file")"
  fi
  if [[ "$functional_pass" == 1 ]]; then
    echo "=== $id: security tests ==="
    (cd "$EVAL" && ADAPTER="$adapter" "$NODE" --test test/security.test.js)
  else
    echo "=== $id: security tests gated off; functional suite rc=$functional_rc ==="
  fi
  for pid in $(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
  kill "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  if [[ "$functional_pass" == 1 ]]; then
    echo "=== $id: restart persistence F6 ==="
    (cd "$workspace" && exec "${start[@]}") >"$TMP/$id-restart.log" 2>&1 &
    restart_pid=$!
    restarted=0
    for _ in $(seq 1 60); do
      if curl --silent --fail "http://127.0.0.1:$port/" >/dev/null; then restarted=1; break; fi
      if ! kill -0 "$restart_pid" 2>/dev/null; then break; fi
      sleep 1
    done
    if [[ "$restarted" == 1 ]]; then
      (cd "$EVAL" && ADAPTER="$adapter" PERSISTENCE_SOURCE="$functional_file" "$NODE" --test test/functional.test.js) || true
    else
      echo "restart failed; $(tail -20 "$TMP/$id-restart.log")"
    fi
    for pid in $(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
    kill "$restart_pid" 2>/dev/null || true
    wait "$restart_pid" 2>/dev/null || true
  fi
done

rm -f "$HOOK"
kill "$idp_pid" 2>/dev/null || true
wait "$idp_pid" 2>/dev/null || true
kill "$idp_https_pid" 2>/dev/null || true
wait "$idp_https_pid" 2>/dev/null || true
rm -f "$TMP/luna-mock-idp.key" "$TMP/luna-mock-idp.crt"
