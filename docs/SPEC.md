# GitHub Watcher — Pebble App Spec

A Pebble watchapp for at-a-glance GitHub CI status and a few decisive one-tap actions.
Phone-side JavaScript does all the thinking; the watch renders and takes input.

## 1. Guiding principles

1. **Thin C, fat JS.** All business logic (GitHub client, rate limiting, QR encoding,
   timeline estimation, view-model shaping) lives in `src/pkjs` (JavaScript), which is
   unit-testable in Node and where maintained libraries exist. The C app is presentation +
   input + AppMessage transport only. This is what makes TDD feasible on Pebble.
2. **Reuse, don't rebuild.** Use existing libraries for config UI, QR generation, and testing.
   The only hand-written "algorithms" are the trivial ones (drawing a QR grid pixel-by-pixel,
   packing bits) — and even those are isolated into pure modules with tests.
3. **Battery- and rate-limit-first.** Poll on a schedule, use ETag conditional requests, and
   back off adaptively. Never tight-loop.
4. **Graceful degradation.** Every screen has a "stale / disconnected / no token" state.
   Design for 1-bit (aplite/diorite) first; color is an enhancement.

## 2. Architecture

```
┌────────────── WATCH (C, src/c) ──────────────┐        ┌─────────── PHONE (JS, src/pkjs) ───────────┐
│  Screens:                                     │        │  brain/ (all logic, unit-tested):          │
│   • Sign-In (device code + QR)                │        │   • auth            (device flow + refresh)│
│   • Board  (MenuLayer)   ── request ─────────▶│  AppMsg │   • github-client   (REST via XHR)         │
│   • Detail (failing jobs)◀── view-model ──────│◀──────▶│   • rate-governor   (ETag + backoff)       │
│   • QR     (pixel draw)                       │        │   • qr-encoder      (qrcode-generator)     │
│   • Confirm/Action menu (ActionBarLayer)      │        │   • timeline-planner(pin estimation)       │
│  Pure modules (host-tested w/ Unity):         │        │   • codec           (AppMessage (de)serial)│
│   • qr_unpack / grid scaling                  │        │   • config-store    (reads Clay settings)  │
│   • view_model formatting                     │        │  Clay config page (token + watched repos)  │
└───────────────────────────────────────────────┘        └────────────────────────────────────────────┘
                                                    │ XHR(+ETag)  │ device flow     │ getTimelineToken
                                                    ▼             ▼                 ▼
                                             api.github.com  github.com/login   timeline-api.rebble.io
```

The watch holds almost no state. pkjs is the source of truth; on each screen the watch asks
pkjs for a compact view-model and renders it.

## 3. Libraries (use these — do not hand-roll)

| Need | Library | Notes |
|------|---------|-------|
| Phone config page (token, repo list) | **pebble-clay** | `pebble package install pebble-clay`. Generates the settings webview from a JSON schema, persists to `localStorage`, delivers values as message keys. This is the standard; do not hand-build a `showConfiguration` webview. |
| QR matrix generation (JS) | **qrcode-generator** (`qrcode-generator` on npm, kazuhikoarase) | Tiny, zero-dep, returns a module bit-matrix. We only pack+send the matrix; the watch draws it. |
| JS unit tests | **Jest** | Runs the whole `brain/` in Node with mocked HTTP. |
| C unit tests (pure modules) | **Unity** (ThrowTheSwitch) | Host-compiled tests for `qr_unpack` / `view_model`, built against a mock `pebble.h`. |
| C AppMessage handler ergonomics (optional) | **pebble-events** | Community package; cleaner multi-subscriber AppMessage registration. Optional — evaluate before adopting. |

**Open decision — GitHub client:** default to **plain REST over `XMLHttpRequest`** with a thin
wrapper (calling a documented HTTP API is not "rebuilding a library"). Octokit is evaluated but
likely too heavy for the pkjs sandbox — to be validated by measuring bundle size / sandbox
compatibility before committing. See §12.

## 4. Feature specs

### 4.0 Authentication — GitHub OAuth device flow  *(primary)*, PAT *(fallback)*
No encrypted storage exists on the platform (§6), so auth minimizes both blast radius and secret
lifetime: prefer short-lived, revocable, least-privilege credentials over a pasted static token.

**Prerequisite (one-time, by the app author):** register **one** **GitHub App** (preferred over an
OAuth App — it grants fine-grained *permissions* rather than coarse *scopes*) with **device flow
enabled** and **expiring user tokens** on. Set installation to **"Any account"** and make it **public**
for distribution (or *"Only this account"* for a personal build). Its `client_id` is public and safe to
commit; it ships as a build constant in `src/pkjs/config.js` (overridable via a Clay "advanced" field).
Requested permissions = the least-priv set in §6. **Distribution model:** every end user installs this
single shared app on their own account (selecting their own repos) and signs in via device flow,
receiving a per-user, per-installation token isolated to their repos — user-to-server rate limits are
per-user, so it scales. No client secret is required (device flow is built for secret-less clients).

**Why device flow runs in pkjs, not the Clay page:** the Clay config page is a real WebView, where
GitHub's OAuth endpoints are blocked by CORS. pkjs runs in the native JS sandbox where CORS does not
apply, so all device-flow HTTP happens there.

**Flow (`brain/auth.js`):**
1. Watch shows the **Sign-In** screen when no valid token exists.
2. pkjs `POST https://github.com/login/device/code` (client_id) → `{device_code, user_code,
   verification_uri, interval, expires_in}`.
3. Watch displays `user_code` as large text **plus a QR** (reusing the QR bridge) to
   `https://github.com/login/device`, so the user opens the page on phone/desktop and enters the code.
4. pkjs polls `POST https://github.com/login/oauth/access_token`
   (grant_type `urn:ietf:params:oauth:grant-type:device_code`) every `interval` s, handling
   `authorization_pending` / `slow_down` / `expired_token` / `access_denied`.
5. On success, store `{access_token, refresh_token, expires_at}` in `localStorage`; watch proceeds to
   the Board.
6. **Refresh:** `github-client` asks `auth.getAccessToken()` before each call; if expired, pkjs
   silently refreshes via `grant_type=refresh_token`. Only if refresh fails does the watch return to
   Sign-In.

**PAT fallback:** a Clay text field (§6) accepts a fine-grained PAT for users who prefer to paste one.
If present, it takes precedence and the device flow is skipped. Same least-priv permissions apply.

**Tested (Jest):** device-code request; poll loop with fake timers across pending/slow_down/success;
token persistence; expiry → refresh; refresh-failure → re-auth signal; PAT-present short-circuit.

### 4.1 CI Status Board  *(like #1, #7)*
- **Screen:** `MenuLayer`; one row per watched pipeline = status dot + `owner/repo:branch` + age
  ("2m", "1h"). Row color/glyph: green=success, red=failure, amber=in-progress, grey=stale/unknown.
- **Data owner:** pkjs. On open (and on refresh), pkjs fetches latest run per configured target and
  returns a list of compact board items via the codec.
- **GitHub endpoints:** GitHub Actions — `GET /repos/{o}/{r}/actions/runs?branch={b}&per_page=1`
  (latest run + `conclusion`/`status`), or `GET /repos/{o}/{r}/commits/{sha}/check-runs` /
  `/status` for non-Actions CI. Config picks which per target.
- **Config (in-app / Clay):** list of targets, each `{owner, repo, branch?, workflow?}`; user can
  scope to specific repos/pipelines. Empty branch = default branch.
- **Input:** up/down navigate, select → Detail, long-select → Action menu.

### 4.2 App Glance  *(like #2)*
- **What:** launcher subtitle summarizing the most important target, e.g. `api:main ✗ · 2 more red`.
- **Reality to design around:** App Glance can **only be written by the foreground C app**
  (`app_glance_reload`). pkjs cannot set it directly. So the flow is: pkjs computes the glance
  string after each poll → sends it to C → C persists it and calls `app_glance_reload` on `deinit`
  (and on wakeup-refresh). The glance therefore reflects "as of the last time the app ran (opened or
  woke)." Freshness between opens comes from **wakeup refreshes** (§4.6) and **timeline pins** (§4.5).
- **Config:** which target drives the glance (default: first failing, else first target).

### 4.3 Generic QR Bridge  *(like #3)*
- **What:** for whatever entity is selected (PR, run, commit, issue), long-select → **QR** screen
  rendering a scannable code of its `html_url`, to open on phone/desktop. Generic: any URL in.
- **Pipeline:**
  1. pkjs `qr-encoder` runs `qrcode-generator` on the URL → module matrix (e.g. 29×29 for a PR URL).
  2. `codec` packs 1 bit/module + `{version, size}` header; chunks across AppMessage frames if needed.
  3. C `qr_unpack` reconstructs the bit grid; the QR `Layer` update proc draws each module with
     `graphics_fill_rect`, auto-scaling to fit the screen with a 4-module quiet zone (`layer_get_bounds`,
     round-safe).
- **Tested:** JS packing and C unpack/scale are pure → unit-tested both sides. 1-bit friendly (works on aplite).

### 4.4 Actions: Re-run failed jobs & Merge-when-green  *(like #4)*
- **Screen:** from Detail, long-select opens an `ActionBarLayer`/menu with contextual actions:
  - **Re-run failed jobs** (shown when latest run failed): `POST /repos/{o}/{r}/actions/runs/{run_id}/rerun-failed-jobs`.
  - **Merge** (shown only when PR `mergeable_state == clean` and required checks green):
    `PUT /repos/{o}/{r}/pulls/{n}/merge`. **Confirmation screen required** before firing.
- **NOT included (by request):** approve-from-watch and canned comments — deliberately omitted to
  avoid encouraging rubber-stamping.
- **Data owner:** pkjs executes the call, returns success/failure; C shows result + `vibes_short_pulse()`.

### 4.5 "Build-likely-done" alerts — local wakeup + optional timeline pins  *(like #5)*
Covers the case where GitHub's own signal is late: alert the user around when a build *should* finish,
based on typical pipeline timing.

- **Estimation (shared):** when a run enters `in_progress`, `timeline-planner` estimates completion
  from the trailing average duration of the last N runs of that workflow
  (`GET .../actions/runs` history).
- **Primary path — local, always on, no external dependency:** schedule a local **`wakeup`** at the
  estimated finish. On wake, the app relaunches, polls GitHub once, and `vibes_short_pulse()` +
  updates the board and glance. The only external service in this loop is GitHub itself.
- **Optional surface — timeline pins (Clay checkbox "Use timeline pins", default *checked*):** when
  enabled, *also* push a timeline pin at the estimated finish so the entry appears in the phone/watch
  timeline UI ("api:main build likely done — tap to check"); the pin is updated/replaced with the real
  conclusion on the next poll. Mechanism: `Pebble.getTimelineToken()` →
  `PUT https://timeline-api.rebble.io/v1/user/pins/{id}`.
  - **Dependency:** timeline pins rely on the **rebble-hosted** timeline service. If the box is
    unchecked, or the service is unavailable, the app **still works** — the local wakeup path above
    delivers the alert regardless. Pins are additive polish, never load-bearing.
- **Tested:** estimation, wakeup scheduling, and pin payload logic in JS; HTTP PUT mocked; behavior
  asserted with the toggle both on and off.

### 4.6 Rate-limit governance  *(like #6)*
- `rate-governor` module owns every outbound GitHub call:
  - Sends `If-None-Match` with cached ETags (per endpoint, in `localStorage`). A **304 response does
    not count against the REST rate limit** — this is the main lever.
  - Reads `x-ratelimit-remaining` / `x-ratelimit-reset`; when remaining is low, lengthens the poll
    interval (adaptive backoff). Honors `Retry-After` on secondary-limit responses.
  - Exposes current budget so a "rate" line can be shown (debug) and so the board refuses to hammer.
- **Tested:** deterministic unit tests feeding synthetic headers → asserting next-poll delay and
  whether a request is skipped/served-from-cache.

## 5. AppMessage protocol (sketch)

Flat dictionaries, small. A single `MSG_TYPE` key discriminates; `codec` owns (de)serialization on
both sides so the wire format is defined and tested in one place.

- **C → JS:** `REQUEST_BOARD`, `REQUEST_DETAIL{target_id}`, `REQUEST_QR{entity_id}`,
  `ACTION_RERUN{run_id}`, `ACTION_MERGE{pr_id}`, `SET_GLANCE_ACK`, `REFRESH`.
- **JS → C:** `BOARD_ITEM{idx,count,label,status,age_s}` (sequence for the list),
  `DETAIL{...}`, `QR_CHUNK{seq,total,version,bytes}`, `GLANCE{text,icon}`, `ACTION_RESULT{ok,msg}`,
  `RATE{remaining,reset_s}`, `ERROR{code,msg}`.

Lists/large payloads are chunked (sequence + total). Buffers sized to the largest frame (QR chunk).
`messageKeys` are declared in `package.json`; keep names identical to the codec's.

## 6. Config (Clay) & token

**Clay schema fields:**
- **Watched targets** — repeating group: owner/repo, optional branch, optional workflow.
- **Poll interval**; **glance target**.
- **"Use timeline pins"** — checkbox, default **checked**. Unchecked → build-done alerts still fire via
  the local wakeup path (§4.5), just without the timeline entry.
- **"GitHub Personal Access Token (optional)"** — secured text; fallback to the device flow (§4.0).
  Field help text (verbatim, shown under the input):
  > Leave blank to sign in with GitHub on your watch. To use a token instead, create a **fine-grained
  > personal access token** scoped to only the repositories you watch, with these repository
  > permissions: **Metadata: Read** (required), **Actions: Read and write** (view runs + re-run failed
  > jobs), **Checks: Read**, **Commit statuses: Read**, **Pull requests: Read and write** (view + merge
  > when green), **Contents: Read**. Grant nothing else.
- **"GitHub App Client ID (advanced)"** — optional; overrides the built-in device-flow `client_id`.

**Least-privilege set (single source of truth)** — used for both the GitHub App permissions (device
flow) and the fine-grained PAT fallback. Verify exact names against current GitHub docs at build time:

| Permission | Level | Needed for |
|------------|-------|-----------|
| Metadata | Read | required baseline |
| Actions | Read & write | board (run status) + re-run failed jobs |
| Checks | Read | build/check status |
| Commit statuses | Read | legacy status API |
| Pull requests | Read & write | PR view + merge-when-green |
| Contents | Read | resolve branch/commit refs |

**Token storage (residual risk, documented):** device-flow tokens and any PAT live in phone
`localStorage` — **not encrypted at rest**, protected only by OS app sandboxing. Mitigations already in
the design: least-privilege permissions (above), short-lived + revocable device-flow tokens, and the
token never leaving pkjs (never sent to the watch over AppMessage).

## 7. Repo layout

```
package.json          # pebble object + messageKeys + resources; deps: pebble-clay, qrcode-generator
wscript
src/c/
  main.c              # app lifecycle, window routing
  screens/*.c         # sign-in, board, detail, qr, action (thin — call view_model, render)
  lib/
    qr_unpack.{c,h}   # pure: bytes -> grid  (Unity-tested)
    view_model.{c,h}  # pure: formatting/age strings (Unity-tested)
src/pkjs/
  index.js            # glue: AppMessage <-> brain, Clay wiring
  config.js           # build constants (device-flow client_id — public)
  brain/
    auth.js           github-client.js  rate-governor.js  qr-encoder.js
    timeline-planner.js  codec.js  config-store.js
  __tests__/          # Jest specs (written first)
test/c/               # Unity harness + mock pebble.h for lib/ modules
docs/SPEC.md
```

## 8. TDD plan (write tests first)

**JavaScript (Jest, `src/pkjs/__tests__`)** — the bulk of the coverage:
- `auth`: device-code request; poll loop (fake timers) across `authorization_pending`/`slow_down`/
  success/`expired_token`; token persistence; expiry → silent refresh; refresh-failure → re-auth
  signal; PAT-present short-circuits the device flow.
- `github-client`: builds correct URLs/headers (incl. `Authorization` from `auth`); maps responses →
  view-models. HTTP mocked.
- `rate-governor`: ETag store round-trip; 304 → cache hit, no budget spend; low-remaining → backoff
  delay; `Retry-After` honored.
- `codec`: serialize→deserialize round-trips for every message type; chunking reassembles.
- `qr-encoder`: known URL → expected matrix dimensions; bit-packing byte-exact against a fixture.
- `timeline-planner`: N historical durations → expected ETA and pin payload; result → pin replacement.
- `config-store`: parses Clay output; normalizes targets; surfaces PAT + client-id override; timeline
  toggle default true.

**C (Unity, `test/c`)** — only the pure modules, host-compiled against a mock `pebble.h`:
- `qr_unpack`: packed bytes → exact grid (mirror of the JS packer fixture — cross-checks the protocol).
- `view_model`: age formatting boundaries (59s→"59s", 60s→"1m", …), label truncation.

**Integration (manual/CI-assisted):** run `brain/` against **recorded GitHub fixtures**; load on
`pebble install --emulator` for real-device smoke of rendering, input, QR scan, and actions.

## 9. Milestones

1. **Skeleton + protocol:** codec (JS+C) with tests; board request/response round-trip showing static
   fake data on the emulator. *(proves the transport)*
2. **Auth:** device flow + refresh (`brain/auth.js`) with tests; Sign-In screen showing the user code
   as **text** (QR retrofitted at M5); PAT fallback via Clay. *(nothing fetches real data without this)*
3. **GitHub client + rate governor:** real board data; ETag/backoff tested. Clay config for targets.
4. **App Glance:** compute in JS, set from C on deinit; wakeup-refresh.
5. **QR bridge:** encoder (JS) + unpack/draw (C), scan-verified on emulator (also reused by Sign-In).
6. **Actions:** re-run + merge-when-green with confirmation.
7. **Timeline pins:** estimation + rebble timeline PUT, behind the default-on config flag.

## 10. Decisions (resolved)

- **GH client:** raw REST over `XMLHttpRequest` with a thin wrapper. Lightest, fits the pkjs sandbox,
  fully mockable in Jest.
- **C test investment:** minimal thin-C — only `qr_unpack` and `view_model` get Unity host-tests;
  everything else logic-heavy lives in JS.
- **Target platforms:** all five (aplite, basalt, chalk, diorite, emery), designed 1-bit-first with
  color as an enhancement.
- **Timeline pins:** included as a **default-checked** Clay toggle, layered on top of the always-on
  local wakeup alert path (§4.5). Unchecking it (or the rebble service being down) does not break the
  build-done alert.
```
