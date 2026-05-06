import http from 'node:http';
import { WebSocketServer } from 'ws';
import { handleConnection } from './connection.js';
import { env } from './env.js';
import { log } from './log.js';
import { manager } from './manager.js';
import { redis, sub, Channels } from './redis.js';
import { loadTournaments, startTournamentTicker } from './tournament-runner.js';
import { startWithdrawalWorker } from './withdrawal-worker.js';

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      shard: env.SHARD_ID,
      total: env.TOTAL_SHARDS,
      tables: manager.list().length,
      ts: Date.now(),
    }));
    return;
  }
  if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    const tables = manager.list();
    res.end(
      `# HELP stacks_tables_total Tables held by this shard\n` +
      `stacks_tables_total ${tables.length}\n` +
      `# HELP stacks_seats_active Seats with players\n` +
      `stacks_seats_active ${tables.reduce((a, t) => a + t.connections.size, 0)}\n`
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: 16 * 1024,
  perMessageDeflate: false,           // we want low latency more than bandwidth savings
  clientTracking: false,              // we track our own
});

let connectionCount = 0;
wss.on('connection', (ws, req) => {
  connectionCount++;
  if (connectionCount > env.MAX_CONNECTIONS) {
    ws.close(1013, 'overloaded');
    return;
  }
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
  log.debug({ ip }, 'ws connect');
  ws.on('close', () => connectionCount--);
  handleConnection(ws, ip);
});

async function bootstrap() {
  await redis.ping();
  log.info('redis OK');
  await sub.subscribe(Channels.lobby, Channels.shard(env.SHARD_ID));
  sub.on('message', (channel, message) => {
    try {
      const m = JSON.parse(message);
      log.debug({ channel, kind: m.kind }, 'redis msg');
      // Handlers for cross-shard events would dispatch here.
    } catch {}
  });

  await loadTournaments();
  startTournamentTicker();
  startWithdrawalWorker();

  httpServer.listen(env.PORT, () => {
    log.info({ port: env.PORT, shard: env.SHARD_ID }, 'game-server listening');
  });
}

bootstrap().catch(err => {
  log.fatal({ err }, 'bootstrap failed');
  process.exit(1);
});

// Graceful shutdown
let shuttingDown = false;
async function shutdown(sig: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ sig }, 'shutting down');
  wss.clients.forEach(c => c.close(1001, 'server restart'));
  for (const r of manager.list()) r.destroy();
  await redis.quit().catch(() => {});
  await sub.quit().catch(() => {});
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
