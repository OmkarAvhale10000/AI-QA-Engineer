import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { QAOrchestrator } from './orchestrator.js';
import type { WsMessage } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const PORT = parseInt(process.env.AGENT_PORT || '3001', 10);

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Track active clients and sessions
const clients = new Set<WebSocket>();
let activeOrchestrator: QAOrchestrator | null = null;

function broadcast(msg: WsMessage) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected. Total: ${clients.size}`);

  // Send current session state to new client
  if (activeOrchestrator) {
    ws.send(
      JSON.stringify({
        type: 'session_update',
        session: activeOrchestrator.getSession(),
      })
    );
  }

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected. Total: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
    clients.delete(ws);
  });
});

// ─── REST Endpoints ───────────────────────────────────────────────────────────

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Start a QA session
app.post('/api/session/start', async (req, res) => {
  const { targetUrl, appDescription } = req.body as {
    targetUrl: string;
    appDescription: string;
  };

  if (!targetUrl) {
    return res.status(400).json({ error: 'targetUrl is required' });
  }

  if (activeOrchestrator?.getSession().status === 'executing' ||
      activeOrchestrator?.getSession().status === 'exploring') {
    return res.status(409).json({ error: 'A session is already running' });
  }

  const sessionId = `session_${Date.now()}`;
  activeOrchestrator = new QAOrchestrator(
    sessionId,
    targetUrl,
    appDescription || 'A web application',
    broadcast
  );

  res.json({ sessionId, message: 'QA session started' });

  // Run async — don't await here, results are streamed via WebSocket
  activeOrchestrator.run().catch((err) => {
    console.error('[Orchestrator Error]', err.message);
  });
});

// Stop current session
app.post('/api/session/stop', async (_req, res) => {
  if (activeOrchestrator) {
    await activeOrchestrator.stop();
    activeOrchestrator = null;
  }
  res.json({ message: 'Session stopped' });
});

// Get current session state
app.get('/api/session', (_req, res) => {
  if (!activeOrchestrator) {
    return res.json({ session: null });
  }
  res.json({ session: activeOrchestrator.getSession() });
});

server.listen(PORT, () => {
  console.log(`\nAI QA Agent Backend running on http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   POST /api/session/start   → Start QA session`);
  console.log(`   POST /api/session/stop    → Stop session`);
  console.log(`   GET  /api/session         → Get session state\n`);
});
