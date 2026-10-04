import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'nightaround-controlled-resume-test', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8765/mcp'));
const responseText = result => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');

await client.connect(transport);
let controlledPid;
try {
  const first = await client.callTool({ name: 'nightaround_safe_resume_lane', arguments: { lane: 'provider-usage', dry_run: false, controlled_test: true } });
  assert.equal(Boolean(first.isError), false, responseText(first));
  const firstValue = JSON.parse(responseText(first));
  assert.equal(firstValue.status, 'CONTROLLED_TEST_STARTED');
  assert(Number.isInteger(firstValue.pid) && firstValue.pid > 1);
  controlledPid = firstValue.pid;

  const second = await client.callTool({ name: 'nightaround_safe_resume_lane', arguments: { lane: 'provider-usage', dry_run: false, controlled_test: true } });
  assert.equal(Boolean(second.isError), false, responseText(second));
  const secondValue = JSON.parse(responseText(second));
  assert.equal(secondValue.status, 'REFUSED_ALREADY_RUNNING');
  console.log(`CONTROLLED_RESUME_PID=${controlledPid}`);
  console.log('DUPLICATE_RESUME_REFUSAL=PASS');
} finally {
  if (controlledPid) {
    try { process.kill(controlledPid, 'SIGTERM'); } catch {}
  }
  await client.close();
}