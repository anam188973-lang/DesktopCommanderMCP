import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nightaroundOpsTools, handleNightaroundOpsTool } from '../dist/nightaround-ops.js';

const approved = ['nightaround-ops.service', 'nightaround-mcp-gateway@production.service', 'nightaround-mcp-cloudflared.service'];
const tool = nightaroundOpsTools.find(t => t.name === 'nightaround_service_status');
assert.ok(tool, 'service status tool missing');
assert.equal(tool.annotations.readOnlyHint, true);
assert.deepEqual(tool.inputSchema.properties.service.enum, approved);
assert.deepEqual(tool.inputSchema.required, []);
assert.equal(tool.inputSchema.additionalProperties, false);

const rejected = async (args, label) => {
  const result = await handleNightaroundOpsTool('nightaround_service_status', args);
  assert.equal(result.isError, true, `${label} was not rejected`);
};
await rejected({ service: 'sshd.service' }, 'unapproved service');
await rejected({ service: 'nightaround-ops-tunnel.service' }, 'legacy tunnel service');
await rejected({ service: 'nightaround-ops.service; systemctl stop nightaround-ops.service' }, 'injection');
for (const action of ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'daemon-reload']) {
  await rejected({ service: action }, `${action} as service`);
  await rejected({ service: 'nightaround-ops.service', action }, `${action} as extra argument`);
}

const source = await readFile(new URL('../dist/nightaround-ops.js', import.meta.url), 'utf8');
const systemctlCalls = source.match(/run\(SYSTEMCTL, \[[^\]]*\]/g) || [];
assert.equal(systemctlCalls.length, 1, 'exactly one systemctl call site expected');
assert.match(systemctlCalls[0], /^run\(SYSTEMCTL, \['show', '--no-pager', /);

const logs = nightaroundOpsTools.find(t => t.name === 'nightaround_read_logs');
assert.ok(logs.inputSchema.properties.service.enum.includes('nightaround-mcp-cloudflared.service'));
assert.ok(!logs.inputSchema.properties.service.enum.includes('nightaround-ops-tunnel.service'));
const restart = nightaroundOpsTools.find(t => t.name === 'nightaround_safe_restart_service');
assert.deepEqual(restart.inputSchema.properties.service.enum, ['nightaround-ops-tunnel.service'], 'restart scope must not widen');

console.log('OPS_SERVICE_STATUS_TEST=PASS');