/**
 * AZOBSS Auto Deploy Server
 * ─────────────────────────
 * Run: node deploy-server.js
 * Port: 7821
 *
 * Fungsi:
 *  1. Terima JSON dari browser (Export & Deploy button)
 *  2. Tulis ke affiliate-products.json dalam folder GitHub
 *  3. Git add, commit, push
 *  4. Hantar balik status ke browser
 */

const http        = require('http');
const fs          = require('fs');
const path        = require('path');
const { execSync } = require('child_process');

// ─── KONFIGURASI ────────────────────────────────────────────────────────────
const CONFIG = {
  port       : 7821,
  repoPath   : 'C:\\Users\\USER\\Documents\\GitHub\\www.zedan91.github.io',
  fileName   : 'affiliate-products.json',
  backupName : 'affiliate-backup.json',
  commitMsg  : 'update affiliate products [auto-deploy]',
};
// ────────────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://zedan91.github.io',
  'http://localhost',
  'http://127.0.0.1',
  'null', // file:// protocol
];

function log(msg) {
  const time = new Date().toLocaleTimeString('ms-MY');
  console.log(`[${time}] ${msg}`);
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.some(o => (origin || '').startsWith(o));
  return {
    'Access-Control-Allow-Origin' : allowed ? (origin || '*') : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type'                : 'application/json',
  };
}

function sendJSON(res, origin, status, payload) {
  res.writeHead(status, corsHeaders(origin));
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '';

  // ── Preflight CORS ──
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  // ── Health check ──
  if (req.method === 'GET' && req.url === '/health') {
    sendJSON(res, origin, 200, { ok: true, server: 'AZOBSS Deploy Server', port: CONFIG.port });
    return;
  }

  // ── Deploy endpoint ──
  if (req.method === 'POST' && req.url === '/deploy') {
    let body = '';

    req.on('data', chunk => { body += chunk; });

    req.on('end', () => {
      try {
        // 1. Parse JSON
        const products = JSON.parse(body);
        if (!Array.isArray(products)) throw new Error('Data mesti array JSON.');

        // 2. Tulis affiliate-products.json
        const targetFile   = path.join(CONFIG.repoPath, CONFIG.fileName);
        const backupFile   = path.join(CONFIG.repoPath, CONFIG.backupName);
        const jsonStr      = JSON.stringify(products, null, 2);

        fs.writeFileSync(targetFile, jsonStr, 'utf8');
        fs.writeFileSync(backupFile, jsonStr, 'utf8');
        log(`✅ Tulis ${products.length} produk → ${targetFile}`);

        // 3. Git commit & push
        const git = (cmd) => execSync(cmd, { cwd: CONFIG.repoPath, stdio: 'pipe' }).toString().trim();

        git(`git add "${CONFIG.fileName}" "${CONFIG.backupName}"`);

        // Check ada perubahan tak
        let diff = '';
        try { diff = git('git diff --cached --stat'); } catch(e) {}

        if (!diff) {
          log('ℹ️  Tiada perubahan — skip commit.');
          sendJSON(res, origin, 200, { ok: true, message: 'Tiada perubahan. Fail sama, skip commit & push.' });
          return;
        }

        git(`git commit -m "${CONFIG.commitMsg}"`);
        git('git push');
        log('🚀 Git push berjaya!');

        sendJSON(res, origin, 200, {
          ok     : true,
          message: `${products.length} produk berjaya deploy & push ke GitHub!`,
          diff,
        });

      } catch (err) {
        log(`❌ Error: ${err.message}`);
        sendJSON(res, origin, 500, { ok: false, message: err.message });
      }
    });

    return;
  }

  // ── 404 ──
  sendJSON(res, origin, 404, { ok: false, message: 'Endpoint tidak dijumpai.' });
});

server.listen(CONFIG.port, '127.0.0.1', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     AZOBSS Auto Deploy Server            ║');
  console.log(`║     http://127.0.0.1:${CONFIG.port}             ║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Repo  : ${CONFIG.repoPath.slice(0,40)}`);
  console.log(`║  File  : ${CONFIG.fileName}`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  POST /deploy  → tulis JSON + git push   ║');
  console.log('║  GET  /health  → check server status     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  log('Server sedia. Tunggu request dari browser...');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${CONFIG.port} sudah digunakan. Tutup proses lain atau tukar port dalam CONFIG.\n`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
