import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.NIGHTAROUND_OPS_URL || 'http://127.0.0.1:8765/mcp';
const client = new Client({ name: 'workflow-v2-acceptance', version: '2.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(url));
const text = r => (r.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
async function call(name, args) {
  const r = await client.callTool({ name, arguments: args || {} });
  assert.equal(Boolean(r.isError), false, `${name}: ${text(r)}`);
  return r;
}

await client.connect(transport);
try {
  const dry = await call('nightaround_safe_resume_lane', { lane: 'workflow-content', dry_run: true });
  const d = JSON.parse(text(dry));
  assert.equal(d.status, 'SAFE_TO_RESUME');
  assert.equal(d.recipe.model, 'gpt-6-luna');
  assert.equal(d.recipe.cost_ceiling_usd, 0.45);
  assert.match(d.recipe.stages, /S08\.5_LOCK/);
  assert.match(d.recipe.stages, /S10\.5/);
  assert.match(d.recipe.stages, /S11_STRUCTURED_READY/);
  assert.equal(d.recipe.wordpress_draft_payload_allowed, true);
  assert.equal(d.recipe.wordpress_delivery_allowed, false);
  assert.equal(d.recipe.public_publish_allowed, false);
  assert.equal(d.recipe.indexing_change_allowed, false);
  assert.equal(d.recipe.production_url_freeze_allowed, false);
  assert.equal(d.recipe.post_publish_simulation, 'DEVELOPMENT_FIXTURE_ONLY');
  console.log('WORKFLOW_CONTENT_V2_ACCEPTANCE=PASS');
} finally {
  await client.close();
}