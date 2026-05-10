/**
 * AZOBSS Auto Deploy Server (HTTPS)
 * ───────────────────────────────────
 * Run: node deploy-server.js
 * Port: 7821 (HTTPS)
 *
 * HTTPS digunakan supaya www.azobss.com (https) boleh
 * buat request ke 127.0.0.1 tanpa Mixed Content block.
 *
 * ⚠️  LANGKAH PERTAMA KALI selepas run server:
 *     Buka https://127.0.0.1:7821/health dalam browser
 *     Klik Advanced > Proceed to 127.0.0.1
 *     Lepas tu Deploy button akan berfungsi!
 */

const https        = require('https');
const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

// ─── KONFIGURASI ─────────────────────────────────────────────────────────────
const CONFIG = {
  port       : 7821,
  repoPath   : 'C:\\Users\\USER\\Documents\\GitHub\\www.zedan91.github.io',
  fileName   : 'affiliate-products.json',
  backupName : 'affiliate-backup.json',
  commitMsg  : 'update affiliate products [auto-deploy]',
  certFile   : 'deploy-cert.pem',
  keyFile    : 'deploy-key.pem',
};
// ─────────────────────────────────────────────────────────────────────────────

function log(msg) {
  const time = new Date().toLocaleTimeString('ms-MY');
  console.log(`[${time}] ${msg}`);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin' : origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type'                : 'application/json',
  };
}

function sendJSON(res, origin, status, payload) {
  res.writeHead(status, corsHeaders(origin));
  res.end(JSON.stringify(payload));
}

// ─── Jana / load self-signed cert ────────────────────────────────────────────
function ensureCert() {
  const certPath = path.join(__dirname, CONFIG.certFile);
  const keyPath  = path.join(__dirname, CONFIG.keyFile);

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    log('Cert sedia ada — guna semula.');
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  }

  log('Jana self-signed certificate...');

  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes -subj "/CN=127.0.0.1"`,
      { stdio: 'pipe' }
    );
    log('Certificate berjaya dijana via openssl.');
  } catch (e) {
    // Cuba selfsigned npm package
    try {
      const selfsigned = require('selfsigned');
      const pems = selfsigned.generate([{ name: 'commonName', value: '127.0.0.1' }], { days: 3650, keySize: 2048 });
      fs.writeFileSync(certPath, pems.cert, 'utf8');
      fs.writeFileSync(keyPath,  pems.private, 'utf8');
      log('Certificate berjaya dijana via selfsigned.');
    } catch (e2) {
      console.error('\n Tidak dapat jana certificate.');
      console.error('Jalankan: npm install selfsigned');
      console.error('Kemudian cuba semula.\n');
      process.exit(1);
    }
  }

  return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
}

// ─── Server ──────────────────────────────────────────────────────────────────
const { cert, key } = ensureCert();

const server = https.createServer({ cert, key }, (req, res) => {
  const origin = req.headers.origin || '';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJSON(res, origin, 200, { ok: true, server: 'AZOBSS Deploy Server (HTTPS)', port: CONFIG.port });
    return;
  }

  if (req.method === 'POST' && req.url === '/deploy') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const products = JSON.parse(body);
        if (!Array.isArray(products)) throw new Error('Data mesti array JSON.');

        const targetFile = path.join(CONFIG.repoPath, CONFIG.fileName);
        const backupFile = path.join(CONFIG.repoPath, CONFIG.backupName);
        const jsonStr    = JSON.stringify(products, null, 2);

        fs.writeFileSync(targetFile, jsonStr, 'utf8');
        fs.writeFileSync(backupFile, jsonStr, 'utf8');
        log(`Tulis ${products.length} produk ke ${targetFile}`);

        const git = (cmd) => execSync(cmd, { cwd: CONFIG.repoPath, stdio: 'pipe' }).toString().trim();

        git(`git add "${CONFIG.fileName}" "${CONFIG.backupName}"`);

        let diff = '';
        try { diff = git('git diff --cached --stat'); } catch(e) {}

        if (!diff) {
          log('Tiada perubahan — skip commit.');
          sendJSON(res, origin, 200, { ok: true, message: 'Tiada perubahan. Skip commit & push.' });
          return;
        }

        git(`git commit -m "${CONFIG.commitMsg}"`);
        git('git push');
        log('Git push berjaya!');

        sendJSON(res, origin, 200, {
          ok     : true,
          message: `${products.length} produk berjaya deploy & push ke GitHub!`,
          diff,
        });

      } catch (err) {
        log(`Error: ${err.message}`);
        sendJSON(res, origin, 500, { ok: false, message: err.message });
      }
    });
    return;
  }

  sendJSON(res, origin, 404, { ok: false, message: 'Endpoint tidak dijumpai.' });
});

server.listen(CONFIG.port, '127.0.0.1', () => {
  console.log('');
  console.log('=============================================');
  console.log('     AZOBSS Auto Deploy Server (HTTPS)');
  console.log('     https://127.0.0.1:' + CONFIG.port);
  console.log('=============================================');
  console.log('  Repo : ' + CONFIG.repoPath);
  console.log('  File : ' + CONFIG.fileName);
  console.log('=============================================');
  console.log('  POST /deploy -> tulis JSON + git push');
  console.log('  GET  /health -> check server status');
  console.log('=============================================');
  console.log('');
  console.log('  !! LANGKAH PERTAMA KALI !!');
  console.log('  Buka URL ni dalam browser anda:');
  console.log('  https://127.0.0.1:7821/health');
  console.log('  Klik Advanced > Proceed to 127.0.0.1');
  console.log('  Lepas tu Deploy button akan berfungsi!');
  console.log('');
  console.log('=============================================');
  console.log('');
  log('Server sedia. Tunggu request dari browser...');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error('\nPort ' + CONFIG.port + ' sudah digunakan. Tutup proses lain atau tukar port.\n');
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
