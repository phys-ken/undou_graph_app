'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');

const { Bridge } = require('./api/bridge');
const { validateRequest } = require('./api/validate');

const PROJECT_ROOT = __dirname;
const STATIC_PORT = Number(process.env.MOTION_STATIC_PORT || 8000);
const API_PORT    = Number(process.env.MOTION_API_PORT    || 8001);
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'api_output');

const bridge = new Bridge({ projectRoot: PROJECT_ROOT, defaultOutputDir: OUTPUT_ROOT });

// ----- Static server (port 8000) — same behavior as server.py -----
const staticApp = express();
staticApp.use(express.static(PROJECT_ROOT, {
  setHeaders(res, p) {
    if (p.endsWith('.js'))   res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    if (p.endsWith('.css'))  res.setHeader('Content-Type', 'text/css; charset=utf-8');
    if (p.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
  },
}));

// ----- API server (port 8001) -----
const apiApp = express();
apiApp.use(cors());
apiApp.use(express.json({ limit: '10mb' }));

apiApp.get('/api/health', (_req, res) => {
  let sandboxOk = false;
  try { bridge.init(); sandboxOk = !!bridge.sandbox?.KinematicsProblemGenerator; } catch (_) {}
  res.json({
    status: 'ok',
    version: '1.0.0',
    sandboxReady: sandboxOk,
    projectRoot: PROJECT_ROOT,
    defaultOutputDir: OUTPUT_ROOT,
  });
});

apiApp.get('/api/schema', (_req, res) => {
  const schema = require('./api/schema.json');
  res.json(schema);
});

apiApp.post('/api/generate', async (req, res) => {
  const parsed = validateRequest(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: parsed.error.format() },
    });
  }
  try {
    const response = await bridge.generateFull(parsed.data);
    res.json(response);
  } catch (e) {
    console.error('[/api/generate] error:', e);
    res.status(500).json({
      success: false,
      error: { code: 'GENERATE_ERROR', message: e.message, stack: e.stack },
    });
  }
});

apiApp.get('/api/output/:session/:file', (req, res) => {
  const { session, file } = req.params;
  // 許可する拡張子: png / pdf / docx / txt / zip / json
  if (!/^[\w.\-]+$/.test(session) || !/^[\w\-]+\.(png|pdf|docx|txt|zip|json)$/.test(file)) {
    return res.status(400).json({ success: false, error: { code: 'BAD_PATH', message: 'invalid path component' } });
  }
  const p = path.join(OUTPUT_ROOT, session, file);
  if (!fs.existsSync(p)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  res.sendFile(p);
});

apiApp.use((_req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } }));

// ----- Boot both -----
let staticServer, apiServer;

function killPortAndRetry(port, retryFn) {
  // Windows: use netstat + taskkill to free the port, then retry
  const { execSync } = require('node:child_process');
  try {
    const out = execSync(
      `netstat -ano | findstr :${port}`,
      { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
    );
    const pids = [...new Set(
      out.split('\n')
        .map(line => line.trim().split(/\s+/).pop())
        .filter(pid => /^\d+$/.test(pid) && pid !== '0')
    )];
    for (const pid of pids) {
      try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' }); } catch (_) {}
    }
    console.log(`[server] freed port ${port} (PIDs: ${pids.join(',')}), retrying...`);
  } catch (_) {}
  setTimeout(retryFn, 500);
}

function startStatic() {
  staticServer = staticApp.listen(STATIC_PORT, () => {
    console.log(`[static] http://localhost:${STATIC_PORT}/`);
  });
  staticServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[static] port ${STATIC_PORT} in use, freeing...`);
      killPortAndRetry(STATIC_PORT, startStatic);
    } else {
      console.error('[static] server error:', err);
    }
  });
}

function startApi() {
  apiServer = apiApp.listen(API_PORT, () => {
    console.log(`[api]    http://localhost:${API_PORT}/api/health`);
    console.log(`[api]    POST  http://localhost:${API_PORT}/api/generate`);
    console.log(`[api]    GET   http://localhost:${API_PORT}/api/schema`);
  });
  apiServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[api] port ${API_PORT} in use, freeing...`);
      killPortAndRetry(API_PORT, startApi);
    } else {
      console.error('[api] server error:', err);
    }
  });
}

startStatic();
startApi();

process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});

const shutdown = (sig) => {
  console.log(`\n[server] received ${sig}, shutting down...`);
  if (staticServer) staticServer.close();
  if (apiServer) apiServer.close();
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
