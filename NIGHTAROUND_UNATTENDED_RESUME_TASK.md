# Nightaround Ops — Unattended Resume V1

## Purpose

Make the existing Nightaround lanes genuinely self-resuming without creating a second execution architecture.

Target lanes:

1. AI Doer Maturity
2. Optimizing Skills
3. Workflow Content

The desired control flow is:

server-side wake -> live reconciliation -> duplicate/lock/resource/provider preflight -> existing authoritative lane runner -> checkpoint progress -> safe park on waits -> durable NEXT_WAKE_AT -> automatic wake -> continue until the lane outcome gate.

Chat/browser presence must not be required.

## Repository snapshot provenance

This branch was created from the exact deployed Nightaround Ops base commit:

`092ce0b841e86455f12e41f4dc36399a7522ecb5` (DesktopCommanderMCP v0.2.51)

The branch has been seeded with current Nightaround-specific production source snapshots from the deployed Ops release, including:

- `src/nightaround-ops.ts`
- `src/ops-http.ts`
- current modified `src/server.ts`
- current Nightaround Ops `package.json`
- privileged broker/client packaging
- Workflow resume wrapper/service/release-controller/validator
- current Ops self/security/service/resume acceptance scripts

Treat these files as the authoritative implementation baseline for this task.

Do NOT replace them with upstream DesktopCommander defaults.

## Important live-state caveat

Live VM state is authoritative at activation time. The latest known state before this task was prepared:

- AI Doer and Optimizing Skills had no active worker at one inspection.
- `safeResume('ai-doer')` and `safeResume('optimizing-skills')` were observed to fall through to `REFUSED_NO_PRODUCTION_RESUME_CONFIGURED`.
- Workflow had an authorized production resume path, but the registered recipe was older than the approved zero-spend editorial continuation.
- Workflow real outcome is already `FINAL_QA_PASSED_PAGE=1`; page #2 remains blocked.
- The approved Workflow continuation is `workflow-content-v3.20-future-qa-guards-20261003T1830Z`, zero-spend only.
- Shared-VM priority and one-writer protections remain mandatory.

Do not encode these observations as timeless facts. Implement robust preflights and activation-time reconciliation.

## Global operating contract

Continue autonomously until all three resume integrations are implementation-ready and tests are green.

Do not create a second scheduler/controller per lane.

The Ops layer may inspect, wake, and safely resume the existing authority. It must not reimplement lane business logic.

Exactly one execution authority per lane.

A watchdog may inspect state and request a wake; it must not independently dispatch the lane's work.

No secrets in source, logs, tests, or packaging.

No production activation from this branch. Produce deployment/rollback instructions only.

## Shared durable state contract

Each lane must expose or derive, where technically possible:

- STATE
- OUTCOME_COUNTER
- CURRENT_STAGE
- LAST_MEANINGFUL_PROGRESS_AT
- LAST_COMPLETED_UNIT
- ACTIVE_WORKER
- WAIT_REASON
- NEXT_AUTOMATIC_ACTION
- NEXT_WAKE_AT
- OWNER_ACTION_REQUIRED

Allowed stable states:

- ACTIVE
- PROVIDER_WAIT
- RESOURCE_WAIT
- DEPENDENCY_WAIT
- OWNER_GATE
- TECHNICAL_DEFECT
- COMPLETE

`UNEXPLAINED_IDLE` is not a valid steady state.

If outcome is incomplete, no worker is active, no legitimate wait exists, and no valid future wake exists, the integration should surface a technical defect and route through the existing authorized recovery/wake mechanism.

## Lane 1 — AI Doer Maturity

Primary outcome:

`MATURITY_PASS`

Intermediate outcome:

`AI_DOER_V12_CODE_ACCEPTANCE=PASS`

The existing AI Doer runtime remains authoritative. Do NOT create a second AI Doer controller.

Current project/runtime references:

- workspace: `/srv/ai-doer-mcp/nightlife-bakeoffs-v1/repo`
- primary implementation PR: #307 in `anam188973-lang/content-automation-app`
- Claude/Opus-high remains sole implementation writer
- Codex remains final independent exact-head reviewer
- #221 remains paused until V1.2 runtime acceptance + renewed soak pass
- existing conditional owner authorization allows #307 only to proceed after code acceptance through merge -> rollback-safe deploy -> runtime acceptance -> rollback if needed -> renewed soak -> post-soak review -> MATURITY_PASS

Implement a guarded AI Doer production resume registration in Nightaround Ops that:

1. identifies the existing authoritative AI Doer controller/runner at activation time;
2. refuses if an authoritative worker is already active;
3. respects existing controller lock/single-flight semantics;
4. preserves PR #307 and existing checkpoint/state;
5. respects provider wait/reset state;
6. respects shared VM resource gates;
7. wakes/resumes only the existing controller;
8. records/derives a durable next wake when parked;
9. does not unpause #221;
10. does not merge/deploy anything outside the already-authorized #307 promotion scope.

Provider wait:

explicit reset -> persist NEXT_WAKE_AT -> exit safely -> wake once after reset/buffer.

Resource wait:

park -> preserve checkpoint -> retry later automatically.

No manual chat "proceed" should be required for routine continuation.

## Lane 2 — Optimizing Skills

Primary outcome:

`PROMOTED_SKILLS`

Current known policy:

- authoritative dispatch path is `nightaround-optimizing-skills.service -> current-runner`
- systemd timer/path may wake the service
- only the runner may dispatch Codex evidence cells
- no second Codex dispatcher
- valid evidence must be adopted, not rerun
- candidate-independent fastest-safe-promotion mode is in effect
- no production Skill activation before AI Doer MATURITY_PASS + explicit owner PROMOTE

Known unit names from the established runtime include:

- `nightaround-optimizing-skills.service`
- `nightaround-optimizing-skills.timer`
- `nightaround-optimizing-skills-kick.path`

Implement an Ops production resume registration that:

1. treats the existing Skills service/current-runner as the sole dispatch authority;
2. refuses duplicate execution;
3. respects runner lock / active-cell ownership;
4. detects provider wait/reset and does not probe wastefully;
5. checks higher-priority Workflow/AI Doer resource pressure;
6. adopts already-valid evidence;
7. wakes the authoritative service exactly once when eligible;
8. preserves candidate-independent downstream progression;
9. cannot promote/activate a Skill automatically.

A watchdog may request this wake path but may not itself execute a Codex cell.

## Lane 3 — Workflow Content

Primary real outcome already achieved:

`FINAL_QA_PASSED_PAGE=1`

Current phase is NOT scale-up.

The first page is undergoing production/editorial acceptance because technical QA previously passed content that violated accepted editorial rules.

Approved continuation:

`workflow-content-v3.20-future-qa-guards-20261003T1830Z`

This phase is ZERO-SPEND.

The current implementation in `src/nightaround-ops.ts` has a Workflow production resume path based on:

- `/srv/ai-doer-mcp/nightaround-selected-runtime2`
- privileged `resume-workflow-content`
- `nightaround-workflow-content-resume.service`
- approval manifest checks
- gpt-6-luna
- cumulative cost ceiling 0.45
- no public publish/indexing

Repair/update the Workflow resume registration so activation-time preflight selects the approved current continuation safely rather than blindly resuming a stale v3.19 recipe.

Current zero-spend allowed work:

- editorial-contract recovery
- QA-system repair
- deterministic tests
- no-spend replay
- owner-review-package preparation

Forbidden in this phase:

- Luna/OpenAI paid calls
- DataForSEO calls
- increasing $0.45 ceiling
- regenerating paid evidence
- page #2
- scaling to five
- WordPress delivery
- public publish
- indexing changes
- canonical changes

If a new paid call becomes necessary, the lane must enter an OWNER_GATE with a clear spend decision rather than silently spending.

## Shared resource arbitration

Priority:

1. Workflow first-page production acceptance and AI Doer maturity blocker
2. necessary Entity conversion work
3. Optimizing Skills validation
4. Expired Domains as elastic background work
5. UX/UI and S13/S14 only when dependencies activate

Do not hard-code equal resource shares.

Resume integrations must refuse/park heavy work when the shared-VM safety floor is not met.

## Privileged broker requirements

Extend the existing allowlisted broker minimally.

Never expose an arbitrary command execution surface.

For each new resume action:

- fixed action name;
- no arbitrary shell/program/path arguments;
- exact runner/service target;
- least-privilege execution identity;
- duplicate/process check before launch;
- lock/single-flight check;
- bounded/observable systemd launch preferred where appropriate;
- no secrets in unit files or command lines.

Existing Workflow broker behavior must remain backward compatible.

## Systemd/wake requirements

Use existing services/timers/paths where available.

Only introduce a unit/timer if a real missing durable wake mechanism requires it.

Requirements:

- survives SSH/browser/chat disconnect;
- no permanent busy polling when a timer/event wake is enough;
- bounded execution;
- persistent timer where appropriate;
- correct least-privilege user;
- journald observability;
- no embedded secrets;
- missed wake can be detected/reconciled;
- duplicate wake cannot create duplicate worker.

## Tests required

For each lane, prove as applicable:

A. dry-run/preflight is read-only.
B. valid idle lane -> SAFE_TO_RESUME.
C. already-running worker -> REFUSED_ALREADY_RUNNING.
D. held lock/single-flight ownership -> refusal.
E. missing runtime/wrapper/service -> precise refusal.
F. resource wait -> PARK/WAIT, not failure.
G. provider wait -> PARK/WAIT with NEXT_WAKE_AT.
H. scheduled wake resumes exactly once.
I. duplicate wake cannot create duplicate worker.
J. successful checkpoint/evidence is reused.
K. stale wake is reconciled safely.
L. chat/browser disconnect has no execution effect.
M. owner gate preserves exact state/checkpoint.
N. no secrets in output/tests/source.
O. existing Workflow resume behavior is preserved except for the intentional safe current-continuation update.
P. current Ops self/security/service acceptance tests remain green.

## Existing Entity resume work

There is a separate isolated VM worktree:

`/srv/nightaround-ops/workspace/entity-production-resume-v1`

branch:

`feat/entity-production-resume-v1`

It targets Entity only.

Do not duplicate or overwrite that work.

If your changes touch the same broker/safeResume regions, keep the implementation modular and make the overlap explicit in the completion report so the branches can later be reconciled cleanly.

## Implementation principles

- smallest production-safe changes;
- no broad refactor merely for style;
- preserve current Ops security model;
- preserve upstream DesktopCommander functionality;
- preserve current Nightaround tool schemas unless a versioned additive change is required;
- fail closed on unknown state;
- never infer that an unreadable/unverified state is safe;
- no destructive Git cleanup;
- do not weaken tests to pass.

## Deliverables

Commit all implementation to:

`feat/unattended-resume-v1`

Report:

- exact commit SHA;
- changed files;
- focused test results;
- full relevant Ops acceptance/self-test results;
- per-lane authoritative execution path;
- per-lane execution user;
- per-lane resume recipe/action;
- service/timer/path used;
- lock/single-flight source;
- state/heartbeat source;
- NEXT_WAKE source;
- dry-run result;
- duplicate guard proof;
- resource-wait proof;
- provider-wait proof;
- auto-wake proof;
- chat-independence proof;
- activation commands;
- exact rollback procedure;
- overlap notes with Entity resume branch.

Final completion block:

AI_DOER_UNATTENDED_READY=YES/NO
SKILLS_UNATTENDED_READY=YES/NO
WORKFLOW_UNATTENDED_READY=YES/NO
UNEXPLAINED_IDLE_POSSIBLE=YES/NO
PRODUCTION_ACTIVATED=NO
OWNER_ACTION_REQUIRED=NO/YES

Do NOT activate production from this task.
