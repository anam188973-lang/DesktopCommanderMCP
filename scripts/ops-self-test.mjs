import assert from 'node:assert/strict';
import { nightaroundOpsTools, isNightaroundOpsTool } from '../dist/nightaround-ops.js';

const required = [
  'nightaround_ops_health',
  'nightaround_inspect_lane',
  'nightaround_inspect_processes',
  'nightaround_detect_duplicates',
  'nightaround_resource_status',
  'nightaround_read_logs',
  'nightaround_service_status',
  'nightaround_git_status',
  'nightaround_run_tests',
  'nightaround_safe_resume_lane',
  'nightaround_safe_restart_service',
  'nightaround_prepare_deploy',
  'nightaround_deploy_release',
  'nightaround_verify_release',
  'nightaround_rollback_release',
];

assert.equal(nightaroundOpsTools.length, required.length);
for (const name of required) assert.equal(isNightaroundOpsTool(name), true, `${name} missing`);
assert.equal(isNightaroundOpsTool('execute_arbitrary_root'), false);
console.log(`OPS_SELF_TEST=PASS tools=${required.length}`);