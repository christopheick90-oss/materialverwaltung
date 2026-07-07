const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = '0.5.7';
const APP_NAME = 'Eckl Eco Technics - Materialverwaltung';
const now = new Date().toISOString();

function defaultUsers(created) {
  return [
    { id: 'u_admin', username: 'admin', password: 'admin123', name: 'System Admin', role: 'ADMIN', active: true, mustChangePassword: false, createdAt: created, updatedAt: created, lastLogin: null },
    { id: 'u_laser', username: 'laser', password: 'laser123', name: 'Laser Arbeitsplatz', role: 'LASER', active: true, mustChangePassword: false, createdAt: created, updatedAt: created, lastLogin: null },
    { id: 'u_buero', username: 'buero', password: 'buero123', name: 'Büro Einkauf', role: 'BUERO', active: true, mustChangePassword: false, createdAt: created, updatedAt: created, lastLogin: null },
    { id: 'u_chef', username: 'chef', password: 'chef123', name: 'Chef', role: 'CHEF', active: true, mustChangePassword: false, createdAt: created, updatedAt: created, lastLogin: null }
  ];
}

function defaultSettings(created) {
  return {
    programName: APP_NAME,
    version: VERSION,
    shelves: ['Regal 1','Regal 2','Regal 3','Regal 4','Regal 5','Regal 6','Carport','Bodenhaltung'],
    konsiLocation: 'Garage',
    formats: ['4000x2000','3000x1500','2500x1250','2000x1000'],
    standardStrengths: ['1 mm','1,5 mm','2 mm','3 mm','4 mm','5 mm','6 mm','8 mm','10 mm'],
    autoBackupOnStart: true,
    inventoryLastDate: '2027-06-30',
    inventoryIntervalMonths: 3,
    inventoryNextDate: '2027-09-30',
    updatedAt: created
  };
}

function cleanDb(input, label) {
  const db = input && typeof input === 'object' ? input : {};
  const users = Array.isArray(db.users) && db.users.length ? db.users : defaultUsers(now);
  const settings = db.settings && typeof db.settings === 'object' ? { ...defaultSettings(now), ...db.settings, version: VERSION } : defaultSettings(now);
  return {
    version: 19,
    users,
    sessions: {},
    materials: [],
    orders: [],
    activities: [
      { id: `a_notfall_${Date.now()}`, type: 'SYSTEM', text: `Materialdatenbank per Notfallskript geleert (${label}).`, at: now }
    ],
    inventories: [],
    settings,
    materialDatabaseCleared: true,
    materialDatabaseClearedVersion: VERSION,
    materialDatabaseResetAt: now,
    materialDatabaseResetBy: 'Admin Notfallskript'
  };
}

function resetFile(file, label, createIfMissing = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let existing = {};
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { existing = {}; }
    const backupDir = path.join(path.dirname(file), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `notfall-vor-leeren-${now.replace(/[:.]/g, '-')}.json`);
    try { fs.copyFileSync(file, backup); console.log(`Backup erstellt: ${backup}`); } catch (err) { console.log(`Backup nicht möglich (${label}): ${err.message}`); }
  } else if (!createIfMissing) {
    console.log(`Nicht vorhanden, übersprungen: ${file}`);
    return;
  }
  fs.writeFileSync(file, JSON.stringify(cleanDb(existing, label), null, 2), 'utf8');
  const check = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`${label}: Materialien=${check.materials.length}, Bestellungen=${check.orders.length}, Inventuren=${check.inventories.length}`);
}

const projectDb = path.join(__dirname, '..', 'data', 'db.json');
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const appDb = path.join(localAppData, APP_NAME, 'Daten', 'db.json');
const oldDb = path.join(localAppData, 'Eckl Lagerverwaltung', 'Daten', 'db.json');

resetFile(projectDb, 'Projekt-Datenbank', true);
resetFile(appDb, 'Desktop-Datenbank', true);
resetFile(oldDb, 'Alte Test-Datenbank', false);

console.log('Fertig. Bitte danach 0_PORT_4170_FREIGEBEN.bat und 2_DESKTOP_APP_TESTEN.bat starten.');
