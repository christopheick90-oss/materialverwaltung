const http = require('http');
const fs = require('fs');
const path = require('path');

const VERSION = '0.7.5';
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function safeList(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch (error) {
    return [];
  }
}

function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, renderMissingPage(), 'text/html; charset=utf-8');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, MIME_TYPES[ext] || 'application/octet-stream');
  });
}

function renderMissingPage() {
  const publicExists = fs.existsSync(PUBLIC_DIR);
  const indexExists = fs.existsSync(INDEX_FILE);
  const foundFiles = safeList(ROOT_DIR).join(', ') || 'keine Dateien gefunden';
  const publicFiles = safeList(PUBLIC_DIR).join(', ') || 'public-Ordner fehlt oder leer';

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Eckl Lagerverwaltung · Fehler</title>
  <style>
    body{margin:0;font-family:Arial,Helvetica,sans-serif;background:linear-gradient(135deg,#2c2c2c,#0f0f0f);color:#111;padding:24px}
    .box{max-width:920px;margin:0 auto;background:#fff;border-left:6px solid #e4002b;padding:22px;box-shadow:0 8px 24px rgba(0,0,0,.25)}
    h1{margin-top:0}.badge{display:inline-block;background:#222;color:#fff;padding:5px 9px;font-weight:800}.red{background:#e4002b}code{background:#f1f1f1;padding:2px 5px}
  </style>
</head>
<body>
  <div class="box">
    <span class="badge red">Eckl Lagerverwaltung</span>
    <h1>Der Server läuft, aber <code>public/index.html</code> wurde im Render-Repository nicht gefunden.</h1>
    <p><strong>Version:</strong> ${VERSION}</p>
    <p><strong>Gesuchter Ordner:</strong> <code>${PUBLIC_DIR}</code></p>
    <p><strong>public vorhanden:</strong> ${publicExists ? 'ja' : 'nein'}</p>
    <p><strong>index.html vorhanden:</strong> ${indexExists ? 'ja' : 'nein'}</p>
    <p><strong>Gefundene Dateien im Repository-Hauptordner:</strong> ${foundFiles}</p>
    <p><strong>Gefundene Dateien in public:</strong> ${publicFiles}</p>
    <p>Bitte in GitHub prüfen: Im Repository müssen direkt <code>package.json</code>, <code>server.js</code> und der Ordner <code>public</code> sichtbar sein. Nicht nur die ZIP und nicht ein zusätzlicher Unterordner.</p>
    <p>Teste außerdem <code>/debug/render</code>.</p>
  </div>
</body>
</html>`;
}

function renderDebug() {
  const rootFiles = safeList(ROOT_DIR);
  const publicFiles = safeList(PUBLIC_DIR);
  const payload = {
    app: 'Eckl Lagerverwaltung',
    version: VERSION,
    node: process.version,
    cwd: process.cwd(),
    rootDir: ROOT_DIR,
    publicDir: PUBLIC_DIR,
    indexFile: INDEX_FILE,
    publicExists: fs.existsSync(PUBLIC_DIR),
    indexExists: fs.existsSync(INDEX_FILE),
    rootFiles,
    publicFiles,
    hint: 'Im GitHub-Repository müssen package.json, server.js und public direkt im Hauptordner sichtbar sein.'
  };

  return JSON.stringify(payload, null, 2);
}

const server = http.createServer((req, res) => {
  const rawPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (rawPath === '/debug/render') {
    send(res, 200, renderDebug(), 'application/json; charset=utf-8');
    return;
  }

  if (!fs.existsSync(INDEX_FILE)) {
    send(res, 404, renderMissingPage(), 'text/html; charset=utf-8');
    return;
  }

  if (rawPath === '/' || rawPath === '/index.html') {
    sendFile(res, INDEX_FILE);
    return;
  }

  const requested = path.normalize(rawPath).replace(/^([/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, requested);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, 'Nicht erlaubt.', 'text/plain; charset=utf-8');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }

  sendFile(res, INDEX_FILE);
});

server.listen(PORT, () => {
  console.log(`Eckl Lagerverwaltung v${VERSION} läuft auf Port ${PORT}`);
  console.log(`Public: ${PUBLIC_DIR}`);
});
