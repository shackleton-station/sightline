# Decision 0009: the co-pilot on Claude, on the Anthropic API

**Status:** built on the branch `feat/copilot-on-claude` on 2026-11-12, for a draft pull request. Not
merged, so not deployed: merging applies Terraform and deploys the co-pilot. The timings below were run
on a laptop against the real API, and each says how. It follows [0004](0004-copilot-service.md), which
built the service, its circuit breaker and its retries around Gemini.

## The decision

The captain, 2026-11-12: the co-pilot and the typed-question box move from Gemini on Vertex AI to Claude
on the Anthropic API (the first-party API, not Claude on Vertex), so they spend the team's Anthropic
Console credits. In his words, the requirements were:

1. Replace every Gemini and Vertex AI call with the official Anthropic SDK.
2. Claude Opus 5.5 (`claude-opus-5-5`), fast speed, low effort. No `thinking` parameter, no assistant
   prefill, no forced `tool_choice`. Handle `stop_reason: "refusal"` and turn on server-side fallbacks
   (`fallbacks: "default"`).
3. Model, speed and effort are settings, so a switch to `claude-fable-5-2` at high effort, or to
   `claude-sonnet-5-5`, needs no code change.
4. Each model call keeps a 10-second limit. Time real requests, report p50 and p90, and if p90 is over the
   limit, stream or lower `max_tokens` rather than raise the timeout.
5. Keep any key out of code and git.

Two changes of plan came during the work, both from the captain through the parent session: daily
ceilings for typed questions, sized so that the co-pilot cannot spend more than about $15 a day; and
**no key at all**: the service signs in by Anthropic's workload identity federation instead of an API key
in Secret Manager.

## What changed, file by file

| Before (Gemini) | After (Claude) |
| --- | --- |
| `web/copilot/google.ts`, `vertexModel`: a `fetch` to `…/publishers/google/models/<model>:generateContent` with a Google access token | `web/copilot/claude.ts`: the SDK's `client.beta.messages.create`, signed in by federation (below). `google.ts` keeps only Pub/Sub |
| `web/copilot/model.ts`: `generate(body, signal) → Response` (raw HTTP) | `generate(request, signal) → BetaMessage`; errors are the SDK's typed `APIError`s, with status and headers |
| `web/copilot/chat/chat.ts`: `functionDeclarations`, `functionCall` parts, `functionResponse` parts, `toolConfig` mode `ANY` (forced), the last round restricted to `give_answer`, `thinkingConfig: low` | Anthropic tools with `input_schema`, `tool_use` blocks, `tool_result` blocks all in one user message, `tool_choice: auto`; the last round is *asked* to call `give_answer` (a forced call is a 400 on these models); effort `low` |
| `web/copilot/ask.ts`: `responseMimeType: application/json` with `responseJsonSchema` | Structured output: `output_config.format` with a JSON schema (every object closed). No forced tool, no prefill |
| `web/shared/tools/tools.ts`: Vertex's OpenAPI dialect (`STRING`, `OBJECT`) | JSON Schema; every object `additionalProperties: false`; `strict: true` where the API allows it (below) |
| `web/copilot/standIns.ts`: the scripted model and the fault switch answered Gemini-shaped HTTP | They answer Claude-shaped messages and throw the SDK's own errors, so the breaker and retries see exactly what the real client gives them |
| `web/copilot/index.ts`: `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION`, `GEMINI_MODEL` | `CLAUDE_MODEL`, `CLAUDE_SPEED`, `CLAUDE_EFFORT`, and the federation identifiers |
| `infra/copilot.tf`: `roles/aiplatform.user` for the co-pilot identity; `GEMINI_MODEL`, `VERTEX_LOCATION` | The role is gone. `CLAUDE_*` from variables, `ANTHROPIC_*` federation identifiers when set |

Nothing else called Gemini: the web server lost its co-pilot in pull request 135, and the briefing,
planner and globe code that mention "Gemini" or "vertex" in a search are shader vertices and old comments,
not calls. The pages' wording changed where it named the model: the privacy page, the typed-question box's
note and How it works.

## The request

Every call, from `claudeRequest` in `web/copilot/claude.ts` (tests in `claude.test.ts` check each shape):

| Field | Value | Why |
| --- | --- | --- |
| endpoint | `client.beta.messages.create` | Server-side fallbacks are a beta feature |
| `betas` | `["server-side-fallback-2026-07-01"]` | The `"default"` form needs this date of the header |
| `model` | `CLAUDE_MODEL`, default `claude-opus-5-5` | |
| `speed` | `CLAUDE_SPEED`, default `fast`; left out when the setting is empty | Fast mode is a top-level field, no beta flag, on Opus 5.5 and Fable 5.2. Sonnet 5.5 has no fast mode, so its request must not carry the field |
| `output_config.effort` | `CLAUDE_EFFORT`, default `low` | Thinking is always on with these models (adaptive); effort is the one control. Opus 5.5's own default is `medium` |
| `thinking` | not sent | Omitting it runs adaptive thinking; `disabled` is a 400 |
| `fallbacks` | `"default"` | On a safety decline the API runs the request again on the model Anthropic recommends for that kind of decline, in the same call |
| `tool_choice` | `auto` (with tools) | `any` and `tool` are a 400 on Opus 5.5, Sonnet 5.5 and Fable 5.2 |
| `max_tokens` | 2048 for a chat call, 1024 for a typed question | Thinking counts toward it. The most measured in one call was 598 output tokens (Fable 5.2 at high effort; 550 on Opus 5.5), and 61 for a typed question |
| `system` | the fixed rules, marked for the prompt cache | The same for every question |
| `cache_control` | `ephemeral` at the top level | Each later round of a question reads the earlier ones back from the cache |

**Tools.** Twelve, as before: eleven read-only data tools and `give_answer`. The API allows at most 24
optional parameters across all strict tools in one request, and each data tool that can try "what if"
limits has six optional ones, so `strict: true` is on only for the tools with no optional parameter
(`site_info`, `year_summary`, `compare_sites`, `spot_light`) and on `give_answer` (12 optional
parameters), whose shape matters most. A test counts them. The other tools check their own input
(`shared/tools/args.ts`) and tell the model what was wrong, as before.

**The loop.** Each of Claude's turns goes back to the API unchanged, its thinking blocks and any
`fallback` block included: with these models the API checks the thinking blocks against the conversation
that produced them, so the history is only ever appended to. The tools list never changes inside a
question. Every `tool_use` gets its `tool_result`, all in the next user message, in order. A turn with no
tool call (plain text) is asked once to call `give_answer`. The fourth round's message ends with "This is
your last turn: call give_answer now". The rules of what reaches the visitor are unchanged: the model
writes `{{r2.key}}` placeholders, the server fills in every number from the tool results, a draft with a
digit of its own is sent back once and then replaced by the facts, and every button is rebuilt from checked
parts.

**Stop reasons**, read before the content: `tool_use` runs the tools; `end_turn` with no tool call is
asked for `give_answer`; `max_tokens` runs nothing from that turn (a tool call in it may be cut off) and
answers from the facts in hand; `refusal` is below.

## Refusals and fallbacks

A refusal is an ordinary answer (HTTP 200, `stop_reason: "refusal"`), after the server-side fallback has
had its go. So:

- **The visitor** reads, for the co-pilot: "I can't answer that one: the language model behind me
  declined the question. I can tell you when the Sun and Earth are up at the listed sites, and when a
  landing fits your limits." Nothing the model wrote is shown. The typed-question box answers `422
  {"error":"declined"}`, which the page shows as "The language model declined that question…" (a new reply
  in `web/copilot/API.md`; an older page shows its general error).
- **The log** has one line with `stop_details.category` (`cyber`, `bio`, `reasoning_extraction`,
  `general_harms`, `frontier_llm`, or none), and the model's name when a fallback ran.
- **The question log and the day's counts** have it as its own outcome, `refused` (added at the end of
  `OUTCOMES` in `web/shared/events.ts` and as a counter in `web/shared/stats.ts`; additive, and the
  question log's `outcome` column is a string). A refused answer is never kept in the answer cache.
- **The circuit breaker** hears a success: the model answered. Five refusals in a row leave it closed
  (a test). Only failed calls (no answer in time, 429, 529, 5xx, a dropped connection) count against it.
- **A fallback that answers** is shown like any answer. The log line names the model that wrote it
  (`servedBy`), read from a `fallback_message` entry in `usage.iterations` (which also covers later turns
  that stay on the fallback model) or a `fallback` block. The question event has no field for it: the
  question log's table has a fixed schema, and a new column is a Terraform change of its own.

## The resilience code

- **One retry policy.** The SDK client's own retries are off (`maxRetries: 0`). `modelCall.ts` keeps its
  three tries with full jitter inside the request's deadline, honours `Retry-After` (fast mode has a rate
  limit of its own; a 429 says when to come back), and now also retries `529` (overloaded) and `409`.
  `429` and `529` after the last try are "busy" with a wait for the visitor; `400`, `401`, `403`, `404` and
  `413` are not retried and not held against the model.
- **Timeouts.** Each call still has 10 s (`MODEL_CALL_TIMEOUT_MS`), through the signal `modelCall.ts`
  passes; the SDK client's own timeout is the same 10 s, as a backstop. The typed-question box's call had
  20 s for one try; it now has 10 s per try inside the same 20 s request. The question's 25 s deadline is
  unchanged.
- **The breaker, single flight, cache keys** are unchanged. The fault switch (`MODEL_FAULTS`) throws the
  SDK's typed error for the status, so a drill exercises the same path as a real outage.
- **What is reported.** Every try is one log line, `"message":"model call"`, with its wall time, status,
  stop reason, the model that answered, `usage.speed`, input, output, cache-read and cache-write tokens,
  whether a fallback ran and any refusal category. The same numbers are on the try's step in the trace.
  Never the question, the answer, a token or a key.

## Signing in, with no stored key

The service signs in by Anthropic's **workload identity federation**:

1. The SDK asks for a Google identity token when it first needs one. On Cloud Run that is the metadata
   server, for the service's own account (`clps-copilot@…`), with audience `https://api.anthropic.com` and
   `format=full`, which puts the `email` claim in.
2. It trades the token at Anthropic's token endpoint (`POST /v1/oauth/token`, the jwt-bearer grant) for
   an access token, under a federation rule in the Claude Console that matches that one account on both
   its numeric id (`sub`) and its email, and the audience.
3. It calls the API with the access token and keeps it in its own cache. Before it runs out (the rule's
   lifetime, 600 s unless the rule says otherwise) the SDK asks for a fresh Google token (they last about
   an hour) and trades again. Nothing is written to disk, logged, or put in the status.

The settings are four identifiers, not secrets: `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`,
`ANTHROPIC_SERVICE_ACCOUNT_ID` and, optionally, `ANTHROPIC_WORKSPACE_ID`, set from
`infra/settings.auto.tfvars`. The client is given the federation provider explicitly, because an
`ANTHROPIC_API_KEY` in the environment would otherwise outrank it. On a laptop the same federation works
with the token from gcloud impersonating the co-pilot's account (`ANTHROPIC_IDENTITY_FROM_GCLOUD`, refused
on Cloud Run), or a developer's own `ANTHROPIC_API_KEY` from their shell. With neither, the co-pilot is
"not configured" and the scripted stand-in still works.

What this buys: nothing to leak or rotate, and access is revoked in one place (the federation rule). What
it costs: the sign-in depends on Anthropic's token endpoint as well as its API, and a misconfigured rule
shows up as `401` on every call (the Console's authentication history gives the reason).

The Secret Manager secret from pull request 141 was never used (no version was ever added) and was removed on
2026-11-13, with the pipeline's permissions for it.

## Timings

**How they were run** (2026-11-12, about 00:00 to 00:30 UTC on the 13th): the co-pilot service alone on a
laptop (`npx tsx copilot/index.ts`), memory instead of Redis, no question log, signed in by federation with
the identity token from gcloud impersonating `clps-copilot`, calling the real Anthropic API. Each server
was started fresh for each run, so no answer came from the cache. `chat-eval.mjs` asked the questions; the
service's `model call` log lines gave each try's time and tokens. One laptop, one evening, small samples:
read the numbers as "this order of size", not as a service-level figure.

- Claude Opus 5.5, fast, low effort: the full set once (13 questions) and the quick set twice (5 each),
  then 5 typed questions. **23 of 23 questions passed.**
- Claude Sonnet 5.5, no speed field, low effort: the quick set once and 2 typed questions. 5 of 5 passed.
- Claude Fable 5.2, fast, high effort: the quick set once and 2 typed questions. 5 of 5 passed.

**Each model call** (each answered try; wall time on the service's clock):

| Model | Calls | p50 | p90 | Max | Output tokens p50 / p90 / max | Cache read p50 | Cache write p50 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Opus 5.5, fast, low: chat | 46 | 1.38 s | 1.77 s | 8.00 s | 308 / 407 / 550 | 7,687 | 390 |
| Opus 5.5, fast, low: typed question | 5 | 1.32 s | 1.52 s | 1.52 s | 44 / 61 / 61 | 0 | 1,299 |
| Sonnet 5.5, standard, low: chat | 9 | 2.93 s | 4.76 s | 4.76 s | 292 / 383 / 383 | 7,100 | 589 |
| Fable 5.2, fast, high: chat | 8 | 1.75 s | 2.39 s | 2.39 s | 350 / 598 / 598 | 7,100 | 589 |
| Sonnet 5.5, standard, low: typed question | 2 | 1.30 s | 1.61 s | 1.61 s | 44 / 44 / 44 | 0 | 1,300 |
| Fable 5.2, fast, high: typed question | 2 | 0.55 s | 0.69 s | 0.69 s | 44 / 44 / 44 | 0 | 1,300 |

Uncached input was 2 to 4 tokens a call: everything else (the tools, about 7,100 tokens, the rules and
the conversation) was read from or written to the prompt cache. `usage.speed` said `fast` on every Opus
and Fable call and `standard` on every Sonnet call (which sent no speed field). No call ended in
`max_tokens` or `refusal`, and no fallback ran.

**One try timed out**: the very first call of the first run, at 10.0 s. Its retry took 8.0 s and wrote
7,687 tokens to the cache, so that question took 19.6 s, still inside its 25 s. The first call of a fresh
process signs in (gcloud, then the token exchange) and, the first time these tool schemas were seen,
compiles them into a grammar for the strict tools, which the API keeps for 24 hours; the next run's first
question took 3.5 s. Expect the same once after a deploy that changes the tools or the list of sites.

**Each question** (the time `chat-eval.mjs` saw, end to end, and the model's share of it):

| Model | Questions | p50 | p90 | Max | Model calls per question | Model time p50 / p90 |
| --- | --- | --- | --- | --- | --- | --- |
| Opus 5.5, fast, low | 23 | 2.5 s | 3.6 s | 19.6 s (the cold first one) | 2 (p90 3, max 3) | 2.52 / 3.54 s |
| Sonnet 5.5, standard, low | 5 | 5.2 s | 7.9 s | 7.9 s | 2 | 5.22 / 7.91 s |
| Fable 5.2, fast, high | 5 | 2.4 s | 4.0 s | 4.0 s | 2 | 2.39 / 3.92 s |

**The 10-second limit holds**: p90 per call is 1.77 s on the default settings, against 10 s. So no change
was needed to fit it: no streaming, and `max_tokens` came down from a first guess of 4,096 to 2,048 for
headroom over what replies use, not for time. For comparison, Gemini 3.5 Flash passed the same 12
questions with a median of 5.5 s a question (`docs/SYSTEM_DESIGN.md`).

## What a question costs, and the daily ceilings

List prices (the `claude-api` skill, cached 2026-11-03), per million tokens: Opus 5.5 $4 in / $20 out,
fast mode twice that ($8 / $40); cache reads $0.20 ($0.40 in fast mode); cache writes 1.25 times the input
price. Sonnet 5.5 $2 / $10, cache reads $0.10. Fable 5.2 $8 / $40, fast $16 / $80, cache reads $0.20.
**Assumption:** fast mode's doubling applies to cache reads and writes too; the skill states it only for
input and output.

| Model | A question (chat) | A typed question |
| --- | --- | --- |
| Opus 5.5, fast, low (default) | mean $0.037, p50 $0.034, p90 $0.051, max $0.104 (n = 23); warm runs alone: mean $0.028 | mean $0.012, max $0.016 (n = 5) |
| Sonnet 5.5, standard, low | mean $0.012 (n = 5) | $0.004 |
| Fable 5.2, fast, high | mean $0.098 (n = 5; one cold cache write of $0.15) | $0.030 |

On Opus 5.5 the output is 55% of a question's cost, cache writes 28% and cache reads 16%. The dearest
question, $0.104, is the first after the cache has gone cold: it writes the tools and rules (7,687
tokens) at the cache-write price. The cache lasts 5 minutes, so on a quiet day most questions can be that
first one. The timing runs above cost about $1.54 at list price, in 74 tries.

**The daily ceilings** (`web/copilot/limits.ts`), so that the co-pilot cannot spend more than about $15
a day at the default model and speed, with each question priced at the dearest measured:

```
chat questions, everyone, per day:   120 × $0.1037 = $12.44
typed questions, everyone, per day:  150 × $0.0155 =  $2.33
                                                     ------
at most                                              $14.77 a day
```

**Since 2026-11-13 the ceilings are settings** (Terraform's `copilot_limits`, read as `COPILOT_LIMIT_*`; the numbers
above stay the defaults). For the hackathon they are 400 chats and 600 typed questions a day for everyone, at
most about $50.78 a day, and 100 and 150 per address, because a whole venue shares one address
(`docs/DEPLOY.md`, "Hackathon settings").

Per visitor, by default: 20 questions and 30 typed questions a day (they were 60 and none). The per-minute limits are
unchanged. A refused question answers `429` with `Retry-After` until the oldest counted question of the
day is a day old, as the chat's daily limit always has. What this leaves out: a try that timed out may
still be billed for what the model generated before the cut-off, and a question that needs all five
rounds would cost more than any measured (none needed more than three).

**What it means for the event:** 120 questions a day for everyone is fewer than the baseline day's 158.
Each co-pilot deploy also asks its five set questions and one streamed question from the runner, about
$0.15 and 6 of the day's 120. With the captain's $100 for a week, the alternatives are a higher ceiling
at the same model (each extra 100 questions is about $10 a day at the worst case) or Sonnet 5.5 at
standard speed, about a third of the cost a question, which passed the quick set but took twice as long.

## Settings and switching

| Setting | Default | Switch to |
| --- | --- | --- |
| `claude_model` (`CLAUDE_MODEL`) | `claude-opus-5-5` | `claude-fable-5-2`, `claude-sonnet-5-5` |
| `claude_speed` (`CLAUDE_SPEED`) | `fast` | `""` for Sonnet 5.5 (no speed field), `standard` |
| `claude_effort` (`CLAUDE_EFFORT`) | `low` | `high` with Fable 5.2; any of `low` to `max` |

A switch is one line in `infra/settings.auto.tfvars`, merged: Terraform changes the setting, which starts a
new revision. The status (`/api/chat/status`) reports `modelSettings`: the model, speed, effort, fallbacks
and how the service signs in.

## What is not done, or not checked

- **Not deployed.** Nothing here ran on Cloud Run. The federation was proven from Cloud Run by the parent
  session (an exchange returned a 10-minute token in 222 ms), but not this code's metadata-server path.
- **No refusal and no fallback was seen live**: the set questions trigger neither. Both are covered by
  tests with a fake client, built from the SDK's types.
- **The Gemini window at merge**: Terraform removes the Vertex AI role before the new image is live, so for
  a few minutes the old revision's calls fail (`docs/DEPLOY.md`, "The switch from Gemini to Claude").
- **Cloud Run and an empty setting**: `claude_speed = ""` is passed as `none` rather than an empty value,
  because whether Cloud Run passes an empty variable through was not checked.
- **A laptop gotcha**: a shell started by Claude Code has its own `CLAUDE_EFFORT` (it is Claude Code's own
  setting), which the co-pilot reads. The first local run went out at `high` effort because of it, and was
  discarded. Cloud Run sets the variable itself. The start-up log line names the effort in use.
- **The question log's table** still describes `outcome` as "answered, fallback, busy or error", and its
  daily-summary view counts no `refused` column. Rows with `refused` are written all the same (the column
  is a string); updating the description and the view is a small Terraform change of its own.
- **Prompt caching for typed questions**: the whole typed-question prompt is written to the cache at 1.25
  times the input price and never read back, because each question differs. Leaving the cache off for
  requests without tools would save about $0.003 a typed question; left as measured.
- **Prices** are the skill's cached list prices, not an invoice; fast-mode cache prices are assumed.
