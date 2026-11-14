#!/usr/bin/env bash
# Runs everything the site has on the server side, locally: the web server on :8080 (for `npm run dev`
# to forward /api, /tiles and /media to), the events worker on :8081, which counts co-pilot
# questions, the plans service on :8082, which saves and opens shared plans, and the co-pilot
# service on :8083, which answers /api/chat and /api/ask. All four reload when their code changes.
#
# The services call Google Cloud as you (the bucket, plans, Scout's voice): sign in once with
# `gcloud auth login`. The token lasts an hour, so restart this if the API starts answering "upstream".
#
# The co-pilot's model is Claude on the Anthropic API (docs/decisions/0009-copilot-on-claude.md). It
# takes how to sign in from your own environment, never from a file in the repository:
#   - the federation settings the service uses in the cloud (ANTHROPIC_FEDERATION_RULE_ID,
#     ANTHROPIC_ORGANIZATION_ID, ANTHROPIC_SERVICE_ACCOUNT_ID) with
#     ANTHROPIC_IDENTITY_FROM_GCLOUD=clps-copilot@clps-compute-6z1nc.iam.gserviceaccount.com, which
#     gets the identity token from gcloud by impersonating the co-pilot's account (you need Token
#     Creator on it); or
#   - your own ANTHROPIC_API_KEY, exported in your shell.
# CLAUDE_MODEL, CLAUDE_SPEED and CLAUDE_EFFORT pass through too. Careful: a shell started by Claude
# Code has its own CLAUDE_EFFORT (for Claude Code itself), which the co-pilot would pick up; the service
# logs its model, speed and effort when it starts, so check that line. With neither way in, the co-pilot
# answers 503 "not-configured". With FAKE_MODEL=on a scripted stand-in answers instead of Claude, so
# the co-pilot works with no account and costs nothing.
#
# What stays in memory here, where the cloud has a service: the rate limits, the answer cache, the
# event outbox and the circuit breaker (Redis is on a private network); the queue (the co-pilot sends
# each event straight to the worker, shaped as Pub/Sub would push it); and the counts (the worker
# keeps them and the web server asks it for them, where the cloud has a Firestore database the web
# server reads); and the load balancer's path rules (the web server passes /api/plans on to the plans
# service, and /api/chat and /api/ask on to the co-pilot service, itself).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f dist/index.html ] || npm run build
if [ "${FAKE_MODEL:-}" != "on" ]; then
  export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
fi
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-clps-compute-6z1nc}"
export ASSET_BUCKET="${ASSET_BUCKET:-clps-compute-6z1nc-web-assets}"
# Shared mission plans go to the real Firestore database, as you (the plans service below uses this).
# Redis is on a private network, so locally the rate limits and the answer cache stay in each
# process's memory. Start with PLANS_DATABASE= (empty) to keep plans in memory too.
export PLANS_DATABASE="${PLANS_DATABASE-plans}"
# Scout's voice is Cloud Text-to-Speech, called as you and billed to the project above.
export VOICE="${VOICE:-on}"
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:5173,http://localhost:5179}"
DATA_VERSION="$(node scripts/data-version.mjs public/data | sed 's/.*:"\(.*\)"}/\1/')"
CODE_VERSION="$(node scripts/copilot-version.mjs | sed 's/.*:"\(.*\)"}/\1/')"

# The events worker, beside the web server. It gets none of the settings above that would point it at
# the cloud: its counts stay in its own memory, and it asks nobody who they are.
WORKER_PORT="${WORKER_PORT:-8081}"
trap 'kill ${WORKER_PID:-} ${PLANS_PID:-} ${COPILOT_PID:-} 2>/dev/null || true' EXIT INT TERM
env -u GOOGLE_CLOUD_PROJECT -u GOOGLE_OAUTH_ACCESS_TOKEN PORT="$WORKER_PORT" LOCAL_READS=on DATA_VERSION="$DATA_VERSION" \
  npx tsx watch events-worker/index.ts &
WORKER_PID=$!
export STATS_URL="${STATS_URL:-http://localhost:$WORKER_PORT/counts}"

# The plans service, beside them. It reads the database setting above and keeps its rate limits in
# its own memory. The page's requests reach it through the web server (PLANS_URL), which is this
# machine's stand-in for the load balancer, so the service is told the web server's origin too.
PLANS_PORT="${PLANS_PORT:-8082}"
env -u REDIS_HOST PORT="$PLANS_PORT" DATA_DIR=public/data DATA_VERSION="$DATA_VERSION" \
  ALLOWED_ORIGINS="$ALLOWED_ORIGINS,http://localhost:${PORT:-8080}" \
  npx tsx watch plans/index.ts &
PLANS_PID=$!
export PLANS_URL="${PLANS_URL:-http://localhost:$PLANS_PORT}"

# The co-pilot service, beside them, the same way: the web server passes /api/chat, /api/chat/* and
# /api/ask on to it (COPILOT_URL). It sends each question event straight to the worker. It inherits
# the ANTHROPIC_* and CLAUDE_* settings from your shell; nothing here sets or prints them.
COPILOT_PORT="${COPILOT_PORT:-8083}"
env -u REDIS_HOST PORT="$COPILOT_PORT" DATA_DIR=public/data DATA_VERSION="$DATA_VERSION" CODE_VERSION="$CODE_VERSION" \
  EVENTS_PUSH_URL="${EVENTS_PUSH_URL:-http://localhost:$WORKER_PORT/push}" \
  ALLOWED_ORIGINS="$ALLOWED_ORIGINS,http://localhost:${PORT:-8080}" \
  npx tsx watch copilot/index.ts &
COPILOT_PID=$!
export COPILOT_URL="${COPILOT_URL:-http://localhost:$COPILOT_PORT}"
# /api/status/services asks the two services how they are. Locally there is no identity to sign
# with, so it asks their public status.
export PLANS_STATUS_URL="${PLANS_STATUS_URL:-$PLANS_URL}"
export COPILOT_STATUS_URL="${COPILOT_STATUS_URL:-$COPILOT_URL}"

npx tsx watch server/index.ts
