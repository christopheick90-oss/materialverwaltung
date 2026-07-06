const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');

let mainWindow;
let localServerStarted = false;
let serverUrl;

// Fester, beschreibbarer Speicherort für Windows.
// Dadurch entstehen keine Cache-Fehler mehr, wenn Electron/Chromium keinen Zugriff
// auf den Standard-Cache oder einen temporären Ordner bekommt.
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const appName = 'Eckl Eco Technics - Materialverwaltung';
const oldAppBaseDir = path.join(localAppData, 'Eckl Lagerverwaltung');
const appBaseDir = path.join(localAppData, appName);
const userDataDir = path.join(appBaseDir, 'Benutzerdaten');
const cacheDir = path.join(appBaseDir, 'Cache');
const gpuCacheDir = path.join(appBaseDir, 'GPUCache');
const dataDir = path.join(appBaseDir, 'Daten');

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    // Fallback, falls Windows den lokalen Ordner blockiert.
    const fallback = path.join(os.tmpdir(), appName);
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
  return dir;
}

ensureDir(appBaseDir);
ensureDir(userDataDir);
ensureDir(cacheDir);
ensureDir(gpuCacheDir);
ensureDir(dataDir);

function copyDirIfMissing(fromDir, toDir) {
  try {
    if (!fs.existsSync(fromDir)) return;
    const newDb = path.join(toDir, 'db.json');
    const oldDb = path.join(fromDir, 'db.json');
    if (fs.existsSync(newDb) || !fs.existsSync(oldDb)) return;
    fs.cpSync(fromDir, toDir, { recursive: true });
  } catch (err) {
    console.log('Datenmigration nicht möglich:', err.message);
  }
}

// Beim neuen Programmnamen bestehende Daten aus der alten Testversion übernehmen.
copyDirIfMissing(path.join(oldAppBaseDir, 'Daten'), dataDir);

// Wichtig: vor app.whenReady setzen.
app.setPath('userData', userDataDir);
app.setPath('cache', cacheDir);
app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
app.commandLine.appendSwitch('gpu-disk-cache-dir', gpuCacheDir);
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

function readJsonConfigFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.log('Konfigurationsdatei konnte nicht gelesen werden:', filePath, err.message);
    return null;
  }
}

function normalizeServerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  return `http://${raw.replace(/\/+$/, '')}${raw.includes(':') ? '' : ':4170'}`;
}

function loadAppConfig() {
  const candidates = [
    // Gespeicherte Client-Verbindung hat Vorrang.
    path.join(appBaseDir, 'eckl-config.json'),
    path.join(path.dirname(process.execPath || ''), 'eckl-config.json'),
    path.join(path.dirname(process.execPath || ''), 'client-config.json'),
    path.join(__dirname, 'eckl-config.json'),
    path.join(__dirname, 'client-config.json')
  ];
  for (const candidate of candidates) {
    const config = readJsonConfigFile(candidate);
    if (config) return config;
  }
  return {};
}

const fileConfig = loadAppConfig();
const requestedMode = String(process.env.ECKL_APP_MODE || fileConfig.mode || '').trim().toLowerCase();
const serverPort = Number(process.env.ECKL_SERVER_PORT || fileConfig.port || 4170);
const configuredServerUrl = normalizeServerUrl(process.env.ECKL_SERVER_URL || fileConfig.serverUrl || '');
const startLocalServer = !(requestedMode === 'client' || configuredServerUrl);
const forceServerPort = process.env.ECKL_FORCE_PORT === '1' || fileConfig.forcePort === true || requestedMode === 'server';
let needsConnectionSetup = false;

function saveClientServerConfig(url) {
  const config = { mode: 'client', serverUrl: url };
  const json = JSON.stringify(config, null, 2);
  const targets = [
    path.join(appBaseDir, 'eckl-config.json'),
    path.join(path.dirname(process.execPath || ''), 'eckl-config.json')
  ];
  for (const target of targets) {
    try {
      fs.writeFileSync(target, json, 'utf8');
    } catch (err) {
      console.log('Client-Konfiguration konnte nicht geschrieben werden:', target, err.message);
    }
  }
}

function connectionSetupHtml() {
  const lastUrl = normalizeServerUrl(fileConfig.serverUrl || '');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Eckl Eco Technics · Server verbinden</title>
<style>
:root{--red:#e4002b;--dark:#1b1b1b;--paper:#fff;--line:#ddd;--muted:#666}
*{box-sizing:border-box} body{margin:0;font-family:Arial,Helvetica,sans-serif;background:linear-gradient(135deg,#2c2c2c,#0f0f0f);color:#111;min-height:100vh;padding:34px}
.header{background:linear-gradient(180deg,#2f2f2f,#151515);color:#fff;border-bottom:4px solid var(--red);padding:22px;margin-bottom:18px}
.header h1{margin:0;font-size:32px}.card{background:#fff;border:1px solid var(--line);border-left:6px solid var(--red);padding:22px;max-width:760px;box-shadow:0 8px 20px rgba(0,0,0,.18)}
label{font-weight:800;font-size:13px;display:block;margin-bottom:7px} input{width:100%;padding:13px;border:1px solid #ccc;font-size:18px;margin-bottom:12px}
button.primary{background:var(--red);color:#fff;border:0;padding:12px 15px;cursor:pointer;font-weight:800} .notice{background:#f7f7f7;border:1px dashed #aaa;padding:12px;margin-top:14px;color:#555;font-weight:700}
</style>
</head>
<body>
  <div class="header"><h1>Eckl Eco Technics - Materialverwaltung</h1><div>Client verbinden · Version 0.7.0</div></div>
  <div class="card">
    <h2>Server-Adresse eingeben</h2>
    <p>Diese Client-EXE kann jetzt schon auf den anderen PC kopiert werden. Die Server-IP kann später eingetragen werden.</p>
    <label>Server-IP oder Server-URL</label>
    <input id="server" value="${lastUrl}" placeholder="z. B. 192.168.178.50 oder http://192.168.178.50:4170" autofocus>
    <button class="primary" onclick="connect()">Verbinden und speichern</button>
    <div class="notice">Hinweis: Die Datenbank bleibt auf dem Server-PC. Dieser Client speichert nur die Server-Adresse.</div>
  </div>
<script>
function connect(){
  var value=document.getElementById('server').value.trim();
  if(!value){ alert('Bitte Server-IP eingeben.'); return; }
  location.href='eckl-connect://save?server='+encodeURIComponent(value);
}
document.getElementById('server').addEventListener('keydown', function(e){ if(e.key==='Enter') connect(); });
</script>
</body></html>`;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.once('close', () => resolve(true)).close())
      .listen(port, '0.0.0.0');
  });
}

async function findFreePort(startPort) {
  for (let offset = 0; offset < 20; offset += 1) {
    const candidate = startPort + offset;
    if (await isPortFree(candidate)) return candidate;
  }
  return null;
}

async function prepareServer() {
  if (!startLocalServer) {
    serverUrl = configuredServerUrl;
    if (!serverUrl) {
      needsConnectionSetup = true;
      console.log('Client-Modus ohne feste Server-Adresse. Zeige Verbindungsabfrage.');
      return;
    }
    console.log(`Client-Modus: verbinde mit ${serverUrl}`);
    return;
  }

  let selectedPort = serverPort;
  if (forceServerPort) {
    const free = await isPortFree(serverPort);
    if (!free) {
      dialog.showErrorBox('Materialverwaltung', `Port ${serverPort} ist bereits belegt. Bitte alte Server-Fenster schließen oder 0_PORT_4170_FREIGEBEN.bat starten.`);
      throw new Error(`Port ${serverPort} ist belegt`);
    }
  } else {
    const freePort = await findFreePort(serverPort);
    if (!freePort) {
      dialog.showErrorBox('Materialverwaltung', 'Es konnte kein freier lokaler Port für die Test-App gefunden werden. Bitte alte Programmfenster schließen und erneut starten.');
      throw new Error('Kein freier Port gefunden');
    }
    selectedPort = freePort;
  }

  serverUrl = `http://localhost:${selectedPort}`;
  if (selectedPort !== serverPort) {
    console.log(`Port ${serverPort} ist bereits belegt. Starte diese Version auf Port ${selectedPort}: ${serverUrl}`);
  }

  if (!startLocalServer || localServerStarted) return;
  localServerStarted = true;
  process.env.ECKL_SERVER_PORT = String(selectedPort);
  process.env.ECKL_APP_MODE = requestedMode || 'desktop';
  process.env.ECKL_DESKTOP_MODE = '1';
  process.env.ECKL_DATA_DIR = dataDir;
  require('./server.js');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    title: appName,
    show: false,
    icon: path.join(__dirname, 'public', 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    try { mainWindow.maximize(); } catch (_) {}
    mainWindow.show();
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith('eckl-connect://')) return;
    event.preventDefault();
    try {
      const parsed = new URL(targetUrl);
      const input = parsed.searchParams.get('server') || '';
      const nextUrl = normalizeServerUrl(input);
      if (!nextUrl) throw new Error('Keine Server-Adresse eingegeben.');
      serverUrl = nextUrl;
      needsConnectionSetup = false;
      saveClientServerConfig(nextUrl);
      mainWindow.loadURL(serverUrl);
    } catch (err) {
      dialog.showErrorBox(appName, `Server-Adresse konnte nicht gespeichert werden:\n${err.message}`);
    }
  });

  if (needsConnectionSetup) {
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(connectionSetupHtml()));
  } else {
    setTimeout(() => mainWindow.loadURL(serverUrl), localServerStarted ? 700 : 0);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', () => {
    const html = `
      <body style="font-family:Arial;background:#f4f4f4;margin:0;padding:30px">
        <div style="background:#fff;border-left:6px solid #e4002b;padding:22px;max-width:760px;box-shadow:0 8px 20px rgba(0,0,0,.12)">
          <h1 style="margin-top:0">Eckl Eco Technics - Materialverwaltung</h1>
          <p>Die Oberfläche konnte den Server nicht erreichen.</p>
          <p><b>Adresse:</b> ${serverUrl}</p>
          <p>Bitte prüfen, ob der Server-PC läuft und die richtige Server-Adresse eingetragen ist. Bei lokalem Test alte CMD-Fenster schließen und neu starten.</p>
        </div>
      </body>`;
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
}

app.whenReady().then(async () => {
  try {
    await prepareServer();
    createWindow();
  } catch (error) {
    dialog.showErrorBox(appName, `Die App konnte nicht gestartet werden:\n${error.message}`);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
