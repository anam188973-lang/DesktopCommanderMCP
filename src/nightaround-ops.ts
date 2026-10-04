import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ServerResult } from './types.js';

const execFileAsync = promisify(execFile);
const RELEASE_VERSION = process.env.NIGHTAROUND_OPS_RELEASE || 'development';
const OPS_ROOT = process.env.NIGHTAROUND_OPS_ROOT || '/srv/nightaround-ops';
const AUDIT_FILE = process.env.NIGHTAROUND_OPS_AUDIT || path.join(OPS_ROOT, 'audit', 'actions.jsonl');
const PRIVILEGED_CLIENT = '/usr/local/bin/nightaround-ops-privileged-client';

const WORKFLOW_CONTENT_RESUME = Object.freeze({
  runtime: '/srv/ai-doer-mcp/nightaround-selected-runtime2',
  runner: '/srv/nightaround-ops/current/packaging/nightaround-workflow-content-resume',
  lock: '/srv/ai-doer-mcp/nightaround-selected-runtime2/db/locks/s01_s10_draft_only.lock',
  pageId: 'nlp_26b60a5386792140937bfcbc',
  model: 'gpt-6-luna',
  costCeilingUsd: 0.45,
  approval: '/srv/nightaround-workflow-content/current.approval',
  candidatesRoot: '/srv/nightaround-ops/workflow-candidates',
});

type LaneName = 'ai-doer' | 'entity' | 'expired-domains' | 'optimizing-skills' | 'provider-usage' | 'workflow-content';
type LaneDefinition = {
  workspace: string;
  processMarkers: string[];
  statePaths: string[];
};

const LANES: Record<LaneName, LaneDefinition> = {
  'ai-doer': {
    workspace: '/srv/ai-doer-mcp/nightlife-bakeoffs-v1/repo',
    processMarkers: ['ai_doer_reconciliation_runner.py'],
    statePaths: ['data/runtime/ai_doer_controller/state.json', 'data/runtime/ai_doer_controller/state.lock', 'config/ai_doer_queue.json'],
  },
  entity: {
    workspace: '/srv/nightaround-entity/offpage-entity-registrar',
    processMarkers: ['offpage_entity', 'entity_registrar'],
    statePaths: ['runtime/unattended_lane/entity_status.json', 'runtime/unattended_lane/platform_state.json'],
  },
  'expired-domains': {
    workspace: '/srv/nightaround-lane-b/release-v5/Nightaround_Lane_B_Buyable_Domain_Discovery_v5',
    processMarkers: ['stream_liveness_v9.py', 'A05s_sharded_link_scan_v7.py', 'unattended_v7.sh'],
    statePaths: ['runtime/link_scan_current_v7', 'runtime/unattended_v7.sh'],
  },
  'optimizing-skills': {
    workspace: '/srv/ai-doer-mcp/nightaround-skill-lab-v1',
    processMarkers: ['nightaround-skill-lab-v1'],
    statePaths: ['01_candidates/CANDIDATE_REGISTRY.json', '02_benchmarks/BENCHMARK_REGISTRY.json', '04_results'],
  },
  'provider-usage': {
    workspace: '/var/lib/nightaround-mcp/provider-usage',
    processMarkers: ['provider-usage'],
    statePaths: ['snapshot.json'],
  },
  'workflow-content': {
    workspace: '/srv/ai-doer-mcp/nightaround-selected-runtime2',
    processMarkers: ['nightaround-workflow-content-resume', 'runtime_run_joined_current_v2.py'],
    statePaths: [
      'db/locks/s01_s10_draft_only.lock',
      'data/exports/s07_s09_handoff_v2.json',
      'data/exports/s08_evidence_v2_page_bundle.json',
      'data/exports/nightlife_draft_only/s10_qa_v2.json',
      'runtime_outputs/joined_danang_s01_s10_v2/canonical_20260925_r3',
    ],
  },
};

const REPOSITORIES: Record<string, string> = {
  ops: OPS_ROOT + '/current',
  content: '/srv/nightaround-mcp/content-automation-app',
  workflow: '/srv/nightaround-mcp/nightlife-bakeoffs-v1/repo',
  entity: '/srv/nightaround-entity/offpage-entity-registrar',
  'ai-doer': '/srv/ai-doer-mcp/nightlife-bakeoffs-v1/repo',
  skills: '/srv/ai-doer-mcp/nightaround-skill-lab-v1',
};

const SERVICE_NAMES = [
  'nightaround-ops.service',
  'nightaround-mcp-cloudflared.service',
  'nightaround-ai-doer-mcp.service',
  'nightaround-entity-mcp.service',
  'nightaround-expired-domain-mcp.service',
  'nightaround-cloud-control.service',
];

const SYSTEMCTL = '/usr/bin/systemctl';
const STATUS_SERVICE_NAMES = [
  'nightaround-ops.service',
  'nightaround-mcp-gateway@production.service',
  'nightaround-mcp-cloudflared.service',
];
const STATUS_PROPERTIES = ['Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ExecMainStatus', 'NRestarts', 'ActiveEnterTimestamp'];

const jsonSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const stringEnum = (values: readonly string[]) => ({ type: 'string', enum: values });
const laneSchema = stringEnum(Object.keys(LANES));

export const nightaroundOpsTools = [
  { name: 'nightaround_ops_health', description: 'Health and readiness for the isolated Nightaround Ops MCP and read-only V1.1 compatibility.', inputSchema: jsonSchema({}), annotations: { title: 'Nightaround Ops Health', readOnlyHint: true } },
  { name: 'nightaround_inspect_lane', description: 'Inspect one Nightaround lane process, lock, checkpoint, and state metadata without changing it.', inputSchema: jsonSchema({ lane: laneSchema }, ['lane']), annotations: { title: 'Inspect Nightaround Lane', readOnlyHint: true } },
  { name: 'nightaround_inspect_processes', description: 'List Nightaround lane and Ops processes with PID, owner, CPU, RAM, elapsed time, and command.', inputSchema: jsonSchema({}), annotations: { title: 'Inspect Nightaround Processes', readOnlyHint: true } },
  { name: 'nightaround_detect_duplicates', description: 'Detect exact duplicate Nightaround worker command lines while allowing distinct shards.', inputSchema: jsonSchema({ lane: laneSchema }), annotations: { title: 'Detect Duplicate Workers', readOnlyHint: true } },
  { name: 'nightaround_resource_status', description: 'Return CPU, RAM, load, uptime, and filesystem capacity.', inputSchema: jsonSchema({}), annotations: { title: 'Nightaround Resource Status', readOnlyHint: true } },
  { name: 'nightaround_read_logs', description: 'Read a bounded tail of journals for an approved Nightaround service.', inputSchema: jsonSchema({ service: stringEnum(SERVICE_NAMES), lines: { type: 'integer', minimum: 1, maximum: 500 } }, ['service']), annotations: { title: 'Read Nightaround Logs', readOnlyHint: true } },
  { name: 'nightaround_service_status', description: 'Read-only systemd status (ActiveState, SubState, MainPID, ExecMainStatus, NRestarts) for the approved Nightaround Ops, gateway, and cloudflared services. Omit service to return all three.', inputSchema: jsonSchema({ service: stringEnum(STATUS_SERVICE_NAMES) }), annotations: { title: 'Nightaround Service Status', readOnlyHint: true } },
  { name: 'nightaround_git_status', description: 'Run read-only Git status, branch, HEAD, and diff summary for an approved Nightaround repository.', inputSchema: jsonSchema({ repository: stringEnum(Object.keys(REPOSITORIES)) }, ['repository']), annotations: { title: 'Nightaround Git Status', readOnlyHint: true } },
  { name: 'nightaround_run_tests', description: 'Run the allowlisted test command for the Ops MCP or a Nightaround repository.', inputSchema: jsonSchema({ repository: stringEnum(Object.keys(REPOSITORIES)), timeout_ms: { type: 'integer', minimum: 1000, maximum: 900000 } }, ['repository']), annotations: { title: 'Run Nightaround Tests', readOnlyHint: false } },
  { name: 'nightaround_safe_resume_lane', description: 'Resume only a configured pending lane after process, lock, scheduler, and checkpoint checks. Unconfigured production resumes are refused.', inputSchema: jsonSchema({ lane: laneSchema, dry_run: { type: 'boolean' }, controlled_test: { type: 'boolean' } }, ['lane']), annotations: { title: 'Safely Resume Nightaround Lane', readOnlyHint: false, destructiveHint: false } },
  { name: 'nightaround_safe_restart_service', description: 'Restart only an approved Nightaround MCP/Ops service through the root-owned policy wrapper, then verify it.', inputSchema: jsonSchema({ service: stringEnum(['nightaround-ops-tunnel.service']) }, ['service']), annotations: { title: 'Safely Restart Nightaround Service', readOnlyHint: false } },
  { name: 'nightaround_prepare_deploy', description: 'Validate an immutable Nightaround Ops release and return its manifest/checksum state.', inputSchema: jsonSchema({ release: { type: 'string', pattern: '^[A-Za-z0-9._-]+$' }, track: stringEnum(['production', 'test']) }, ['release']), annotations: { title: 'Prepare Nightaround Deployment', readOnlyHint: true } },
  { name: 'nightaround_deploy_release', description: 'Atomically switch an approved Nightaround Ops release pointer with rollback recording.', inputSchema: jsonSchema({ release: { type: 'string', pattern: '^[A-Za-z0-9._-]+$' }, track: stringEnum(['production', 'test']) }, ['release']), annotations: { title: 'Deploy Nightaround Release', readOnlyHint: false } },
  { name: 'nightaround_verify_release', description: 'Verify the active production or test release pointer and checksum manifest.', inputSchema: jsonSchema({ track: stringEnum(['production', 'test']) }), annotations: { title: 'Verify Nightaround Release', readOnlyHint: true } },
  { name: 'nightaround_rollback_release', description: 'Atomically restore the recorded previous release for the selected track.', inputSchema: jsonSchema({ track: stringEnum(['production', 'test']) }), annotations: { title: 'Rollback Nightaround Release', readOnlyHint: false } },
];

const OPS_TOOL_NAMES = new Set(nightaroundOpsTools.map(tool => tool.name));
export function isNightaroundOpsTool(name: string): boolean { return OPS_TOOL_NAMES.has(name); }

function ok(value: unknown): ServerResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}
function fail(message: string): ServerResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
function asRecord(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
}
function requireLane(value: unknown): LaneName {
  if (typeof value !== 'string' || !(value in LANES)) throw new Error('invalid lane');
  return value as LaneName;
}
function requireChoice(value: unknown, choices: readonly string[], label: string): string {
  if (typeof value !== 'string' || !choices.includes(value)) throw new Error(`invalid ${label}`);
  return value;
}
function requireRelease(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value)) throw new Error('invalid release');
  return value;
}

async function run(file: string, args: string[], cwd?: string, timeout = 30000, environment: Record<string, string> = {}) {
  try {
    const result = await execFileAsync(file, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', ...environment } });
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error: any) {
    const stdout = String(error?.stdout || '').slice(-262144).trim();
    const stderr = String(error?.stderr || '').slice(-262144).trim();
    const details = [error?.message || String(error), stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`].filter(Boolean).join('\n');
    throw new Error(details);
  }
}

async function statMetadata(target: string) {
  try {
    const s = await fs.stat(target);
    return { path: target, exists: true, type: s.isDirectory() ? 'directory' : s.isFile() ? 'file' : 'other', size: s.size, mtime: s.mtime.toISOString(), mode: (s.mode & 0o777).toString(8) };
  } catch (error: any) {
    return { path: target, exists: false, error: error?.code || 'unavailable' };
  }
}

async function allProcesses(): Promise<Array<Record<string, unknown>>> {
  const { stdout } = await run('/bin/ps', ['-eo', 'pid=,ppid=,user=,pcpu=,pmem=,etimes=,args=']);
  return stdout.split('\n').filter(Boolean).map(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    return m ? { pid: Number(m[1]), ppid: Number(m[2]), user: m[3], cpu_percent: m[4], memory_percent: m[5], elapsed_seconds: Number(m[6]), command: m[7] } : { command: line.trim() };
  });
}

function processMatchesLane(proc: Record<string, unknown>, lane: LaneDefinition): boolean {
  const command = String(proc.command || '');
  return lane.processMarkers.some(marker => command.includes(marker));
}

async function inspectLane(laneName: LaneName) {
  const lane = LANES[laneName];
  const processes = (await allProcesses()).filter(proc => processMatchesLane(proc, lane));
  const state = await Promise.all(lane.statePaths.map(p => statMetadata(path.isAbsolute(p) ? p : path.join(lane.workspace, p))));
  const duplicateCommands = Object.entries(processes.reduce<Record<string, number>>((acc, proc) => {
    const cmd = String(proc.command || ''); acc[cmd] = (acc[cmd] || 0) + 1; return acc;
  }, {})).filter(([, count]) => count > 1).map(([command, count]) => ({ command, count }));
  return { lane: laneName, workspace: await statMetadata(lane.workspace), processes, state, running: processes.length > 0, duplicateCommands };
}

function auditTarget(args: unknown): string {
  const value = asRecord(args);
  for (const key of ['lane', 'service', 'repository', 'track', 'release', 'path', 'file_path', 'destination']) {
    if (typeof value[key] === 'string') return `${key}:${String(value[key]).slice(0, 300)}`;
  }
  return 'none';
}

export async function auditToolCall(name: string, args: unknown, result: ServerResult, durationMs: number): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(), tool: name, action: name, target: auditTarget(args),
    result: result.isError ? 'error' : 'success', exit_status: result.isError ? 1 : 0,
    duration_ms: durationMs, release_version: RELEASE_VERSION, user: os.userInfo().username,
  };
  try {
    await fs.mkdir(path.dirname(AUDIT_FILE), { recursive: true });
    await fs.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Audit write failures must not leak request data or crash the MCP transport.
  }
}

async function health() {
  const current = await fs.realpath(OPS_ROOT + '/current').catch(() => 'unavailable');
  const v11 = await fs.realpath('/srv/nightaround-mcp/core-control').catch(() => 'unavailable');
  let auditWritable = true;
  await fs.access(path.dirname(AUDIT_FILE), fsConstants.W_OK).catch(() => { auditWritable = false; });
  return {
    status: current === 'unavailable' || v11 === 'unavailable' || !auditWritable ? 'FAIL' : 'PASS',
    release: RELEASE_VERSION, current, v11, auditWritable, identity: os.userInfo().username,
    readOnlyControlPlane: false,
    controlPlaneMode: 'guarded-read-write',
    mutationPolicy: 'allowlisted-and-policy-gated',
    readOnlyV11Compatibility: true,
    lanes: Object.keys(LANES),
  };
}

async function resourceStatus() {
  const { stdout: rootDisk } = await run('/bin/df', ['-B1', '--output=size,used,avail,pcent,target', '/']);
  const { stdout: opsDisk } = await run('/bin/df', ['-B1', '--output=size,used,avail,pcent,target', OPS_ROOT]);
  return { cpu_count: os.cpus().length, load_average: os.loadavg(), uptime_seconds: os.uptime(), memory_total: os.totalmem(), memory_free: os.freemem(), root_disk: rootDisk, ops_disk: opsDisk };
}

async function gitStatus(repository: string) {
  const cwd = await fs.realpath(REPOSITORIES[repository]);
  const gitArgs = (args: string[]) => ['-c', `safe.directory=${cwd}`, ...args];
  const [branch, head, status, diff] = await Promise.all([
    run('/usr/bin/git', gitArgs(['branch', '--show-current']), cwd), run('/usr/bin/git', gitArgs(['rev-parse', 'HEAD']), cwd),
    run('/usr/bin/git', gitArgs(['status', '--short']), cwd), run('/usr/bin/git', gitArgs(['diff', '--stat']), cwd),
  ]);
  return { repository, path: cwd, branch: branch.stdout, head: head.stdout, status: status.stdout, diff: diff.stdout };
}

async function runTests(repository: string, timeout: number) {
  const cwd = REPOSITORIES[repository];
  if (repository === 'ops') return { repository, ...(await run('/opt/nightaround-node22/bin/node', ['scripts/ops-self-test.mjs'], cwd, timeout)) };
  const pyproject = await statMetadata(path.join(cwd, 'pyproject.toml'));
  if (pyproject.exists) {
    const uvLock = await statMetadata(path.join(cwd, 'uv.lock'));
    const uv = await statMetadata('/usr/local/bin/uv');
    if (uvLock.exists && uv.exists) {
      const testWorkspace = path.join(OPS_ROOT, 'state', 'test-worktrees', repository);
      const environmentRoot = path.join(OPS_ROOT, 'state', 'venvs', repository);
      const cacheRoot = path.join(OPS_ROOT, 'state', 'uv-cache');
      const pythonRoot = path.join(OPS_ROOT, 'state', 'uv-python');
      await fs.rm(testWorkspace, { recursive: true, force: true });
      await fs.mkdir(path.dirname(testWorkspace), { recursive: true });
      await fs.cp(cwd, testWorkspace, {
        recursive: true,
        filter: source => {
          const relative = path.relative(cwd, source);
          return !['.git', '.venv', '.pytest_cache'].includes(path.basename(source))
            && relative !== path.join('data', 'runtime')
            && !relative.startsWith(path.join('data', 'runtime') + path.sep);
        },
      });
      await Promise.all([fs.mkdir(environmentRoot, { recursive: true }), fs.mkdir(cacheRoot, { recursive: true }), fs.mkdir(pythonRoot, { recursive: true })]);
      return { repository, testWorkspace, ...(await run('/usr/local/bin/uv', ['run', '--frozen', '--project', testWorkspace, 'pytest', '-q'], testWorkspace, timeout, {
        UV_PROJECT_ENVIRONMENT: environmentRoot,
        UV_CACHE_DIR: cacheRoot,
        UV_PYTHON_INSTALL_DIR: pythonRoot,
        UV_NO_PROGRESS: '1',
      })) };
    }
    const python = (await statMetadata(path.join(cwd, '.venv/bin/python'))).exists ? path.join(cwd, '.venv/bin/python') : '/usr/bin/python3';
    return { repository, ...(await run(python, ['-m', 'pytest', '-q'], cwd, timeout)) };
  }
  const packageJson = await statMetadata(path.join(cwd, 'package.json'));
  if (packageJson.exists) return { repository, ...(await run('/opt/nightaround-node22/bin/npm', ['test'], cwd, timeout)) };
  throw new Error('no allowlisted test command for repository');
}

async function sha256File(target: string): Promise<string> {
  const { stdout } = await run('/usr/bin/sha256sum', [target], undefined, 15000);
  return stdout.split(/\s+/)[0] || '';
}

async function workflowContentResumePreflight(inspection: Awaited<ReturnType<typeof inspectLane>>) {
  const runtime = WORKFLOW_CONTENT_RESUME.runtime;
  const handoffPath = path.join(runtime, 'data/exports/s07_s09_handoff_v2.json');
  const requiredRuntime = await Promise.all([handoffPath, WORKFLOW_CONTENT_RESUME.lock].map(statMetadata));
  if (requiredRuntime.some(item => !item.exists)) return { status: 'REFUSED_WORKFLOW_CHECKPOINT_INCOMPLETE', inspection, required: requiredRuntime };

  let approvalText = '';
  try { approvalText = (await fs.readFile(WORKFLOW_CONTENT_RESUME.approval, 'utf8')).trim(); }
  catch { return { status: 'REFUSED_WORKFLOW_APPROVAL_MISSING', inspection }; }
  const approvalParts = approvalText.split(/\s+/);
  if (approvalParts.length !== 2 || !/^[A-Za-z0-9._-]+$/.test(approvalParts[0]) || !/^[a-f0-9]{64}$/.test(approvalParts[1])) {
    return { status: 'REFUSED_WORKFLOW_APPROVAL_INVALID', inspection };
  }
  const [release, approvedManifestSha256] = approvalParts;
  const candidate = path.join(WORKFLOW_CONTENT_RESUME.candidatesRoot, release);
  const manifestPath = path.join(candidate, 'MANIFEST.sha256');
  const releasePath = path.join(candidate, 'workflow-release.json');
  const s08Path = path.join(candidate, 'config/danang_cocktail_s08_bundle_candidate_v3.json');
  const s085Path = path.join(candidate, 'config/danang_cocktail_s08_5_effective_selection_candidate_v2.json');
  const controlPath = path.join(candidate, 'config/workflow_content_control_plane_v2.json');
  const runnerPath = path.join(candidate, 'src/content_automation/projects/nightlife/reconciled_runner_v2.py');
  const requiredCandidate = await Promise.all([manifestPath, releasePath, s08Path, s085Path, controlPath, runnerPath].map(statMetadata));
  if (requiredCandidate.some(item => !item.exists)) return { status: 'REFUSED_WORKFLOW_CANDIDATE_INCOMPLETE', inspection, release, required: requiredCandidate };

  const actualManifestSha256 = await sha256File(manifestPath);
  if (actualManifestSha256 !== approvedManifestSha256) return { status: 'REFUSED_WORKFLOW_APPROVAL_HASH_MISMATCH', inspection, release, approvedManifestSha256, actualManifestSha256 };

  const manifest = JSON.parse(await fs.readFile(releasePath, 'utf8')) as Record<string, any>;
  const control = JSON.parse(await fs.readFile(controlPath, 'utf8')) as Record<string, any>;
  const lock = JSON.parse(await fs.readFile(s085Path, 'utf8')) as Record<string, any>;
  const [s07Sha256, s08Sha256, s085Sha256, controlSha256] = await Promise.all([
    sha256File(handoffPath), sha256File(s08Path), sha256File(s085Path), sha256File(controlPath),
  ]);
  const policyOk = manifest.contract === 'NIGHTAROUND.WORKFLOW_CONTENT_RELEASE.V2'
    && manifest.execution_mode === 'DEVELOPMENT_TEST_ONLY'
    && manifest.page_id === WORKFLOW_CONTENT_RESUME.pageId
    && manifest.model === WORKFLOW_CONTENT_RESUME.model
    && Number(manifest.cost_ceiling_usd) === WORKFLOW_CONTENT_RESUME.costCeilingUsd
    && manifest.expected_s07_sha256 === s07Sha256
    && manifest.expected_s08_sha256 === s08Sha256
    && manifest.expected_s08_5_sha256 === s085Sha256
    && manifest.control_plane_sha256 === controlSha256
    && manifest.public_publish_allowed === false
    && manifest.indexing_change_allowed === false
    && manifest.production_url_freeze_allowed === false
    && manifest.autonomous_public_publish === false
    && control.execution_mode === 'DEVELOPMENT_TEST_ONLY'
    && control.prepublish?.public_publish_allowed === false
    && control.ia?.production_url_taxonomy_frozen === false
    && lock.status === 'PASS';
  if (!policyOk) return { status: 'REFUSED_WORKFLOW_POLICY_MISMATCH', inspection, release, s07Sha256, s08Sha256, s085Sha256, controlSha256 };

  return {
    status: 'SAFE_TO_RESUME', lane: 'workflow-content', inspection,
    recipe: {
      release, runner: WORKFLOW_CONTENT_RESUME.runner, runtime, lock: WORKFLOW_CONTENT_RESUME.lock,
      page_id: manifest.page_id, s07_sha256: s07Sha256, s08_sha256: s08Sha256, s08_5_sha256: s085Sha256,
      model: manifest.model, cost_ceiling_usd: Number(manifest.cost_ceiling_usd),
      stages: 'S08.5_LOCK->S09_V2->AUTH1->AUTH2->EVIDENCE_VERIFIER->MAX_ONE_REPAIR->S10->S10.5->S11_STRUCTURED_READY->STOP',
      wordpress_draft_payload_allowed: true,
      wordpress_delivery_allowed: false,
      public_publish_allowed: false,
      indexing_change_allowed: false,
      production_url_freeze_allowed: false,
      post_publish_simulation: 'DEVELOPMENT_FIXTURE_ONLY',
      secret_delivery: 'SERVER_SIDE_ONLY',
    },
  };
}

async function safeResume(laneName: LaneName, dryRun: boolean, controlledTest: boolean) {
  const inspection = await inspectLane(laneName);
  if (inspection.running || inspection.duplicateCommands.length > 0) return { status: 'REFUSED_ALREADY_RUNNING', inspection };
  if (laneName === 'workflow-content' && !controlledTest) {
    const preflight = await workflowContentResumePreflight(inspection);
    if (preflight.status !== 'SAFE_TO_RESUME' || dryRun) return preflight;
    const launch = await privileged(['resume-workflow-content'], 30000);
    return { ...preflight, status: 'WORKFLOW_CONTENT_RESUME_STARTED', launch: { stdout: launch.stdout, stderr: launch.stderr } };
  }
  if (dryRun || !controlledTest) return { status: 'REFUSED_NO_PRODUCTION_RESUME_CONFIGURED', dryRun, inspection };
  if (process.env.NIGHTAROUND_OPS_CONTROLLED_TEST !== '1') return { status: 'REFUSED_TEST_MODE_DISABLED', inspection };
  const testDir = path.join(OPS_ROOT, 'state', 'controlled-test');
  await fs.mkdir(testDir, { recursive: true });
  const marker = path.join(testDir, `${laneName}.pid`);
  const child = spawn('/usr/bin/python3', ['-c', 'import sys,time; print("ready", flush=True); time.sleep(30)', `nightaround-controlled-${laneName}`], { detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
  child.unref();
  await fs.writeFile(marker, String(child.pid) + '\n', { mode: 0o600 });
  return { status: 'CONTROLLED_TEST_STARTED', pid: child.pid, marker };
}

async function serviceStatus(service: string) {
  const { stdout } = await run(SYSTEMCTL, ['show', '--no-pager', `--property=${STATUS_PROPERTIES.join(',')}`, service], undefined, 15000);
  const fields: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) fields[line.slice(0, i)] = line.slice(i + 1);
  }
  return { service, ...Object.fromEntries(STATUS_PROPERTIES.map(p => [p, fields[p] ?? null])) };
}

async function privileged(args: string[], timeout = 30000) {
  return run(PRIVILEGED_CLIENT, args, undefined, timeout);
}

async function prepareDeploy(release: string, track: string) {
  const root = track === 'test' ? path.join(OPS_ROOT, 'test-releases') : path.join(OPS_ROOT, 'releases');
  const target = path.join(root, release);
  const [metadata, manifest, entrypoint] = await Promise.all([
    statMetadata(target), statMetadata(path.join(target, 'MANIFEST.sha256')), statMetadata(path.join(target, 'dist', 'ops-http.js')),
  ]);
  return { track, release, target, ready: metadata.exists && manifest.exists && entrypoint.exists, metadata, manifest, entrypoint };
}

async function verifyRelease(track: string) {
  const pointer = track === 'test' ? path.join(OPS_ROOT, 'state', 'test-current') : path.join(OPS_ROOT, 'current');
  const target = await fs.realpath(pointer).catch(() => 'unavailable');
  if (target === 'unavailable') return { track, pointer, status: 'FAIL', target, failedFiles: [] };
  try {
    await run('/usr/bin/sha256sum', ['--quiet', '-c', 'MANIFEST.sha256'], target, 120000);
    return { track, pointer, target, status: 'PASS', verification: 'all manifest checksums matched', failedFiles: [] };
  } catch (error: any) {
    const verification = String(error?.message || 'verification failed');
    const failedFiles = [...verification.matchAll(/^(.+): FAILED$/gm)].map(match => match[1]);
    return { track, pointer, target, status: 'FAIL', verification, failedFiles };
  }
}

export async function handleNightaroundOpsTool(name: string, rawArgs: unknown): Promise<ServerResult> {
  const args = asRecord(rawArgs);
  try {
    switch (name) {
      case 'nightaround_ops_health': return ok(await health());
      case 'nightaround_inspect_lane': return ok(await inspectLane(requireLane(args.lane)));
      case 'nightaround_inspect_processes': {
        const processes = (await allProcesses()).filter(proc => Object.values(LANES).some(lane => processMatchesLane(proc, lane)) || String(proc.command || '').includes('nightaround-ops'));
        return ok({ processes });
      }
      case 'nightaround_detect_duplicates': {
        const lanes = args.lane ? [requireLane(args.lane)] : Object.keys(LANES) as LaneName[];
        const inspections = await Promise.all(lanes.map(inspectLane));
        return ok({ status: inspections.every(x => x.duplicateCommands.length === 0) ? 'PASS' : 'FAIL', lanes: inspections.map(x => ({ lane: x.lane, processCount: x.processes.length, duplicates: x.duplicateCommands })) });
      }
      case 'nightaround_resource_status': return ok(await resourceStatus());
      case 'nightaround_read_logs': {
        const service = requireChoice(args.service, SERVICE_NAMES, 'service');
        const lines = typeof args.lines === 'number' ? Math.max(1, Math.min(500, Math.floor(args.lines))) : 100;
        return ok({ service, ...(await privileged(['journal', service, String(lines)])) });
      }
      case 'nightaround_service_status': {
        if (Object.keys(args).some(key => key !== 'service')) throw new Error('unsupported argument');
        const services = args.service === undefined ? STATUS_SERVICE_NAMES : [requireChoice(args.service, STATUS_SERVICE_NAMES, 'service')];
        return ok({ services: await Promise.all(services.map(serviceStatus)) });
      }
      case 'nightaround_git_status': {
        const repository = requireChoice(args.repository, Object.keys(REPOSITORIES), 'repository');
        return ok(await gitStatus(repository));
      }
      case 'nightaround_run_tests': {
        const repository = requireChoice(args.repository, Object.keys(REPOSITORIES), 'repository');
        const timeout = typeof args.timeout_ms === 'number' ? Math.max(1000, Math.min(900000, Math.floor(args.timeout_ms))) : 300000;
        return ok(await runTests(repository, timeout));
      }
      case 'nightaround_safe_resume_lane': {
        if (Object.keys(args).some(key => !['lane', 'dry_run', 'controlled_test'].includes(key))) throw new Error('unsupported argument');
        return ok(await safeResume(requireLane(args.lane), args.dry_run !== false, args.controlled_test === true));
      }
      case 'nightaround_safe_restart_service': {
        const service = requireChoice(args.service, ['nightaround-ops-tunnel.service'], 'service');
        return ok({ service, ...(await privileged(['restart', service], 60000)) });
      }
      case 'nightaround_prepare_deploy': {
        const track = requireChoice(args.track || 'production', ['production', 'test'], 'track');
        return ok(await prepareDeploy(requireRelease(args.release), track));
      }
      case 'nightaround_deploy_release': {
        const track = requireChoice(args.track || 'production', ['production', 'test'], 'track');
        const release = requireRelease(args.release);
        const prep = await prepareDeploy(release, track);
        if (!prep.ready) return fail('release validation failed');
        return ok({ track, release, ...(await privileged(['deploy', track, release])) });
      }
      case 'nightaround_verify_release': return ok(await verifyRelease(requireChoice(args.track || 'production', ['production', 'test'], 'track')));
      case 'nightaround_rollback_release': {
        const track = requireChoice(args.track || 'production', ['production', 'test'], 'track');
        return ok({ track, ...(await privileged(['rollback', track])) });
      }
      default: return fail(`unknown Nightaround Ops tool: ${name}`);
    }
  } catch (error: any) {
    return fail(`Nightaround Ops error: ${error?.message || String(error)}`);
  }
}