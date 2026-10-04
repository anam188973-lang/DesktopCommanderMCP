import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'nightaround-security-acceptance', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(process.env.NIGHTAROUND_OPS_URL || 'http://127.0.0.1:8765/mcp'));
const text = result => (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
async function call(name, args = {}, allowError = false) {
  const result = await client.callTool({ name, arguments: args });
  if (!allowError) assert.equal(Boolean(result.isError), false, `${name}: ${text(result)}`);
  return result;
}
function pid(result) {
  const match = text(result).match(/PID\s+(\d+)/i);
  assert(match, text(result));
  return Number(match[1]);
}
async function awaitOutput(started, expected) {
  let output = text(started);
  if (expected.test(output)) return output;
  const processId = pid(started);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const later = await call('read_process_output', { pid: processId, timeout_ms: 2000, offset: -100, length: 100 }, true);
    output += `\n${text(later)}`;
    if (expected.test(output)) return output;
  }
  return output;
}

await client.connect(transport);
try {
  const catalog = await client.listTools();
  const names = new Set(catalog.tools.map(tool => tool.name));
  for (const required of ['read_multiple_files', 'get_file_info', 'list_directory']) assert(names.has(required), `${required} missing`);

  const multi = await call('read_multiple_files', { paths: ['/srv/nightaround-mcp/core-control/README.md', '/srv/nightaround-ops/current/PROVENANCE.txt'] });
  assert.match(text(multi), /UPSTREAM_REPOSITORY|Nightaround/i);
  const metadata = await call('get_file_info', { path: '/srv/nightaround-ops/current/PROVENANCE.txt' });
  assert.match(text(metadata), /size/i);
  await call('list_directory', { path: '/srv/nightaround-ops/current/docs' });
  console.log('FILESYSTEM_READ_METADATA=PASS');

  const source = '/srv/nightaround-mcp/content-automation-app/.nightaround-ops-security-test.txt';
  const moved = '/srv/nightaround-mcp/content-automation-app/.nightaround-ops-security-test.moved';
  await call('write_file', { path: source, content: 'bounded-acl-test\n', mode: 'rewrite' });
  await call('move_file', { source, destination: moved });
  await call('read_file', { path: moved, offset: 0, length: 10 });
  console.log('APPROVED_CODE_WRITE_ACL=PASS');

  const deniedWrite = await call('write_file', { path: '/srv/nightaround-lane-b/release-v5/Nightaround_Lane_B_Buyable_Domain_Discovery_v5/runtime/.nightaround-ops-denied-test', content: 'denied\n', mode: 'rewrite' }, true);
  assert.equal(Boolean(deniedWrite.isError), true);
  const deniedRead = await call('read_file', { path: '/etc/shadow', offset: 0, length: 1 }, true);
  assert.equal(Boolean(deniedRead.isError), true);
  console.log('FILESYSTEM_DENY_BOUNDARY=PASS');

  const sudoAttempt = await call('start_process', { command: 'sudo -n id', timeout_ms: 3000 }, true);
  assert.equal(Boolean(sudoAttempt.isError), true);
  assert.match(text(sudoAttempt), /not allowed/i);
  console.log('PRIVILEGE_ESCALATION_REJECTION=PASS');

  const metadataProbe = await call('start_process', { command: 'curl --connect-timeout 2 --max-time 3 -sS http://169.254.169.254/ >/dev/null 2>&1 && printf METADATA_UNEXPECTED || printf METADATA_BLOCKED', timeout_ms: 8000 });
  const probeOutput = await awaitOutput(metadataProbe, /METADATA_(?:BLOCKED|UNEXPECTED)/);
  assert.match(probeOutput, /METADATA_BLOCKED/);
  assert.doesNotMatch(probeOutput, /METADATA_UNEXPECTED/);
  console.log('METADATA_NETWORK_DENY=PASS');
} finally {
  await client.close();
}