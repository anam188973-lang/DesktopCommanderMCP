import './bootstrap.js';
import * as http from 'http';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { server as templateServer } from './server.js';
import { configManager } from './config-manager.js';
import { featureFlagManager } from './utils/feature-flags.js';

const host = process.env.NIGHTAROUND_OPS_HOST || '127.0.0.1';
const port = Number(process.env.NIGHTAROUND_OPS_PORT || '8765');
const startedAt = new Date().toISOString();
let ready = false;

// DNS-rebinding protection: only loopback Host headers, and no cross-origin browser requests.
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const allowedHosts = new Set([...LOOPBACK_HOSTNAMES].map(name => `${name}:${port}`));

function isAllowedHost(value: string | undefined): boolean {
  return typeof value === 'string' && allowedHosts.has(value.toLowerCase());
}

function isAllowedOrigin(value: string | undefined): boolean {
  if (value === undefined) return true;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(value).host.replace(/:\d+$/, '').toLowerCase());
  } catch {
    return false;
  }
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function isInitializeRequest(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(message => message && typeof message === 'object' && (message as { method?: unknown }).method === 'initialize');
}

function createRequestServer(): Server {
  const template = templateServer as any;
  const requestServer = new Server(template._serverInfo, { capabilities: template._capabilities });
  const target = requestServer as any;
  target._requestHandlers = new Map(template._requestHandlers);
  target._notificationHandlers = new Map(template._notificationHandlers);
  return requestServer;
}

type SessionState = { transport: StreamableHTTPServerTransport; server: Server };
const sessions = new Map<string, SessionState>();
const MAX_SESSIONS = 32;

async function main() {
  await configManager.loadConfig();
  await featureFlagManager.initialize();

  const httpServer = http.createServer(async (req, res) => {
    try {
      if (!isAllowedHost(req.headers.host) || !isAllowedOrigin(req.headers.origin)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden host or origin' }));
        return;
      }
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', release: process.env.NIGHTAROUND_OPS_RELEASE || 'development', startedAt }));
        return;
      }
      if (req.url === '/readyz') {
        res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ready }));
        return;
      }
      if (req.url !== '/mcp') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      const sessionId = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : undefined;
      let session = sessionId ? sessions.get(sessionId) : undefined;

      if (!session) {
        if (req.method !== 'POST' || !isInitializeRequest(body)) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'invalid or missing MCP session' }, id: null }));
          return;
        }
        if (sessions.size >= MAX_SESSIONS) {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'MCP session limit reached' }, id: null }));
          return;
        }

        const requestServer = createRequestServer();
        let initializedSessionId: string | undefined;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: id => {
            initializedSessionId = id;
            sessions.set(id, { transport, server: requestServer });
          },
        });
        transport.onclose = () => {
          if (initializedSessionId) sessions.delete(initializedSessionId);
        };
        await requestServer.connect(transport);
        session = { transport, server: requestServer };
      }

      await session.transport.handleRequest(req, res, body);
      if (req.method === 'DELETE') {
        if (sessionId) sessions.delete(sessionId);
        await session.server.close().catch(() => undefined);
      }
    } catch (error: any) {
      if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error?.message || 'request failed' }));
    }
  });

  httpServer.listen(port, host, () => {
    ready = true;
    process.stderr.write(`Nightaround Ops MCP ready on http://${host}:${port}/mcp\n`);
  });

  const stopServer = () => {
    ready = false;
    for (const session of sessions.values()) void session.server.close();
    sessions.clear();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', stopServer);
  process.on('SIGINT', stopServer);
}

main().catch(error => {
  process.stderr.write(`Nightaround Ops MCP failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});