const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { Server } = require('socket.io');

let PgPool = null;
try {
  ({ Pool: PgPool } = require('pg'));
} catch (_) {
  PgPool = null;
}

const PORT = Number(process.env.PORT || process.env.ECKL_SERVER_PORT || 4170);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const root = __dirname;
const dataDir = process.env.ECKL_DATA_DIR || (process.env.RENDER ? '/tmp/eckl-data' : path.join(root, 'data'));
const dbFile = path.join(dataDir, 'db.json');
const publicDir = path.join(root, 'public');
const indexFile = path.join(publicDir, 'index.html');

fs.mkdirSync(dataDir, { recursive: true });

const nowIso = () => new Date().toISOString();

function normalizeDateOnly(value, fallback = '') {
  const text = cleanText(value, fallback);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return fallback;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString().slice(0, 10) === text ? text : fallback;
}

function dateOnlyFromIso(value) {
  const date = new Date(value || nowIso());
  return Number.isNaN(date.getTime()) ? nowIso().slice(0, 10) : date.toISOString().slice(0, 10);
}

function addMonthsToDateOnly(dateOnly, months) {
  const safeDate = normalizeDateOnly(dateOnly, DEFAULT_INVENTORY_LAST_DATE);
  const amount = Math.max(1, Math.round(numberOr(months, DEFAULT_INVENTORY_INTERVAL_MONTHS)));
  const [year, month, day] = safeDate.split('-').map(Number);
  const zeroMonth = month - 1 + amount;
  const targetYear = year + Math.floor(zeroMonth / 12);
  const targetMonth = ((zeroMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, targetDay)).toISOString().slice(0, 10);
}

function daysUntilDateOnly(dateOnly) {
  const today = dateOnlyFromIso(nowIso());
  const target = normalizeDateOnly(dateOnly, today);
  return Math.ceil((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}


function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function numberOr(value, fallback = 0) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  let normalized = raw.replace(/\s+/g, '').replace(/[^0-9,.-]/g, '');
  if (!normalized) return fallback;
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = normalized.replace(',', '.');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function cleanText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeDeleteConfirmText(value) {
  return cleanText(value)
    .toUpperCase()
    .replace(/Ö/g, 'OE')
    .replace(/Ä/g, 'AE')
    .replace(/Ü/g, 'UE')
    .replace(/ß/g, 'SS')
    .replace(/\s+/g, ' ');
}

function isDeleteConfirmTextValid(value) {
  const text = normalizeDeleteConfirmText(value);
  return text === 'MATERIALIEN LOESCHEN' || text === 'MATERIALIEN LOSCHEN';
}


function normalizePackageNumbers(value) {
  // Konsi-Paketnummern dürfen bewusst doppelt vorkommen.
  // Deshalb hier KEIN Set verwenden: jede Zeile zählt als eigenes Paket.
  const list = Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/);
  return list.map(v => cleanText(v)).filter(Boolean);
}

function normalizeStrengthList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[\n;]+/);
  return Array.from(new Set(list.map(v => normalizeThickness(v)).filter(Boolean)));
}

function normalizeThickness(value) {
  const text = cleanText(value);
  if (!text) return '';
  const withoutUnit = text.replace(/\s*mm\s*$/i, '').trim();
  if (/^[0-9]+([,.][0-9]+)?$/.test(withoutUnit)) {
    const number = Number(withoutUnit.replace(',', '.'));
    if (Number.isFinite(number)) {
      return `${number.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mm`;
    }
  }
  return text;
}

function normalizeFormat(value) {
  const raw = cleanText(value);
  if (!raw) return '3000x1500';
  const text = raw.toLowerCase().replace(/\s+/g, '').replace('×', 'x').replace('*', 'x');
  const match = text.match(/(\d{3,5})x(\d{3,5})/);
  return match ? `${match[1]}x${match[2]}` : '3000x1500';
}

const ALLOWED_SHELVES = ['Regal 1', 'Regal 2', 'Regal 3', 'Regal 4', 'Regal 5', 'Regal 6', 'Carport', 'Bodenhaltung'];
const ALLOWED_FORMATS = ['4000x2000', '3000x1500', '2500x1250', '2000x1000'];
const ALLOWED_ROLES = ['LASER', 'BUERO', 'CHEF', 'ADMIN'];
const PROGRAM_VERSION = '0.9.5';
const KONSI_LOCATION = 'Garage';
const DEFAULT_MATERIAL_MIN_STOCK = 2; // Fester Mindestbestand: nur normale Tafeln warnen ab 2 Tafeln. Pakete/Konsi/Resttafeln sind ausgenommen.
const APP_NAME = 'Eckl Eco Technics - Materialverwaltung';
const DEFAULT_STANDARD_STRENGTHS = ['1 mm','1,5 mm','2 mm','3 mm','4 mm','5 mm','6 mm','8 mm','10 mm'];
const DEFAULT_INVENTORY_LAST_DATE = '2027-06-30';
const DEFAULT_INVENTORY_INTERVAL_MONTHS = 3;
const INVENTORY_REQUIRED_AREAS = [...ALLOWED_SHELVES, 'KONSI'];
const DAY_MS = 24 * 60 * 60 * 1000;
const SERVER_MODE = cleanText(process.env.ECKL_APP_MODE || (process.env.ECKL_DESKTOP_MODE ? 'desktop' : 'server')).toLowerCase() || 'server';

function networkAddresses() {
  const result = [];
  const nets = os.networkInterfaces();
  Object.keys(nets || {}).forEach(name => {
    (nets[name] || []).forEach(item => {
      if (!item || item.family !== 'IPv4' || item.internal) return;
      result.push(item.address);
    });
  });
  return Array.from(new Set(result));
}

function networkUrls() {
  return networkAddresses().map(ip => `http://${ip}:${PORT}`);
}

function normalizeRole(value) {
  const role = cleanText(value, 'LASER').toUpperCase();
  return ALLOWED_ROLES.includes(role) ? role : 'LASER';
}

function normalizeUsername(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, '');
}

function normalizeShelf(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (ALLOWED_SHELVES.includes(text)) return text;
  const map = {
    'regal a1': 'Regal 1',
    'regal a2': 'Regal 2',
    'regal b1': 'Regal 3',
    'regal b2': 'Regal 4',
    'regal c1': 'Regal 5',
    'restregal r1': 'Bodenhaltung',
    'restregal': 'Bodenhaltung',
    'boden': 'Bodenhaltung',
    'bodenlager': 'Bodenhaltung',
    'bodenhaltung': 'Bodenhaltung',
    'carport': 'Carport'
  };
  const key = text.toLowerCase();
  if (map[key]) return map[key];
  const numberMatch = key.match(/regal\s*(\d+)/);
  if (numberMatch) {
    const shelf = `Regal ${numberMatch[1]}`;
    if (ALLOWED_SHELVES.includes(shelf)) return shelf;
  }
  return 'Bodenhaltung';
}

function normalizeStorage(value, shelf = '') {
  const text = cleanText(value).toUpperCase();
  const shelfText = cleanText(shelf).toLowerCase();
  if (text === 'KONSI' || text === 'KONSI-LAGER' || text === 'KONSIGNATION') return 'KONSI';
  if (shelfText.includes('konsi')) return 'KONSI';
  return 'HAUPTLAGER';
}

function materialHasPackageUnit(material) {
  const text = [material?.unit, material?.type, material?.category].map(v => cleanText(v).toLowerCase()).join(' ');
  return text.includes('paket');
}

function materialUsesSheetMinimum(material) {
  if (!material) return false;
  if (Boolean(material.rest)) return false;
  if (normalizeStorage(material.storage, material.shelf) === 'KONSI') return false;
  if (materialHasPackageUnit(material) && Math.max(0, numberOr(material.sheetStock, 0)) <= 0) return false;
  return true;
}

function materialMinStockValue(material) {
  return materialUsesSheetMinimum(material) ? DEFAULT_MATERIAL_MIN_STOCK : 0;
}

function materialSheetStockValue(material) {
  return Math.max(0, numberOr(material?.sheetStock, numberOr(material?.stock, 0)));
}

function isMaterialLow(material) {
  return materialUsesSheetMinimum(material) && !material.deliveryPending && materialSheetStockValue(material) <= DEFAULT_MATERIAL_MIN_STOCK;
}

function materialHasActiveOrder(materialId) {
  const activeStatuses = ['ANGEFORDERT', 'FREIGEGEBEN', 'BESTELLT', 'TEILGELIEFERT'];
  return (db.orders || []).some(order => order.materialId === materialId && activeStatuses.includes(order.status));
}

function materialDeleteBlockReason(material) {
  if (!material) return 'Material wurde nicht gefunden.';
  if (materialHasActiveOrder(material.id)) return 'Dieses Material hat noch eine offene Bestellung und darf nicht gelöscht werden.';
  if (!isEmptyMaterial(material)) return 'Dieses Material hat noch Bestand. Löschen ist erst bei Bestand 0 erlaubt.';
  return '';
}

function quantityText(material) {
  if (material && material.storage === 'KONSI') {
    const packages = Number(material.stock) || 0;
    return `${packages} Pakete`;
  }
  const packages = Number(material.packageStock) || 0;
  const deliveredPackages = Number(material && material.deliveredPackageCount) || (material && material.deliveryPending ? packages : 0);
  const sheets = Number(material.sheetStock ?? material.stock) || 0;
  if (material && material.deliveryPending && deliveredPackages > 0 && sheets > 0) return `${deliveredPackages} Pakete = ${sheets} Tafeln`;
  if (packages > 0) return `${packages} Pakete${sheets ? ` + ${sheets} Tafeln` : ''}`;
  return `${sheets} ${material.unit || 'Tafeln'}`;
}

function orderQuantityText(order, type = 'request') {
  const amount = type === 'ordered' ? order.orderedAmount : (type === 'received' ? order.receivedAmount : order.requestedAmount);
  const sheets = type === 'ordered' ? order.orderedSheets : (type === 'received' ? order.receivedSheets : order.requestedSheets);
  if (order.storage === 'KONSI') return `${amount || 0} Pakete`;
  if (type === 'received' && Number(amount) > 0 && Number(sheets) > 0) return `${amount || 0} Pakete = ${Number(sheets)} Tafeln`;
  return `${amount || 0} Pakete${Number(sheets) ? ` + ${Number(sheets)} Tafeln` : ''}`;
}


function parseMillimeters(value) {
  const text = cleanText(value).replace(',', '.');
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : 0;
}

function parseFormatSize(value) {
  const text = cleanText(value).toLowerCase().replace(/\s+/g, '');
  const match = text.match(/(\d{3,4})[x×](\d{3,4})/);
  if (!match) return null;
  return { lengthMm: Number(match[1]), widthMm: Number(match[2]) };
}

function densitySearchText(material) {
  return `${cleanText(material && material.name)} ${cleanText(material && material.category)} ${cleanText(material && material.type)} ${cleanText(material && material.articleNumber)} ${cleanText(material && material.note)}`
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function densityInfoForMaterial(material) {
  const text = densitySearchText(material);
  const compact = text.replace(/[\s_.\-/]/g, '');
  if (/\b(en\s*aw[-\s]*)?5754\b/.test(text) || compact.includes('almg3') || text.includes('al mg3')) {
    return { factor: 2.68, label: 'AlMg3 / EN AW-5754' };
  }
  if (compact.includes('almg') || text.includes('alu') || text.includes('aluminium')) {
    return { factor: 2.70, label: 'Aluminium allgemein' };
  }
  if (compact.includes('14301') || text.includes('1.4301') || text.includes('v2a') || compact.includes('x5crni1810') || compact.includes('304')) {
    return { factor: 7.90, label: 'Edelstahl 1.4301 / V2A' };
  }
  if (compact.includes('14404') || text.includes('1.4404') || compact.includes('14571') || text.includes('1.4571') || text.includes('v4a') || compact.includes('316l')) {
    return { factor: 8.00, label: 'Edelstahl V4A / 316L' };
  }
  if (text.includes('edelstahl') || text.includes('rostfrei') || text.includes('niro') || text.includes('inox') || /\bva\b/.test(text)) {
    return { factor: 7.90, label: 'Edelstahl allgemein' };
  }
  if (text.includes('kupfer') || /\bcu\b/.test(text)) {
    return { factor: 8.96, label: 'Kupfer' };
  }
  if (text.includes('messing') || /\bms\b/.test(text) || text.includes('brass')) {
    return { factor: 8.50, label: 'Messing' };
  }
  if (compact.includes('dc01') || compact.includes('s235') || compact.includes('s355') || text.includes('stahl') || text.includes('verzinkt') || text.includes('steel')) {
    return { factor: 7.85, label: 'Stahl' };
  }
  return { factor: 7.85, label: 'Stahl Standardwert' };
}

function densityFactorForMaterial(material) {
  return densityInfoForMaterial(material).factor;
}

function sheetWeightKg(material) {
  const size = parseFormatSize(material && material.format);
  const thickness = parseMillimeters(material && material.thickness);
  if (!size || !thickness) return 0;
  return (size.lengthMm / 1000) * (size.widthMm / 1000) * thickness * densityFactorForMaterial(material);
}

function estimateSheetsFromPackageWeight(material, packageWeightKg, packages) {
  const weight = Number(packageWeightKg);
  const packageCount = Math.max(0, Math.floor(numberOr(packages, 0)));
  const oneSheet = sheetWeightKg(material);
  if (!Number.isFinite(weight) || weight <= 0 || packageCount <= 0 || oneSheet <= 0) return 0;
  return Math.max(0, Math.round((weight * packageCount) / oneSheet));
}

function materialTitleText(material) {
  const name = cleanText(material && material.name, 'Material') || 'Material';
  const thickness = normalizeThickness(material && material.thickness);
  if (!thickness) return name;
  if (name.toLowerCase().includes(thickness.toLowerCase())) return name;
  return `${name} ${thickness}`;
}

function inventoryStatusLabel(status) {
  return ({ OFFEN: 'Offen', IN_BEARBEITUNG: 'In Bearbeitung', GEPRUEFT: 'Geprüft', ABGESCHLOSSEN: 'Abgeschlossen', ABGEBROCHEN: 'Abgebrochen' }[status] || status || 'Offen');
}

function inventoryAreaLabel(area) {
  return area === 'KONSI' ? 'Konsi-Lager' : normalizeShelf(area);
}

function hasInventoryValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function mainInventoryItemCounted(item) {
  return hasInventoryValue(item.countedPackages) || hasInventoryValue(item.countedSheets);
}

function inventoryDifferenceText(item, session) {
  if (session && session.area === 'KONSI') {
    if (item.present === null || item.present === undefined) return 'nicht gezählt';
    return item.present ? 'vorhanden' : 'fehlt';
  }
  if (!mainInventoryItemCounted(item)) return 'nicht gezählt';
  const expP = numberOr(item.expectedPackages, 0);
  const expS = numberOr(item.expectedSheets, 0);
  const cntP = hasInventoryValue(item.countedPackages) ? numberOr(item.countedPackages, 0) : 0;
  const cntS = hasInventoryValue(item.countedSheets) ? numberOr(item.countedSheets, 0) : 0;
  const dp = cntP - expP;
  const ds = cntS - expS;
  if (dp === 0 && ds === 0) return 'keine Differenz';
  const parts = [];
  if (dp) parts.push(`${dp > 0 ? '+' : ''}${dp} Paket(e)`);
  if (ds) parts.push(`${ds > 0 ? '+' : ''}${ds} Tafel(n)`);
  return parts.join(' / ');
}

function inventoryItemCountedForSession(item, session) {
  if (session && session.area === 'KONSI') return item.present !== null && item.present !== undefined;
  return mainInventoryItemCounted(item);
}

function inventoryProgress(session) {
  const total = Array.isArray(session && session.items) ? session.items.length : 0;
  const done = total ? session.items.filter(item => inventoryItemCountedForSession(item, session)).length : 0;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const next = total ? (session.items.find(item => !inventoryItemCountedForSession(item, session)) || null) : null;
  return { total, done, open: Math.max(0, total - done), percent, next };
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[c]));
}

function inventoryExportRows(session) {
  return (session.items || []).map((item, index) => {
    const isK = session.area === 'KONSI';
    return {
      nr: index + 1,
      bereich: inventoryAreaLabel(session.area),
      material: item.title || item.materialName || '',
      staerke: item.thickness || '',
      groesse: item.format || '',
      lagerplatz: item.shelf || inventoryAreaLabel(session.area),
      paketnummer: item.packageNumber || '',
      sollPakete: isK ? '' : (numberOr(item.expectedPackages, 0)),
      sollTafeln: isK ? '' : (numberOr(item.expectedSheets, 0)),
      gezaehltPakete: isK ? (item.present ? 'vorhanden' : item.present === false ? 'fehlt' : '') : (hasInventoryValue(item.countedPackages) ? numberOr(item.countedPackages, 0) : ''),
      gezaehltTafeln: isK ? '' : (hasInventoryValue(item.countedSheets) ? numberOr(item.countedSheets, 0) : ''),
      differenz: inventoryDifferenceText(item, session),
      status: isK ? (item.present === true ? 'Vorhanden' : item.present === false ? 'Fehlt' : 'Offen') : (mainInventoryItemCounted(item) ? 'Gezählt' : 'Offen'),
      bemerkung: item.note || '',
      zusatz: item.extraMaterial ? 'ja' : 'nein'
    };
  });
}

function inventoryExcelHtml(session) {
  const rows = inventoryExportRows(session);
  const headers = ['Nr','Bereich','Material','Stärke','Größe','Lagerplatz','Paketnummer','Soll Pakete','Soll Tafeln','Gezählt Pakete','Gezählt Tafeln','Differenz','Status','Bemerkung','Zusatzmaterial'];
  const keys = ['nr','bereich','material','staerke','groesse','lagerplatz','paketnummer','sollPakete','sollTafeln','gezaehltPakete','gezaehltTafeln','differenz','status','bemerkung','zusatz'];
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:6px}th{background:#eee}</style></head><body><h2>${htmlEscape(APP_NAME)}</h2><h3>Inventur ${htmlEscape(inventoryAreaLabel(session.area))}</h3><p>Status: ${htmlEscape(inventoryStatusLabel(session.status))}<br>Gestartet: ${htmlEscape(session.createdAt || '')}<br>Abgeschlossen: ${htmlEscape(session.closedAt || '')}</p><table><thead><tr>${headers.map(h => `<th>${htmlEscape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${keys.map(k => `<td>${htmlEscape(row[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}

function inventoryPrintHtml(session) {
  const rows = inventoryExportRows(session);
  const progress = inventoryProgress(session);
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Inventur ${htmlEscape(inventoryAreaLabel(session.area))}</title><style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111}.head{border-bottom:4px solid #e4002b;margin-bottom:16px;padding-bottom:12px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}.box{background:#f4f4f4;border:1px solid #ddd;padding:8px}h1{margin:0 0 6px}.badge{display:inline-block;background:#111;color:#fff;padding:5px 9px;font-weight:800}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}th{background:#eee}.print-actions{margin-bottom:14px}@media print{.print-actions{display:none}body{margin:10mm}}</style></head><body><div class="print-actions"><button onclick="window.print()">Drucken / als PDF speichern</button></div><div class="head"><h1>${htmlEscape(APP_NAME)}</h1><h2>Inventur ${htmlEscape(inventoryAreaLabel(session.area))}</h2><span class="badge">${htmlEscape(inventoryStatusLabel(session.status))}</span></div><div class="meta"><div class="box"><strong>Gestartet</strong><br>${htmlEscape(session.createdBy || '-')}<br>${htmlEscape(session.createdAt || '-')}</div><div class="box"><strong>Abgeschlossen</strong><br>${htmlEscape(session.closedBy || '-')}<br>${htmlEscape(session.closedAt || '-')}</div><div class="box"><strong>Fortschritt</strong><br>${progress.done}/${progress.total} Positionen<br>${progress.percent}%</div><div class="box"><strong>Differenzen</strong><br>${rows.filter(r => !['keine Differenz','vorhanden','nicht gezählt'].includes(String(r.differenz).toLowerCase())).length}</div></div><table><thead><tr><th>Nr</th><th>Material</th><th>Stärke</th><th>Größe</th><th>Lagerplatz</th><th>Soll</th><th>Gezählt</th><th>Differenz</th><th>Bemerkung</th></tr></thead><tbody>${rows.map(row => `<tr><td>${row.nr}</td><td>${htmlEscape(row.material)}${row.zusatz === 'ja' ? '<br><strong>Zusatzmaterial</strong>' : ''}</td><td>${htmlEscape(row.staerke)}</td><td>${htmlEscape(row.groesse)}</td><td>${htmlEscape(row.lagerplatz)}</td><td>${htmlEscape(row.paketnummer || `${row.sollPakete} Pakete / ${row.sollTafeln} Tafeln`)}</td><td>${htmlEscape(row.gezaehltPakete)}${row.gezaehltTafeln !== '' ? ` Pakete / ${htmlEscape(row.gezaehltTafeln)} Tafeln` : ''}</td><td>${htmlEscape(row.differenz)}</td><td>${htmlEscape(row.bemerkung)}</td></tr>`).join('')}</tbody></table><script>setTimeout(function(){window.print()},300)</script></body></html>`;
}

function inventoryExportFilename(session, ext) {
  const date = dateOnlyFromIso(session.closedAt || session.createdAt || nowIso());
  const area = inventoryAreaLabel(session.area).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return `Inventur_${date}_${area}.${ext}`;
}


function inventoryCycleKey(session) {
  if (!session) return '';
  if (session.cycleId) return cleanText(session.cycleId);
  const date = dateOnlyFromIso(session.createdAt || session.closedAt || nowIso());
  return `legacy_${date}`;
}

function inventoryCycleSessions(cycleId) {
  const key = cleanText(cycleId);
  return (db.inventories || [])
    .filter(session => inventoryCycleKey(session) === key)
    .sort((a, b) => INVENTORY_REQUIRED_AREAS.indexOf(a.area) - INVENTORY_REQUIRED_AREAS.indexOf(b.area));
}

function inventoryCycleSummaryFromSessions(sessions) {
  const relevant = (sessions || []).filter(session => session.status !== 'ABGEBROCHEN');
  const closed = relevant.filter(session => session.status === 'ABGESCHLOSSEN');
  const doneAreas = new Set(closed.map(session => session.area));
  const activeAreas = new Set(relevant.filter(session => session.status !== 'ABGESCHLOSSEN').map(session => session.area));
  const missingAreas = INVENTORY_REQUIRED_AREAS.filter(area => !doneAreas.has(area) && !activeAreas.has(area));
  const openAreas = INVENTORY_REQUIRED_AREAS.filter(area => activeAreas.has(area));
  const done = INVENTORY_REQUIRED_AREAS.filter(area => doneAreas.has(area)).length;
  const totalItems = relevant.reduce((sum, session) => sum + (Array.isArray(session.items) ? session.items.length : 0), 0);
  const doneItems = relevant.reduce((sum, session) => sum + inventoryProgress(session).done, 0);
  const cycleId = relevant[0] ? inventoryCycleKey(relevant[0]) : (sessions && sessions[0] ? inventoryCycleKey(sessions[0]) : '');
  const startedAt = relevant.map(s => s.createdAt).filter(Boolean).sort()[0] || '';
  const closedAtValues = closed.map(s => s.closedAt).filter(Boolean).sort();
  const closedAt = done >= INVENTORY_REQUIRED_AREAS.length ? closedAtValues[closedAtValues.length - 1] || '' : '';
  return {
    cycleId,
    sessions: relevant,
    done,
    total: INVENTORY_REQUIRED_AREAS.length,
    percent: INVENTORY_REQUIRED_AREAS.length ? Math.round((done / INVENTORY_REQUIRED_AREAS.length) * 100) : 0,
    complete: done >= INVENTORY_REQUIRED_AREAS.length,
    missingAreas,
    openAreas,
    doneAreas: Array.from(doneAreas),
    totalItems,
    doneItems,
    startedAt,
    closedAt,
    createdBy: relevant.find(s => s.createdBy)?.createdBy || '',
    closedBy: closed.findLast ? (closed.findLast(s => s.closedBy)?.closedBy || '') : ((closed.slice().reverse().find(s => s.closedBy) || {}).closedBy || '')
  };
}

function inventoryCycleSummary(cycleId) {
  return inventoryCycleSummaryFromSessions(inventoryCycleSessions(cycleId));
}

function currentInventoryCycleId() {
  const sessions = db.inventories || [];
  const active = sessions.find(session => session.status !== 'ABGESCHLOSSEN' && session.status !== 'ABGEBROCHEN');
  if (active) return inventoryCycleKey(active);
  const cycleIds = Array.from(new Set(sessions.filter(s => s.status !== 'ABGEBROCHEN').map(inventoryCycleKey).filter(Boolean)));
  for (const cycleId of cycleIds) {
    const summary = inventoryCycleSummary(cycleId);
    if (!summary.complete) return cycleId;
  }
  return uid('invc');
}

function inventoryCycleExportRows(sessions) {
  return (sessions || []).flatMap(session => inventoryExportRows(session));
}

function inventoryCycleExportFilename(cycleId, ext) {
  const summary = inventoryCycleSummary(cycleId);
  const date = dateOnlyFromIso(summary.closedAt || summary.startedAt || nowIso());
  return `Inventur_Gesamt_${date}.${ext}`;
}

function inventoryCycleExcelHtml(cycleId) {
  const sessions = inventoryCycleSessions(cycleId).filter(session => session.status === 'ABGESCHLOSSEN');
  const summary = inventoryCycleSummaryFromSessions(sessions);
  const rows = inventoryCycleExportRows(sessions);
  const headers = ['Nr','Bereich','Material','Stärke','Größe','Lagerplatz','Paketnummer','Soll Pakete','Soll Tafeln','Gezählt Pakete','Gezählt Tafeln','Differenz','Status','Bemerkung','Zusatzmaterial'];
  const keys = ['nr','bereich','material','staerke','groesse','lagerplatz','paketnummer','sollPakete','sollTafeln','gezaehltPakete','gezaehltTafeln','differenz','status','bemerkung','zusatz'];
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:6px}th{background:#eee}</style></head><body><h2>${htmlEscape(APP_NAME)}</h2><h3>Gesamtinventur</h3><p>Abgeschlossen: ${htmlEscape(summary.closedAt || '')}<br>Bereiche: ${summary.done}/${summary.total}</p><table><thead><tr>${headers.map(h => `<th>${htmlEscape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row, index) => `<tr>${keys.map(k => `<td>${htmlEscape(k === 'nr' ? index + 1 : row[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}

function inventoryCyclePrintHtml(cycleId) {
  const sessions = inventoryCycleSessions(cycleId).filter(session => session.status === 'ABGESCHLOSSEN');
  const summary = inventoryCycleSummaryFromSessions(sessions);
  const rows = inventoryCycleExportRows(sessions);
  const differenceCount = rows.filter(r => !['keine Differenz','vorhanden','nicht gezählt'].includes(String(r.differenz).toLowerCase())).length;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Gesamtinventur</title><style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111}.head{border-bottom:4px solid #e4002b;margin-bottom:16px;padding-bottom:12px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}.box{background:#f4f4f4;border:1px solid #ddd;padding:8px}h1{margin:0 0 6px}.badge{display:inline-block;background:#111;color:#fff;padding:5px 9px;font-weight:800}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}th{background:#eee}.print-actions{margin-bottom:14px}@media print{.print-actions{display:none}body{margin:10mm}}</style></head><body><div class="print-actions"><button onclick="window.print()">Drucken / als PDF speichern</button></div><div class="head"><h1>${htmlEscape(APP_NAME)}</h1><h2>Gesamtinventur</h2><span class="badge">Alle Bereiche abgeschlossen</span></div><div class="meta"><div class="box"><strong>Gestartet</strong><br>${htmlEscape(summary.startedAt || '-')}</div><div class="box"><strong>Abgeschlossen</strong><br>${htmlEscape(summary.closedAt || '-')}</div><div class="box"><strong>Bereiche</strong><br>${summary.done}/${summary.total}</div><div class="box"><strong>Differenzen</strong><br>${differenceCount}</div></div><table><thead><tr><th>Nr</th><th>Bereich</th><th>Material</th><th>Stärke</th><th>Größe</th><th>Lagerplatz</th><th>Soll</th><th>Gezählt</th><th>Differenz</th><th>Bemerkung</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td><td>${htmlEscape(row.bereich)}</td><td>${htmlEscape(row.material)}${row.zusatz === 'ja' ? '<br><strong>Zusatzmaterial</strong>' : ''}</td><td>${htmlEscape(row.staerke)}</td><td>${htmlEscape(row.groesse)}</td><td>${htmlEscape(row.lagerplatz)}</td><td>${htmlEscape(row.paketnummer || `${row.sollPakete} Pakete / ${row.sollTafeln} Tafeln`)}</td><td>${htmlEscape(row.gezaehltPakete)}${row.gezaehltTafeln !== '' ? ` Pakete / ${htmlEscape(row.gezaehltTafeln)} Tafeln` : ''}</td><td>${htmlEscape(row.differenz)}</td><td>${htmlEscape(row.bemerkung)}</td></tr>`).join('')}</tbody></table><script>setTimeout(function(){window.print()},300)</script></body></html>`;
}

function normalizeInventorySession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: cleanText(raw.id) || uid('inv'),
    area: cleanText(raw.area, 'Regal 1') === 'KONSI' ? 'KONSI' : normalizeShelf(raw.area),
    status: ['OFFEN', 'IN_BEARBEITUNG', 'GEPRUEFT', 'ABGESCHLOSSEN', 'ABGEBROCHEN'].includes(raw.status) ? raw.status : 'OFFEN',
    createdBy: cleanText(raw.createdBy, ''),
    createdByRole: cleanText(raw.createdByRole, ''),
    createdAt: raw.createdAt || nowIso(),
    updatedBy: cleanText(raw.updatedBy, ''),
    updatedAt: raw.updatedAt || raw.createdAt || nowIso(),
    cycleId: cleanText(raw.cycleId, '') || `legacy_${dateOnlyFromIso(raw.createdAt || raw.closedAt || nowIso())}`,
    canceledBy: cleanText(raw.canceledBy, ''),
    canceledAt: raw.canceledAt || null,
    cancelReason: cleanText(raw.cancelReason, ''),
    checkedBy: cleanText(raw.checkedBy, ''),
    checkedAt: raw.checkedAt || null,
    closedBy: cleanText(raw.closedBy, ''),
    closedAt: raw.closedAt || null,
    items: Array.isArray(raw.items) ? raw.items.map((item, index) => ({
      id: cleanText(item.id) || uid('invi'),
      materialId: cleanText(item.materialId),
      materialName: cleanText(item.materialName, `Material ${index + 1}`),
      title: cleanText(item.title, item.materialName || `Material ${index + 1}`),
      thickness: cleanText(item.thickness, ''),
      format: cleanText(item.format, ''),
      shelf: cleanText(item.shelf, ''),
      packageNumber: cleanText(item.packageNumber, ''),
      expectedPresent: item.expectedPresent === undefined ? true : Boolean(item.expectedPresent),
      present: item.present === null || item.present === undefined ? null : Boolean(item.present),
      expectedPackages: Math.max(0, numberOr(item.expectedPackages, 0)),
      expectedSheets: Math.max(0, numberOr(item.expectedSheets, 0)),
      countedPackages: item.countedPackages === null || item.countedPackages === undefined ? null : Math.max(0, numberOr(item.countedPackages, 0)),
      countedSheets: item.countedSheets === null || item.countedSheets === undefined ? null : Math.max(0, numberOr(item.countedSheets, 0)),
      note: cleanText(item.note, ''),
      extraMaterial: Boolean(item.extraMaterial),
      rest: Boolean(item.rest),
      createdFromInventory: Boolean(item.createdFromInventory)
    })) : []
  };
}

function defaultMaterials(created) {
  return [
    {
      id: 'm_alu_15', name: 'Aluminium 1,5 mm', category: 'Aluminium', type: 'Tafel', thickness: '1,5 mm', format: '2000 x 1000 mm', unit: 'Tafeln', stock: 14, minStock: 8,
      storage: 'HAUPTLAGER', shelf: 'Regal 1', compartment: 'Fach 01', supplier: 'Standardlieferant', articleNumber: 'ALU-15-2000', rest: false, note: '', archived: false, createdAt: created, updatedAt: created
    },
    {
      id: 'm_alu_20', name: 'Aluminium 2,0 mm', category: 'Aluminium', type: 'Tafel', thickness: '2,0 mm', format: '3000 x 1500 mm', unit: 'Tafeln', stock: 6, minStock: 10,
      storage: 'HAUPTLAGER', shelf: 'Regal 2', compartment: 'Fach 03', supplier: 'Standardlieferant', articleNumber: 'ALU-20-3000', rest: false, note: 'Demo: unter Mindestbestand.', archived: false, createdAt: created, updatedAt: created
    },
    {
      id: 'm_stahl_10', name: 'Stahl DC01 1,0 mm', category: 'Stahl', type: 'Tafel', thickness: '1,0 mm', format: '2500 x 1250 mm', unit: 'Tafeln', stock: 22, minStock: 12,
      storage: 'HAUPTLAGER', shelf: 'Regal 3', compartment: 'Fach 02', supplier: 'Stahlhandel', articleNumber: 'DC01-10-2500', rest: false, note: '', archived: false, createdAt: created, updatedAt: created
    },
    {
      id: 'm_stahl_30', name: 'Stahl S235 3,0 mm', category: 'Stahl', type: 'Tafel', thickness: '3,0 mm', format: '3000 x 1500 mm', unit: 'Tafeln', stock: 4, minStock: 6,
      storage: 'HAUPTLAGER', shelf: 'Regal 4', compartment: 'Fach 05', supplier: 'Stahlhandel', articleNumber: 'S235-30-3000', rest: false, note: 'Bitte für Laser im Blick behalten.', archived: false, createdAt: created, updatedAt: created
    },
    {
      id: 'm_va_15', name: 'Edelstahl V2A 1,5 mm', category: 'Edelstahl', type: 'Tafel', thickness: '1,5 mm', format: '2500 x 1250 mm', unit: 'Tafeln', stock: 3, minStock: 5,
      storage: 'HAUPTLAGER', shelf: 'Regal 5', compartment: 'Fach 01', supplier: 'Edelstahlhandel', articleNumber: 'V2A-15-2500', rest: false, note: '', archived: false, createdAt: created, updatedAt: created
    },
    {
      id: 'm_konsi_demo', name: 'Konsi-Material Beispiel', category: 'Konsi-Lager', type: 'Tafel', thickness: '2,0 mm', format: '3000 x 1500 mm', unit: 'Pakete', stock: 12, sheetStock: 0, packageNumbers: ['KONSI-001','KONSI-002','KONSI-003','KONSI-004','KONSI-005','KONSI-006','KONSI-007','KONSI-008','KONSI-009','KONSI-010','KONSI-011','KONSI-012'], minStock: 4,
      storage: 'KONSI', shelf: KONSI_LOCATION, compartment: 'Garage', supplier: 'Konsi-Lieferant', articleNumber: 'KONSI-DEMO', rest: false, note: 'Demo-Eintrag für den neuen Konsi-Lager-Reiter.', archived: false, createdAt: created, updatedAt: created
    },
    {
      id: 'm_rest_alu', name: 'Resttafel Aluminium gemischt', category: 'Resttafeln', type: 'Resttafel', thickness: 'gemischt', format: 'verschiedene Formate', unit: 'Stück', stock: 18, minStock: 0,
      storage: 'HAUPTLAGER', shelf: 'Bodenhaltung', compartment: 'Box A', supplier: '', articleNumber: '', rest: true, note: 'Resttafeln lösen keine Warnung und keine automatische Bestellung aus.', archived: false, createdAt: created, updatedAt: created
    }
  ];
}


function defaultSettings() {
  return {
    programName: APP_NAME,
    version: PROGRAM_VERSION,
    shelves: ALLOWED_SHELVES.slice(),
    konsiLocation: KONSI_LOCATION,
    formats: ALLOWED_FORMATS.slice(),
    standardStrengths: DEFAULT_STANDARD_STRENGTHS.slice(),
    autoBackupOnStart: true,
    inventoryLastDate: DEFAULT_INVENTORY_LAST_DATE,
    inventoryIntervalMonths: DEFAULT_INVENTORY_INTERVAL_MONTHS,
    updatedAt: nowIso()
  };
}

function normalizeSettings(raw = {}) {
  const defaults = defaultSettings();
  const formats = Array.isArray(raw.formats) ? raw.formats.map(normalizeFormat).filter(Boolean) : defaults.formats;
  const strengths = raw.standardStrengths === undefined ? defaults.standardStrengths : normalizeStrengthList(raw.standardStrengths);
  const intervalMonths = Math.max(1, Math.min(24, Math.round(numberOr(raw.inventoryIntervalMonths, defaults.inventoryIntervalMonths))));
  const inventoryLastDate = normalizeDateOnly(raw.inventoryLastDate, defaults.inventoryLastDate);
  return {
    programName: APP_NAME,
    version: PROGRAM_VERSION,
    shelves: ALLOWED_SHELVES.slice(),
    konsiLocation: KONSI_LOCATION,
    formats: Array.from(new Set(formats.length ? formats : defaults.formats)).filter(f => ALLOWED_FORMATS.includes(f)),
    standardStrengths: Array.from(new Set(strengths.length ? strengths : defaults.standardStrengths)),
    autoBackupOnStart: raw.autoBackupOnStart === undefined ? true : Boolean(raw.autoBackupOnStart),
    inventoryLastDate,
    inventoryIntervalMonths: intervalMonths,
    inventoryNextDate: addMonthsToDateOnly(inventoryLastDate, intervalMonths),
    updatedAt: raw.updatedAt || nowIso()
  };
}

function defaultDb() {
  const created = nowIso();
  return {
    version: 19,
    users: [
      { id: 'u_admin', username: 'admin', password: 'admin123', name: 'System Admin', role: 'ADMIN', active: true, mustChangePassword: false, createdAt: created, updatedAt: created, lastLogin: null },
      { id: 'u_laser', username: 'laser', password: 'laser123', name: 'Laser Arbeitsplatz', role: 'LASER', active: true, mustChangePassword: false, createdAt: created, updatedAt: created, lastLogin: null },
      { id: 'u_buero', username: 'buero', password: 'buero123', name: 'Büro Einkauf', role: 'BUERO', active: true, mustChangePassword: false, createdAt: created, updatedAt: created, lastLogin: null },
      { id: 'u_chef', username: 'chef', password: 'chef123', name: 'Chef', role: 'CHEF', active: true, mustChangePassword: false, createdAt: created, updatedAt: created, lastLogin: null }
    ],
    sessions: {},
    materials: [],
    orders: [],
    activities: [
      { id: uid('a'), type: 'SYSTEM', text: `Materialverwaltung ${PROGRAM_VERSION} mit leerer Materialdatenbank gestartet.`, at: created }
    ],
    inventories: [],
    settings: defaultSettings()
  };
}

function normalizeMaterial(raw, index = 0) {
  const created = raw.createdAt || nowIso();
  const name = cleanText(raw.name, `Material ${index + 1}`) || `Material ${index + 1}`;
  const rest = Boolean(raw.rest) || String(raw.type || '').toLowerCase().includes('rest');
  const storage = normalizeStorage(raw.storage, raw.shelf);
  const packageNumbers = storage === 'KONSI' ? normalizePackageNumbers(raw.packageNumbers) : [];
  const shelf = storage === 'KONSI' ? KONSI_LOCATION : normalizeShelf(raw.shelf);
  const unit = storage === 'KONSI' ? 'Pakete' : (cleanText(raw.unit, rest ? 'Stück' : 'Tafeln') || (rest ? 'Stück' : 'Tafeln'));
  const type = cleanText(raw.type, rest ? 'Resttafel' : 'Tafel') || (rest ? 'Resttafel' : 'Tafel');
  const category = cleanText(raw.category, rest ? 'Resttafeln' : 'Allgemein') || (rest ? 'Resttafeln' : 'Allgemein');
  const unitText = [unit, type, category].join(' ').toLowerCase();
  const packageOnlyStock = unitText.includes('paket') && raw.sheetStock === undefined && raw.packageStock === undefined && !Boolean(raw.deliveryPending);
  const normalizedStock = storage === 'KONSI' && packageNumbers.length ? packageNumbers.length : (Boolean(raw.deliveryPending) ? Math.max(0, numberOr(raw.sheetStock, numberOr(raw.stock, 0))) : Math.max(0, numberOr(raw.stock, 0)));
  const normalizedPackageStock = storage === 'KONSI' ? 0 : (Boolean(raw.deliveryPending) ? 0 : Math.max(0, numberOr(raw.packageStock, packageOnlyStock ? raw.stock : 0)));
  const normalizedSheetStock = storage === 'KONSI' ? 0 : (packageOnlyStock ? 0 : Math.max(0, numberOr(raw.sheetStock, numberOr(raw.stock, 0))));
  const baseMaterialForMinimum = { storage, shelf, rest, unit, type, category, sheetStock: normalizedSheetStock };
  return {
    id: cleanText(raw.id) || uid('m'),
    name,
    category,
    type,
    thickness: normalizeThickness(raw.thickness),
    format: normalizeFormat(raw.format),
    unit,
    stock: normalizedStock,
    packageStock: normalizedPackageStock,
    sheetStock: normalizedSheetStock,
    packageNumbers,
    minStock: materialMinStockValue(baseMaterialForMinimum),
    storage,
    shelf,
    compartment: cleanText(raw.compartment, ''),
    supplier: cleanText(raw.supplier, ''),
    articleNumber: cleanText(raw.articleNumber, ''),
    rest,
    note: cleanText(raw.note, ''),
    deliveryPending: Boolean(raw.deliveryPending),
    deliveryStatus: Boolean(raw.deliveryPending) ? 'GELIEFERT' : cleanText(raw.deliveryStatus, ''),
    deliveredAt: raw.deliveredAt || null,
    deliveredBy: cleanText(raw.deliveredBy, ''),
    deliveredFromOrderId: cleanText(raw.deliveredFromOrderId, ''),
    deliveredPackageCount: Math.max(0, numberOr(raw.deliveredPackageCount, (Boolean(raw.deliveryPending) ? raw.packageStock : 0))),
    lastPackageWeightKg: raw.lastPackageWeightKg === undefined || raw.lastPackageWeightKg === null ? null : Math.max(0, numberOr(raw.lastPackageWeightKg, 0)),
    archived: Boolean(raw.archived),
    createdAt: created,
    updatedAt: raw.updatedAt || created
  };
}


function defaultAdminUser() {
  const created = nowIso();
  return { id: 'u_admin', username: 'admin', password: 'admin123', name: 'System Admin', role: 'ADMIN', active: true, mustChangePassword: false, createdAt: created, updatedAt: created, lastLogin: null };
}

function normalizeUser(raw, index = 0) {
  const fallback = `benutzer${index + 1}`;
  const username = normalizeUsername(raw.username || fallback) || fallback;
  const role = normalizeRole(raw.role);
  let name = cleanText(raw.name, username) || username;
  if (role === 'CHEF' && /admin/i.test(name)) name = 'Chef';
  return {
    id: cleanText(raw.id) || uid('u'),
    username,
    password: String(raw.password || 'start123'),
    name,
    role,
    active: raw.active === undefined ? true : Boolean(raw.active),
    mustChangePassword: Boolean(raw.mustChangePassword),
    lastLogin: raw.lastLogin || null,
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || raw.createdAt || nowIso()
  };
}

function publicManagedUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    active: user.active !== false,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLogin: user.lastLogin || null,
    mustChangePassword: Boolean(user.mustChangePassword)
  };
}

function ensureAdminUser(db) {
  const hasActiveAdmin = db.users.some(u => u.role === 'ADMIN' && u.active !== false);
  if (hasActiveAdmin) return false;
  const admin = defaultAdminUser();
  if (db.users.some(u => u.username === admin.username)) admin.username = `admin${Date.now().toString().slice(-4)}`;
  db.users.unshift(admin);
  return true;
}


function materialKeyForRestore(material) {
  return [cleanText(material.id), cleanText(material.name).toLowerCase(), normalizeThickness(material.thickness).toLowerCase(), normalizeFormat(material.format)].join('|');
}

function findLegacyDbCandidates() {
  const candidates = [];
  try {
    const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');
    if (localAppData) {
      candidates.push(path.join(localAppData, 'Eckl Lagerverwaltung', 'Daten', 'db.json'));
      candidates.push(path.join(localAppData, 'Eckl Eco Technics - Materialverwaltung', 'Daten', 'db.json.backup-v032'));
      candidates.push(path.join(localAppData, 'Eckl Eco Technics - Materialverwaltung', 'Daten', 'db.json.v031'));
    }
  } catch (_) {}
  return Array.from(new Set(candidates)).filter(file => file && file !== dbFile && fs.existsSync(file));
}

function loadLegacyMaterialMap() {
  const map = new Map();
  for (const file of findLegacyDbCandidates()) {
    try {
      const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!legacy || !Array.isArray(legacy.materials)) continue;
      legacy.materials.forEach((raw, index) => {
        const m = normalizeMaterial(raw, index);
        const total = numberOr(raw.stock, numberOr(m.stock, 0));
        const sheet = Math.max(0, numberOr(raw.sheetStock, total));
        const pack = Math.max(0, numberOr(raw.packageStock, 0));
        const key = materialKeyForRestore(m);
        if (!map.has(key) && (total > 0 || sheet > 0 || pack > 0)) {
          map.set(key, { stock: Math.max(total, pack + sheet), sheetStock: sheet || total, packageStock: pack, packageNumbers: normalizePackageNumbers(raw.packageNumbers) });
        }
      });
    } catch (_) {}
  }
  return map;
}

function repairMaterialQuantities(materials) {
  let changed = false;
  const legacyMap = loadLegacyMaterialMap();
  materials.forEach(material => {
    if (material.storage === 'KONSI') {
      const nums = normalizePackageNumbers(material.packageNumbers);
      if (nums.length && material.stock !== nums.length) { material.stock = nums.length; changed = true; }
      return;
    }
    const packageStock = Math.max(0, numberOr(material.packageStock, 0));
    const sheetStock = Math.max(0, numberOr(material.sheetStock, 0));
    const stock = Math.max(0, numberOr(material.stock, 0));
    if (stock > 0 && packageStock + sheetStock === 0) {
      material.sheetStock = stock;
      material.stock = stock;
      changed = true;
      return;
    }
    if (stock === 0 && packageStock + sheetStock === 0) {
      const legacy = legacyMap.get(materialKeyForRestore(material));
      if (legacy && (legacy.stock > 0 || legacy.sheetStock > 0 || legacy.packageStock > 0)) {
        material.packageStock = legacy.packageStock || 0;
        material.sheetStock = legacy.sheetStock || legacy.stock || 0;
        material.stock = (material.packageStock || 0) + (material.sheetStock || 0);
        material.updatedAt = nowIso();
        changed = true;
      }
      return;
    }
    const total = packageStock + sheetStock;
    if (total !== stock) {
      material.stock = total;
      changed = true;
    }
  });
  return changed;
}

function migrateDb(db) {
  let changed = false;
  if (!db || typeof db !== 'object') return defaultDb();
  if (!Array.isArray(db.users)) { db.users = defaultDb().users; changed = true; }
  else {
    const normalizedUsers = db.users.map(normalizeUser);
    if (JSON.stringify(normalizedUsers) !== JSON.stringify(db.users)) { db.users = normalizedUsers; changed = true; }
  }
  if (ensureAdminUser(db)) changed = true;
  if (!db.sessions || typeof db.sessions !== 'object') { db.sessions = {}; changed = true; }
  if (!Array.isArray(db.materials)) { db.materials = defaultMaterials(nowIso()); changed = true; }
  const normalized = db.materials.map(normalizeMaterial);
  if (JSON.stringify(normalized) !== JSON.stringify(db.materials)) {
    db.materials = normalized;
    changed = true;
  }
  if (repairMaterialQuantities(db.materials)) changed = true;
  if (!Array.isArray(db.orders)) { db.orders = []; changed = true; }
  db.orders = db.orders.map(order => {
    const material = db.materials.find(m => m.id === order.materialId);
    const normalizedOrder = {
      doneBy: null,
      doneAt: null,
      requestedSheets: 0,
      orderedSheets: 0,
      receivedAmount: 0,
      receivedSheets: 0,
      receivedBy: null,
      receivedAt: null,
      deliveredToShelf: '',
      deliveries: [],
      lastPackageWeightKg: null,
      storage: material ? material.storage : 'HAUPTLAGER',
      ...order
    };
    if (normalizedOrder.status === 'FREIGEGEBEN') normalizedOrder.status = 'ANGEFORDERT';
    if (!['ANGEFORDERT', 'BESTELLT', 'TEILGELIEFERT', 'ERLEDIGT', 'ABGELEHNT'].includes(normalizedOrder.status)) normalizedOrder.status = 'ANGEFORDERT';
    normalizedOrder.receivedAmount = Math.max(0, numberOr(normalizedOrder.receivedAmount, 0));
    normalizedOrder.receivedSheets = Math.max(0, numberOr(normalizedOrder.receivedSheets, 0));
    normalizedOrder.deliveries = Array.isArray(normalizedOrder.deliveries) ? normalizedOrder.deliveries : [];
    return normalizedOrder;
  });
  if (!Array.isArray(db.activities)) { db.activities = []; changed = true; }
  if (!Array.isArray(db.inventories)) { db.inventories = []; changed = true; }
  db.inventories = db.inventories.map(normalizeInventorySession).filter(Boolean);
  const normalizedSettings = normalizeSettings(db.settings || {});
  if (JSON.stringify(db.settings || {}) !== JSON.stringify(normalizedSettings)) { db.settings = normalizedSettings; changed = true; }
  if (db.version !== 19) { db.version = 19; changed = true; }
  if (changed) saveDb(db);
  return db;
}

const DATABASE_URL = cleanText(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || '');
let pgPool = null;
let pgSaveTimer = null;

function localSaveDb(nextDb) {
  fs.writeFileSync(dbFile, JSON.stringify(nextDb, null, 2));
}

async function initPostgresStore() {
  if (!DATABASE_URL) return false;
  if (!PgPool) throw new Error('Postgres ist aktiviert, aber das npm-Paket pg fehlt. Bitte npm install ausführen.');
  pgPool = new PgPool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    max: 3
  });
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS eckl_lager_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('Online-Datenbank verbunden: Postgres JSONB-Speicher aktiv.');
  return true;
}

async function loadDbFromPostgres() {
  await initPostgresStore();
  if (!pgPool) return null;
  const result = await pgPool.query('SELECT data FROM eckl_lager_state WHERE id = $1', ['main']);
  if (!result.rows.length) {
    const created = defaultDb();
    await pgPool.query(
      'INSERT INTO eckl_lager_state (id, data, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
      ['main', JSON.stringify(created)]
    );
    return created;
  }
  return migrateDb(result.rows[0].data);
}

function loadDb() {
  if (!fs.existsSync(dbFile)) {
    const db = defaultDb();
    localSaveDb(db);
    return db;
  }
  try {
    const raw = fs.readFileSync(dbFile, 'utf8');
    const backupFile = path.join(dataDir, 'db.json.backup-v032');
    if (!fs.existsSync(backupFile)) fs.writeFileSync(backupFile, raw);
    return migrateDb(JSON.parse(raw));
  } catch (error) {
    const broken = `${dbFile}.defekt-${Date.now()}`;
    fs.copyFileSync(dbFile, broken);
    const db = defaultDb();
    localSaveDb(db);
    return db;
  }
}

async function loadDbAsync() {
  if (DATABASE_URL) {
    return loadDbFromPostgres();
  }
  return loadDb();
}

function saveDb(nextDb = db) {
  if (pgPool) {
    clearTimeout(pgSaveTimer);
    const payload = JSON.stringify(nextDb);
    pgSaveTimer = setTimeout(() => {
      pgPool.query(
        'INSERT INTO eckl_lager_state (id, data, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
        ['main', payload]
      ).catch(error => console.error('Online-Datenbank konnte nicht gespeichert werden:', error.message));
    }, 80);
    return;
  }
  localSaveDb(nextDb);
}

let db = null;

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function materialSnapshotById(materialId) {
  const material = db.materials.find(m => m.id === materialId);
  return { id: materialId, existed: Boolean(material), material: material ? cloneData(material) : null };
}

function makeUndo(action, materials, label = '') {
  return { id: uid('undo'), action, label, materials: materials.map(m => cloneData(m)), used: false, createdAt: nowIso() };
}

function addActivity(type, text, user = null, extra = {}) {
  const entry = {
    id: uid('a'),
    type,
    text,
    user: user ? user.name : null,
    role: user ? user.role : null,
    at: nowIso(),
    ...extra
  };
  db.activities.unshift(entry);
  db.activities = db.activities.slice(0, 300);
  return entry;
}

function materialHistoryMatches(activity, material) {
  if (!activity || !material) return false;
  if (activity.materialId === material.id) return true;
  if (Array.isArray(activity.materialIds) && activity.materialIds.includes(material.id)) return true;
  const title = materialTitleText(material).toLowerCase();
  const name = cleanText(material.name).toLowerCase();
  const text = cleanText(activity.text).toLowerCase();
  return Boolean(name && text.includes(name)) || Boolean(title && text.includes(title));
}

function latestUndoForMaterial(materialId) {
  return (db.activities || []).find(a => a.undo && !a.undo.used && Array.isArray(a.undo.materials) && a.undo.materials.some(m => m.id === materialId));
}

function duplicateMaterialKey(material) {
  return [
    normalizeStorage(material.storage, material.shelf),
    cleanText(material.name).toLowerCase(),
    normalizeThickness(material.thickness).toLowerCase(),
    normalizeFormat(material.format),
    normalizeShelf(material.shelf),
    material.rest ? 'REST' : 'NORMAL'
  ].join('|');
}

function findDuplicateMaterial(material, excludeId = null) {
  const key = duplicateMaterialKey(material);
  return db.materials.find(m => !m.archived && m.id !== excludeId && duplicateMaterialKey(m) === key) || null;
}

function mergeMaterialQuantities(target, incoming) {
  if (target.storage === 'KONSI' || incoming.storage === 'KONSI') {
    const existingNumbers = normalizePackageNumbers(target.packageNumbers);
    const incomingNumbers = normalizePackageNumbers(incoming.packageNumbers);
    const addPackages = Math.max(0, numberOr(incoming.stock, 0));
    target.packageNumbers = incomingNumbers.length ? existingNumbers.concat(incomingNumbers) : existingNumbers;
    target.stock = target.packageNumbers.length || (Math.max(0, numberOr(target.stock, 0)) + addPackages);
    target.packageStock = 0;
    target.sheetStock = 0;
  } else {
    target.packageStock = Math.max(0, numberOr(target.packageStock, 0)) + Math.max(0, numberOr(incoming.packageStock, 0));
    target.sheetStock = Math.max(0, numberOr(target.sheetStock, numberOr(target.stock, 0))) + Math.max(0, numberOr(incoming.sheetStock, numberOr(incoming.stock, 0)));
    target.stock = target.packageStock + target.sheetStock;
  }
  target.minStock = materialMinStockValue(target);
  target.updatedAt = nowIso();
  return target;
}

function duplicateResponse(res, duplicate, material) {
  return res.status(409).json({
    code: 'DUPLICATE',
    error: `${materialTitleText(duplicate)} existiert bereits in ${duplicate.shelf}.`,
    duplicate: { id: duplicate.id, title: materialTitleText(duplicate), quantity: quantityText(duplicate), shelf: duplicate.shelf },
    incoming: { title: materialTitleText(material), quantity: quantityText(material), shelf: material.shelf }
  });
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, name: user.name, role: user.role, active: user.active !== false, mustChangePassword: Boolean(user.mustChangePassword), lastLogin: user.lastLogin || null };
}

function getUserFromToken(token) {
  if (!token || !db.sessions[token]) return null;
  const session = db.sessions[token];
  return db.users.find(u => u.id === session.userId && u.active !== false) || null;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  const user = getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  req.token = token;
  req.user = user;
  next();
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Keine Berechtigung für diese Aktion.' });
    next();
  };
}

function roleLabel(role) {
  return ({ LASER: 'Laser', BUERO: 'Büro', CHEF: 'Chef', ADMIN: 'Admin' }[role] || role);
}

function visibleMaterials() {
  return db.materials.filter(m => !m.archived);
}

function materialCountValue(material) {
  return (Number(material && material.stock) || 0)
    + (Number(material && material.sheetStock) || 0)
    + (Number(material && material.packageStock) || 0)
    + (Array.isArray(material && material.packageNumbers) ? material.packageNumbers.length : 0);
}

function isEmptyMaterial(material) {
  return materialCountValue(material) <= 0;
}

function purgeRelatedDataForMaterialIds(materialIds) {
  const ids = new Set(materialIds || []);
  if (!ids.size) return { ordersRemoved: 0, inventoriesTouched: 0, undoCleaned: 0 };
  const beforeOrders = Array.isArray(db.orders) ? db.orders.length : 0;
  db.orders = (db.orders || []).filter(order => !ids.has(order.materialId));
  let inventoriesTouched = 0;
  (db.inventories || []).forEach(session => {
    if (!Array.isArray(session.items)) return;
    const before = session.items.length;
    session.items = session.items.filter(item => !ids.has(item.materialId));
    if (session.items.length !== before) inventoriesTouched += 1;
  });
  let undoCleaned = 0;
  (db.activities || []).forEach(activity => {
    if (activity.materialId && ids.has(activity.materialId)) activity.materialDeleted = true;
    if (Array.isArray(activity.materialIds) && activity.materialIds.some(id => ids.has(id))) activity.materialDeleted = true;
    if (activity.undo && Array.isArray(activity.undo.materials)) {
      const before = activity.undo.materials.length;
      activity.undo.materials = activity.undo.materials.filter(snapshot => !ids.has(snapshot.id));
      if (activity.undo.materials.length !== before) {
        undoCleaned += before - activity.undo.materials.length;
        if (!activity.undo.materials.length) activity.undo.used = true;
      }
    }
  });
  return { ordersRemoved: beforeOrders - db.orders.length, inventoriesTouched, undoCleaned };
}

function backupDirPath() {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeBackupName(name) {
  const clean = path.basename(String(name || ''));
  return /^backup-[0-9TZ.-]+\.json$/.test(clean) ? clean : '';
}

function listBackups() {
  const dir = backupDirPath();
  return fs.readdirSync(dir)
    .filter(file => /^backup-[0-9TZ.-]+\.json$/.test(file))
    .map(file => {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      return { file, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 30);
}

function createBackup(label = '') {
  const dir = backupDirPath();
  const stamp = new Date().toISOString().replace(/[:]/g, '-');
  const file = `backup-${stamp}.json`;
  const backup = { meta: { appName: APP_NAME, version: PROGRAM_VERSION, createdAt: nowIso(), label: cleanText(label, '') }, data: db };
  fs.writeFileSync(path.join(dir, file), JSON.stringify(backup, null, 2));
  return listBackups().find(b => b.file === file) || { file, createdAt: nowIso(), size: 0 };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function materialsToCsv(materials) {
  const header = ['Material','Stärke','Größe','Regal','Tafeln','Pakete','Mindestbestand','Bereich','Resttafel','Paketnummern','Archiviert'];
  const rows = materials.map(m => [
    m.name, m.thickness, m.format, m.shelf,
    m.storage === 'KONSI' ? 0 : (Number(m.sheetStock ?? m.stock) || 0),
    m.storage === 'KONSI' ? (Number(m.stock) || 0) : (Number(m.packageStock) || 0),
    m.minStock, m.storage, m.rest ? 'ja' : 'nein', normalizePackageNumbers(m.packageNumbers).join(','), m.archived ? 'ja' : 'nein'
  ]);
  return [header, ...rows].map(row => row.map(csvEscape).join(';')).join('\n');
}

function detectImportDelimiter(text) {
  const line = String(text || '').split(/\r?\n/).find(row => row.trim()) || '';
  const tabs = (line.match(/\t/g) || []).length;
  const semis = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  if (tabs >= semis && tabs >= commas && tabs > 0) return '\t';
  if (semis >= commas && semis > 0) return ';';
  if (commas > 0) return ',';
  return ';';
}

function parseCsvRows(csvText) {
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  const delimiter = detectImportDelimiter(text);
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { cell += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      row.push(cell.trim()); cell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

function normalizeImportHeaderKey(value) {
  const key = cleanText(value)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');
  const map = {
    material: 'material', name: 'material', bezeichnung: 'material', werkstoff: 'material', materialname: 'material',
    materialid: 'materialid', matid: 'materialid', id: 'materialid', nummer: 'materialid', nr: 'materialid', materialnummer: 'materialid',
    staerke: 'staerke', starkemm: 'staerke', staerkemm: 'staerke', dicke: 'staerke', dickemm: 'staerke', t: 'staerke', tmm: 'staerke',
    groesse: 'groesse', grosse: 'groesse', format: 'groesse', abmessung: 'groesse', abmessungen: 'groesse', abmass: 'groesse', abmasse: 'groesse', abmassx: 'abmassx', abmasx: 'abmassx', abmessungx: 'abmassx', abmessx: 'abmassx', x: 'abmassx', abmassy: 'abmassy', abmasy: 'abmassy', abmessungy: 'abmassy', abmessy: 'abmassy', y: 'abmassy',
    regal: 'regal', lagerplatz: 'regal', platz: 'regal', ablage: 'regal', standort: 'regal',
    tafeln: 'tafeln', tafel: 'tafeln', menge: 'tafeln', bestand: 'tafeln', anzahl: 'tafeln', stueck: 'tafeln',
    pakete: 'pakete', paket: 'pakete', paketmenge: 'pakete',
    mindestbestand: 'mindestbestand', min: 'mindestbestand', minimum: 'mindestbestand', minbestand: 'mindestbestand',
    bereich: 'bereich', lagerbereich: 'bereich', lager: 'bereich', storage: 'bereich',
    resttafel: 'resttafel', rest: 'resttafel', restmaterial: 'resttafel',
    paketnummern: 'paketnummern', paketnummer: 'paketnummern', paketnr: 'paketnummern', nummern: 'paketnummern'
  };
  return map[key] || key;
}



function cleanDimensionPart(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  let only = raw.replace(/\s+/g, '').replace(/mm$/i, '').replace(/[^0-9,.-]/g, '');
  if (!only) return '';
  if (only.includes('.') && only.includes(',')) {
    // Deutsche Schreibweise aus Google Sheets: 4.000,00 -> 4000
    only = only.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(only)) {
    only = only.replace(/\./g, '');
  } else if (/^\d{1,3}(,\d{3})+$/.test(only)) {
    only = only.replace(/,/g, '');
  } else {
    only = only.replace(',', '.');
  }
  const numeric = Number(only);
  if (Number.isFinite(numeric) && numeric > 0) return String(Math.round(numeric));
  const digits = raw.replace(/\D/g, '');
  return digits || '';
}

function isShelfLikeImportValue(value) {
  const text = cleanText(value).toLowerCase();
  return /^regal\s*\d+$/i.test(text) || ['carport','bodenhaltung','garage'].includes(text);
}

function looksLikeBueroImportRow(row) {
  if (!Array.isArray(row) || row.length < 7) return false;
  return isShelfLikeImportValue(row[0]) || (!!cleanDimensionPart(row[5]) && !!cleanDimensionPart(row[6]));
}

function normalizeFormatFromImportedValues(formatValue, xValue, yValue) {
  const x = cleanDimensionPart(xValue);
  const y = cleanDimensionPart(yValue);
  if (x && y) return `${x}x${y}`;
  const formatRaw = cleanText(formatValue);
  const dimension = formatRaw.match(/(\d{3,5})\s*[x×*]\s*(\d{3,5})/i);
  if (dimension) return `${dimension[1]}x${dimension[2]}`;
  const known = ['4000x2000','3000x1500','2500x1250','2000x1000'];
  const normalized = formatRaw.toLowerCase().replace(/\s+/g, '').replace('×', 'x').replace('*', 'x');
  if (known.includes(normalized)) return normalized;
  return '3000x1500';
}

function materialFromImport(row, headerMap = null, index = 0, fallbackMode = 'standard') {
  const bueroFallbackMap = { regal: 0, material: 1, staerke: 2, groesse: 3, tafeln: 4, abmassx: 5, abmassy: 6 };
  const konsiFallbackMap = { materialid: 0, paketnummern: 0, paketnummer: 0, nummern: 0, material: 1, groesse: 2, staerke: 3 };
  const defaultFallbackMap = { material: 0, staerke: 1, groesse: 2, regal: 3, tafeln: 4, pakete: 5, mindestbestand: 6, bereich: 7, resttafel: 8, paketnummern: 9, materialid: 9 };
  const get = (names, fallbackIndex = -1) => {
    const list = Array.isArray(names) ? names : [names];
    if (headerMap) {
      for (const name of list) {
        const key = normalizeImportHeaderKey(name);
        if (headerMap[key] !== undefined) return row[headerMap[key]] || '';
      }
      return '';
    }
    for (const name of list) {
      const key = normalizeImportHeaderKey(name);
      const mappedIndex = fallbackMode === 'buero' ? bueroFallbackMap[key] : (fallbackMode === 'konsi' ? konsiFallbackMap[key] : defaultFallbackMap[key]);
      // Büro-Format hat nur: Regal, Material, t=, Format, Menge, Abmass X, Abmass Y.
      // Konsi-Tabellen haben nur: Material ID, Material, Format, Stärke.
      // Nicht gemappte Werte dürfen hier nicht auf andere Spalten zurückfallen,
      // sonst entstehen z. B. aus 4000/2000 versehentlich Pakete.
      if ((fallbackMode === 'buero' || fallbackMode === 'konsi') && mappedIndex === undefined) return '';
      if (mappedIndex !== undefined) return row[mappedIndex] || '';
    }
    return fallbackIndex >= 0 ? (row[fallbackIndex] || '') : '';
  };

  if (fallbackMode === 'konsi') {
    const materialId = cleanText(get(['materialid','paketnummern','paketnummer','nummern'], 0));
    const name = get(['material','name','bezeichnung','werkstoff'], 1) || `Konsi ${index + 1}`;
    return materialPayload({
      name,
      thickness: get(['staerke','stärke','dicke'], 3),
      format: normalizeFormatFromImportedValues(get(['groesse','größe','format','abmessung'], 2), '', ''),
      shelf: KONSI_LOCATION,
      sheetStock: 0,
      packageStock: 0,
      stock: materialId ? 1 : 0,
      packageNumbers: materialId ? [materialId] : [],
      minStock: DEFAULT_MATERIAL_MIN_STOCK,
      storage: 'KONSI',
      rest: false,
      type: 'Tafel',
      unit: 'Pakete'
    });
  }

  const storageText = cleanText(get(['bereich','lagerbereich','lager','storage'], 7), 'HAUPTLAGER').toUpperCase();
  const storage = storageText.includes('KONSI') ? 'KONSI' : 'HAUPTLAGER';
  const packageNumbers = normalizePackageNumbers(get(['paketnummern','paketnummer','nummern'], 9));
  // Bei normalem Material wird ausschließlich die Spalte „Menge“ als Tafeln übernommen.
  // Format/Abmass-Zahlen werden nur für die Größe benutzt und nie als Pakete.
  const packages = storage === 'KONSI' ? Math.max(0, numberOr(get(['pakete','paket'], 5), packageNumbers.length)) : 0;
  const sheets = storage === 'KONSI' ? 0 : Math.max(0, numberOr(get(['tafeln','menge','bestand','anzahl'], 4), 0));
  const restText = cleanText(get(['resttafel','rest','restmaterial'], 8)).toLowerCase();
  const rest = ['ja','j','true','1','x','yes'].includes(restText);
  const shelf = storage === 'KONSI' ? KONSI_LOCATION : (get(['regal','lagerplatz','platz','ablage','standort'], 3) || 'Regal 1');
  return materialPayload({
    name: get(['material','name','bezeichnung','werkstoff'], 0) || `Import ${index + 1}`,
    thickness: get(['staerke','stärke','dicke'], 1),
    format: normalizeFormatFromImportedValues(get(['groesse','größe','format','abmessung'], 2), get(['abmassx','abmaß x','abmass x','abmessung x','x'], 5), get(['abmassy','abmaß y','abmass y','abmessung y','y'], 6)),
    shelf,
    sheetStock: storage === 'KONSI' ? 0 : sheets,
    packageStock: storage === 'KONSI' ? 0 : 0,
    stock: storage === 'KONSI' ? (packageNumbers.length || packages) : sheets,
    packageNumbers: storage === 'KONSI' ? packageNumbers : [],
    minStock: rest ? 0 : DEFAULT_MATERIAL_MIN_STOCK,
    storage,
    rest,
    type: rest ? 'Resttafel' : 'Tafel',
    unit: storage === 'KONSI' ? 'Pakete' : 'Tafeln'
  });
}

function importMaterialsFromText(tableText, user, options = {}) {
  const rows = parseCsvRows(tableText || '');
  if (!rows.length) throw new Error('Keine Tabellen-Zeilen gefunden.');
  const first = rows[0].map(normalizeImportHeaderKey);
  const knownHeaders = ['material','materialid','staerke','groesse','regal','tafeln','pakete','mindestbestand','bereich','resttafel','paketnummern','abmassx','abmassy'];
  const hasHeader = first.some(v => knownHeaders.includes(v));
  const headerMap = hasHeader ? first.reduce((acc, value, index) => { acc[value] = index; return acc; }, {}) : null;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const importMode = cleanText(options.mode || '').toUpperCase();
  const forceKonsiSimple = importMode === 'KONSI' || importMode === 'KONSI_SIMPLE';
  const fallbackMode = forceKonsiSimple ? 'konsi' : (!hasHeader && dataRows.some(looksLikeBueroImportRow) ? 'buero' : 'standard');
  const created = [];
  const merged = [];
  dataRows.forEach((row, index) => {
    if (!row.some(v => cleanText(v))) return;
    const material = materialFromImport(row, headerMap, index, fallbackMode);
    if (fallbackMode === 'konsi' && !normalizePackageNumbers(material.packageNumbers).length) throw new Error(`Zeile ${index + 1}: Material ID fehlt.`);
    const duplicate = findDuplicateMaterial(material);
    if (duplicate) {
      mergeMaterialQuantities(duplicate, material);
      merged.push(duplicate);
    } else {
      db.materials.unshift(material);
      created.push(material);
    }
  });
  if (!created.length && !merged.length) throw new Error('Keine gültigen Material-Zeilen gefunden.');
  const activity = addActivity('IMPORT', `${user.name} hat ${created.length} Materialposition(en) aus einer Tabelle importiert und ${merged.length} Dublette(n) zusammengeführt.`, user, { materialIds: [...created, ...merged].map(m => m.id) });
  saveDb();
  return { created, merged, activity };
}


function inventorySchedule(rawSettings = db.settings || {}) {
  const settings = normalizeSettings(rawSettings || {});
  const nextDate = addMonthsToDateOnly(settings.inventoryLastDate, settings.inventoryIntervalMonths);
  const daysUntil = daysUntilDateOnly(nextDate);
  return {
    lastDate: settings.inventoryLastDate,
    intervalMonths: settings.inventoryIntervalMonths,
    nextDate,
    daysUntil,
    due: daysUntil <= 0,
    overdue: daysUntil < 0,
    updatedAt: settings.updatedAt
  };
}

function systemStatus() {
  return {
    appName: APP_NAME,
    version: PROGRAM_VERSION,
    dataDir,
    dbFile,
    materials: db.materials.filter(m => !m.archived).length,
    archivedMaterials: db.materials.filter(m => m.archived).length,
    users: db.users.length,
    activeUsers: db.users.filter(u => u.active !== false).length,
    activities: db.activities.length,
    backups: listBackups().length,
    serverMode: SERVER_MODE,
    port: PORT,
    localUrl: `http://localhost:${PORT}`,
    externalUrl: cleanText(process.env.RENDER_EXTERNAL_URL || ''),
    storage: pgPool ? 'postgres' : 'file',
    networkIps: networkAddresses(),
    networkUrls: networkUrls(),
    serverTime: nowIso()
  };
}

function buildState(user) {
  const materials = visibleMaterials();
  const lowMaterials = materials.filter(isMaterialLow);
  const activeOrders = db.orders.filter(o => o.status !== 'ERLEDIGT' && o.status !== 'ABGELEHNT');
  return {
    appName: APP_NAME,
    version: PROGRAM_VERSION,
    serverMode: SERVER_MODE,
    serverUrl: cleanText(process.env.RENDER_EXTERNAL_URL || '') || `http://localhost:${PORT}`,
    storage: pgPool ? 'postgres' : 'file',
    dbVersion: db.version || null,
    user: publicUser(user),
    roleLabel: roleLabel(user.role),
    serverTime: nowIso(),
    materials,
    shelfOptions: ALLOWED_SHELVES,
    konsiLocation: KONSI_LOCATION,
    lowMaterials,
    orders: db.orders,
    activeOrders,
    inventories: user.role === 'ADMIN' ? [] : (db.inventories || []),
    activities: db.activities,
    users: user.role === 'ADMIN' ? db.users.map(publicManagedUser) : [],
    roleOptions: user.role === 'ADMIN' ? ALLOWED_ROLES : [],
    settings: user.role === 'ADMIN' ? normalizeSettings(db.settings || {}) : null,
    inventorySchedule: inventorySchedule(db.settings || {}),
    archivedMaterials: user.role === 'ADMIN' ? db.materials.filter(m => m.archived) : [],
    backups: user.role === 'ADMIN' ? listBackups() : [],
    systemStatus: user.role === 'ADMIN' ? systemStatus() : null,
    permissions: {
      canRequestOrder: ['LASER', 'BUERO', 'CHEF'].includes(user.role),
      canApproveOrder: false,
      canMarkOrdered: ['BUERO', 'CHEF'].includes(user.role),
      canReceiveDelivery: ['LASER', 'BUERO', 'CHEF', 'ADMIN'].includes(user.role),
      canCreateMaterial: ['BUERO', 'CHEF', 'ADMIN'].includes(user.role),
      canEditMaterial: user.role === 'ADMIN',
      canCorrectMaterial: user.role === 'ADMIN',
      canDeleteMaterial: ['CHEF', 'ADMIN'].includes(user.role),
      canDeleteNonOrderMaterial: ['LASER', 'ADMIN'].includes(user.role),
      canAdjustStock: ['LASER', 'BUERO', 'CHEF', 'ADMIN'].includes(user.role),
      canInventory: ['LASER', 'BUERO', 'CHEF'].includes(user.role),
      canSeeAdmin: ['CHEF', 'ADMIN'].includes(user.role),
      canManageUsers: user.role === 'ADMIN',
      canManageSystem: user.role === 'ADMIN',
      canExportMaterials: ['BUERO', 'CHEF', 'ADMIN'].includes(user.role)
    }
  };
}

function emitToAll(event, payload) {
  io.emit(event, payload);
}

function materialPayload(body, existing = {}) {
  const rest = Boolean(body.rest);
  const material = normalizeMaterial({
    ...existing,
    name: body.name,
    category: body.category,
    type: body.type,
    thickness: body.thickness,
    format: body.format,
    unit: body.unit,
    stock: body.stock,
    packageStock: body.packageStock,
    sheetStock: body.sheetStock,
    packageNumbers: body.packageNumbers,
    minStock: rest ? 0 : DEFAULT_MATERIAL_MIN_STOCK,
    storage: body.storage,
    shelf: body.shelf,
    compartment: body.compartment,
    supplier: body.supplier,
    articleNumber: body.articleNumber,
    rest,
    note: body.note,
    deliveryPending: existing.deliveryPending || false,
    deliveryStatus: existing.deliveryStatus || '',
    deliveredAt: existing.deliveredAt || null,
    deliveredBy: existing.deliveredBy || '',
    deliveredFromOrderId: existing.deliveredFromOrderId || '',
    lastPackageWeightKg: existing.lastPackageWeightKg ?? null,
    archived: existing.archived || false,
    createdAt: existing.createdAt || nowIso(),
    updatedAt: nowIso(),
    id: existing.id || uid('m')
  });
  if (material.storage !== 'KONSI') material.stock = Math.max(0, numberOr(material.packageStock, 0) + numberOr(material.sheetStock, 0));
  if (!material.name) throw new Error('Materialname fehlt.');
  if (!Number.isFinite(material.stock) || material.stock < 0) throw new Error('Bestand ist ungültig.');
  if (!Number.isFinite(material.packageStock) || material.packageStock < 0) throw new Error('Paket-Angabe ist ungültig.');
  if (!Number.isFinite(material.sheetStock) || material.sheetStock < 0) throw new Error('Tafel-Angabe ist ungültig.');
  if (!material.rest && (!Number.isFinite(material.minStock) || material.minStock < 0)) throw new Error('Mindestbestand ist ungültig.');
  return material;
}

app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  // Damit nach einer neuen Version nicht versehentlich alte app.js/styles.css aus dem Cache geladen werden.
  res.setHeader('X-Eckl-App-Version', PROGRAM_VERSION);
  if (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.get('/api/version', (_req, res) => res.json({ appName: APP_NAME, version: PROGRAM_VERSION, serverMode: SERVER_MODE, port: PORT, localUrl: `http://localhost:${PORT}`, externalUrl: cleanText(process.env.RENDER_EXTERNAL_URL || ''), storage: pgPool ? 'postgres' : 'file', networkUrls: networkUrls() }));
app.get('/api/server-info', (_req, res) => res.json({ ok: true, appName: APP_NAME, version: PROGRAM_VERSION, serverMode: SERVER_MODE, port: PORT, localUrl: `http://localhost:${PORT}`, externalUrl: cleanText(process.env.RENDER_EXTERNAL_URL || ''), storage: pgPool ? 'postgres' : 'file', networkIps: networkAddresses(), networkUrls: networkUrls(), serverTime: nowIso() }));

function renderDiagnosticHtml() {
  const files = fs.existsSync(publicDir) ? fs.readdirSync(publicDir).sort().join(', ') : 'public-Ordner fehlt';
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eckl Materialverwaltung · Render Diagnose</title>
<style>body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f4f4f4;color:#111}.box{max-width:900px;margin:40px auto;background:#fff;border-left:6px solid #e4002b;padding:24px;box-shadow:0 8px 20px rgba(0,0,0,.12)}code{background:#eee;padding:2px 6px}.head{background:linear-gradient(180deg,#2f2f2f,#151515);color:#fff;border-bottom:4px solid #e4002b;padding:18px;margin:-24px -24px 20px}</style>
</head><body><div class="box"><div class="head"><h1>Eckl Materialverwaltung</h1></div>
<h2>Render-Dateien nicht vollständig gefunden</h2>
<p>Der Server läuft, aber <code>public/index.html</code> wurde im Render-Repository nicht gefunden.</p>
<p><strong>Version:</strong> ${PROGRAM_VERSION}</p>
<p><strong>Gesuchter Ordner:</strong> <code>${publicDir}</code></p>
<p><strong>Gefundene Dateien:</strong> ${files}</p>
<p>Bitte in GitHub prüfen: Im Repository müssen direkt <code>package.json</code>, <code>server.js</code> und der Ordner <code>public</code> sichtbar sein. Nicht nur die ZIP und nicht ein zusätzlicher Unterordner.</p>
<p>Teste außerdem <code>/debug/render</code>.</p>
</div></body></html>`;
}

function sendFrontend(_req, res) {
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  res.status(200).send(renderDiagnosticHtml());
}

app.get('/', sendFrontend);
app.get('/index.html', sendFrontend);
app.get('/login', sendFrontend);
app.get('/app', sendFrontend);
app.get('/material', sendFrontend);

app.get('/debug/public', (_req, res) => {
  const files = fs.existsSync(publicDir) ? fs.readdirSync(publicDir).sort() : [];
  res.json({ ok: true, version: PROGRAM_VERSION, root, publicDir, indexFile, indexExists: fs.existsSync(indexFile), files });
});

app.get('/debug/render', (_req, res) => {
  const rootFiles = fs.readdirSync(root).sort();
  const publicFiles = fs.existsSync(publicDir) ? fs.readdirSync(publicDir).sort() : [];
  res.json({
    ok: true,
    version: PROGRAM_VERSION,
    node: process.version,
    cwd: process.cwd(),
    root,
    rootFiles,
    publicDir,
    publicExists: fs.existsSync(publicDir),
    indexFile,
    indexExists: fs.existsSync(indexFile),
    publicFiles,
    render: Boolean(process.env.RENDER),
    storage: pgPool ? 'postgres' : 'file'
  });
});

app.use(express.static(publicDir));

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.users.find(u => u.active !== false && u.username.toLowerCase() === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Benutzername oder Passwort ist falsch.' });
  const token = crypto.randomBytes(24).toString('hex');
  user.lastLogin = nowIso();
  db.sessions[token] = { userId: user.id, createdAt: nowIso() };
  addActivity('LOGIN', `${user.name} hat sich als ${roleLabel(user.role)} angemeldet.`, user);
  saveDb();
  res.json({ token, user: publicUser(user), state: buildState(user) });
});

app.post('/api/logout', requireAuth, (req, res) => {
  delete db.sessions[req.token];
  addActivity('LOGOUT', `${req.user.name} hat sich abgemeldet.`, req.user);
  saveDb();
  res.json({ ok: true });
});

app.get('/api/state', requireAuth, (req, res) => {
  res.json(buildState(req.user));
});

app.get('/api/materials/:id/history', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF', 'ADMIN'), (req, res) => {
  const material = db.materials.find(m => m.id === req.params.id);
  if (!material) return res.status(404).json({ error: 'Material wurde nicht gefunden.' });
  const entries = (db.activities || []).filter(a => materialHistoryMatches(a, material)).slice(0, 80).map(a => ({
    id: a.id, type: a.type, text: a.text, user: a.user, role: a.role, at: a.at,
    canUndo: Boolean(a.undo && !a.undo.used && Array.isArray(a.undo.materials) && a.undo.materials.some(m => m.id === material.id)),
    undoLabel: a.undo && a.undo.label ? a.undo.label : ''
  }));
  const latestUndo = latestUndoForMaterial(material.id);
  res.json({ material, entries, latestUndo: latestUndo ? { id: latestUndo.id, text: latestUndo.text, at: latestUndo.at, user: latestUndo.user, label: latestUndo.undo && latestUndo.undo.label } : null });
});

app.post('/api/materials/:id/undo', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF', 'ADMIN'), (req, res) => {
  const activityToUndo = latestUndoForMaterial(req.params.id);
  if (!activityToUndo) return res.status(400).json({ error: 'Für dieses Material gibt es keine rückgängig machbare Buchung.' });
  const note = cleanText(req.body.note, '');
  const touchedIds = [];
  activityToUndo.undo.materials.forEach(snapshot => {
    const index = db.materials.findIndex(m => m.id === snapshot.id);
    touchedIds.push(snapshot.id);
    if (snapshot.existed && snapshot.material) {
      const restored = normalizeMaterial(snapshot.material);
      restored.id = snapshot.id;
      restored.updatedAt = nowIso();
      if (index >= 0) db.materials[index] = restored;
      else db.materials.push(restored);
    } else if (!snapshot.existed && index >= 0) {
      db.materials[index].archived = true;
      db.materials[index].stock = 0;
      db.materials[index].packageStock = 0;
      db.materials[index].sheetStock = 0;
      db.materials[index].deliveryPending = false;
      db.materials[index].updatedAt = nowIso();
    }
  });
  activityToUndo.undo.used = true;
  activityToUndo.undo.usedBy = req.user.name;
  activityToUndo.undo.usedAt = nowIso();
  const material = db.materials.find(m => m.id === req.params.id);
  const extra = note ? ` Grund: ${note}` : '';
  const activity = addActivity('KORREKTUR', `${req.user.name} hat eine Buchung rückgängig gemacht: ${activityToUndo.text}.${extra}`, req.user, { materialId: req.params.id, materialIds: touchedIds });
  saveDb();
  emitToAll('material:changed', { material, activity, message: `Buchung rückgängig gemacht: ${material ? materialTitleText(material) : 'Material'}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  emitToAll('state:changed', { reason: 'material:undo' });
  res.json({ ok: true, material, activity });
});


function userPayload(body, existing = null) {
  const username = normalizeUsername(body.username || (existing && existing.username));
  const name = cleanText(body.name || (existing && existing.name));
  const role = normalizeRole(body.role || (existing && existing.role));
  const password = String(body.password || '').trim();
  if (!username) throw new Error('Benutzername fehlt.');
  if (!/^[a-z0-9._-]{2,30}$/.test(username)) throw new Error('Benutzername darf nur Buchstaben, Zahlen, Punkt, Bindestrich oder Unterstrich enthalten.');
  if (!name) throw new Error('Profilname fehlt.');
  if (!existing && !password) throw new Error('Start-Passwort fehlt.');
  if (password && password.length < 4) throw new Error('Passwort muss mindestens 4 Zeichen haben.');
  return {
    ...(existing || {}),
    id: existing ? existing.id : uid('u'),
    username,
    name,
    role,
    password: password || (existing ? existing.password : ''),
    active: body.active === undefined ? (existing ? existing.active !== false : true) : Boolean(body.active),
    mustChangePassword: body.mustChangePassword === undefined ? (existing ? Boolean(existing.mustChangePassword) : false) : Boolean(body.mustChangePassword),
    lastLogin: existing ? (existing.lastLogin || null) : null,
    createdAt: existing ? (existing.createdAt || nowIso()) : nowIso(),
    updatedAt: nowIso()
  };
}

function countActiveAdmins(exceptId = null) {
  return db.users.filter(u => u.id !== exceptId && u.role === 'ADMIN' && u.active !== false).length;
}

app.post('/api/users', requireAuth, allowRoles('ADMIN'), (req, res) => {
  try {
    const user = userPayload(req.body);
    if (db.users.some(u => u.username === user.username)) return res.status(409).json({ error: 'Benutzername ist bereits vergeben.' });
    db.users.push(user);
    const activity = addActivity('BENUTZER', `${req.user.name} hat Benutzer angelegt: ${user.name} (${roleLabel(user.role)}).`, req.user);
    saveDb();
    emitToAll('users:changed', { user: publicManagedUser(user), activity, message: `Benutzer angelegt: ${user.name}`, targetRoles: ['ADMIN'] });
    emitToAll('state:changed', { reason: 'users:created' });
    res.status(201).json({ user: publicManagedUser(user) });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.patch('/api/users/:id', requireAuth, allowRoles('ADMIN'), (req, res) => {
  const index = db.users.findIndex(u => u.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Benutzer wurde nicht gefunden.' });
  try {
    const existing = db.users[index];
    const user = userPayload(req.body, existing);
    if (existing.id === req.user.id && (user.active === false || user.role !== 'ADMIN')) return res.status(400).json({ error: 'Der aktuell angemeldete Admin kann sich nicht selbst deaktivieren oder die Admin-Rolle entfernen.' });
    if (existing.role === 'ADMIN' && existing.active !== false && (user.role !== 'ADMIN' || user.active === false) && countActiveAdmins(existing.id) < 1) return res.status(400).json({ error: 'Mindestens ein aktiver Admin muss bestehen bleiben.' });
    if (db.users.some(u => u.id !== existing.id && u.username === user.username)) return res.status(409).json({ error: 'Benutzername ist bereits vergeben.' });
    db.users[index] = user;
    if (user.active === false) {
      Object.entries(db.sessions).forEach(([token, session]) => { if (session.userId === user.id) delete db.sessions[token]; });
    }
    const activity = addActivity('BENUTZER', `${req.user.name} hat Benutzer bearbeitet: ${user.name} (${roleLabel(user.role)}).`, req.user);
    saveDb();
    emitToAll('users:changed', { user: publicManagedUser(user), activity, message: `Benutzer bearbeitet: ${user.name}`, targetRoles: ['ADMIN'] });
    emitToAll('state:changed', { reason: 'users:updated' });
    res.json({ user: publicManagedUser(user) });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.delete('/api/users/:id', requireAuth, allowRoles('ADMIN'), (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Benutzer wurde nicht gefunden.' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Der aktuell angemeldete Admin kann sich nicht selbst deaktivieren.' });
  if (user.role === 'ADMIN' && user.active !== false && countActiveAdmins(user.id) < 1) return res.status(400).json({ error: 'Mindestens ein aktiver Admin muss bestehen bleiben.' });
  user.active = false;
  user.updatedAt = nowIso();
  Object.entries(db.sessions).forEach(([token, session]) => { if (session.userId === user.id) delete db.sessions[token]; });
  const activity = addActivity('BENUTZER', `${req.user.name} hat Benutzer deaktiviert: ${user.name}.`, req.user);
  saveDb();
  emitToAll('users:changed', { user: publicManagedUser(user), activity, message: `Benutzer deaktiviert: ${user.name}`, targetRoles: ['ADMIN'] });
  emitToAll('state:changed', { reason: 'users:deleted' });
  res.json({ ok: true, user: publicManagedUser(user) });
});

app.post('/api/materials', requireAuth, allowRoles('BUERO', 'CHEF', 'ADMIN'), (req, res) => {
  try {
    const material = materialPayload(req.body);
    const duplicate = findDuplicateMaterial(material);
    if (duplicate && !req.body.forceDuplicate && !req.body.mergeDuplicate) return duplicateResponse(res, duplicate, material);
    if (duplicate && req.body.mergeDuplicate) {
      const before = materialSnapshotById(duplicate.id);
      mergeMaterialQuantities(duplicate, material);
      const activity = addActivity('MATERIAL', `${req.user.name} hat Dublette erkannt und Menge zu ${materialTitleText(duplicate)} hinzugefügt: ${quantityText(duplicate)}.`, req.user, { materialId: duplicate.id, undo: makeUndo('DUPLIKAT_MERGE', [before], 'Dubletten-Menge rückgängig') });
      saveDb();
      emitToAll('material:updated', { material: duplicate, activity, message: `Menge zu bestehendem Material hinzugefügt: ${materialTitleText(duplicate)}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
      emitToAll('state:changed', { reason: 'material:merged' });
      return res.status(200).json({ material: duplicate, merged: true });
    }
    db.materials.unshift(material);
    const activity = addActivity('MATERIAL', `${req.user.name} hat Material angelegt: ${materialTitleText(material)}.`, req.user, { materialId: material.id, undo: makeUndo('MATERIAL_CREATE', [{ id: material.id, existed: false, material: null }], 'Materialanlage rückgängig') });
    saveDb();
    emitToAll('material:created', { material, activity, message: `Neues Material angelegt: ${materialTitleText(material)}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
    emitToAll('state:changed', { reason: 'material:created' });
    res.status(201).json({ material });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


function materialUpdateSummary(before, after) {
  const changes = [];
  const fields = [
    ['name', 'Material'],
    ['thickness', 'Stärke'],
    ['format', 'Format'],
    ['articleNumber', 'Teilenr.'],
    ['storage', 'Bereich'],
    ['shelf', 'Lagerplatz'],
    ['rest', 'Resttafel']
  ];
  fields.forEach(([key, label]) => {
    const oldValue = key === 'rest' ? (before[key] ? 'ja' : 'nein') : cleanText(before[key] || '');
    const newValue = key === 'rest' ? (after[key] ? 'ja' : 'nein') : cleanText(after[key] || '');
    if (oldValue !== newValue) changes.push(`${label}: ${oldValue || '-'} → ${newValue || '-'}`);
  });
  return changes.join('; ');
}

app.patch('/api/materials/:id', requireAuth, allowRoles('ADMIN'), (req, res) => {
  const index = db.materials.findIndex(m => m.id === req.params.id && !m.archived);
  if (index === -1) return res.status(404).json({ error: 'Material wurde nicht gefunden.' });
  try {
    const before = db.materials[index];
    const beforeSnapshot = materialSnapshotById(before.id);
    const material = materialPayload(req.body, before);
    const duplicate = findDuplicateMaterial(material, material.id);
    if (duplicate && !req.body.forceDuplicate) return duplicateResponse(res, duplicate, material);
    db.materials[index] = material;
    db.orders.forEach(order => {
      if (order.materialId === material.id) order.materialName = material.name;
    });
    const changeSummary = materialUpdateSummary(before, material);
    const correctionNote = cleanText(req.body.correctionNote || '');
    const activityText = `${req.user.name} hat Material bearbeitet: ${materialTitleText(material)}${changeSummary ? `. Änderung: ${changeSummary}` : ''}${correctionNote ? `. Grund: ${correctionNote}` : ''}.`;
    const activity = addActivity('MATERIAL', activityText, req.user, { materialId: material.id, undo: makeUndo('MATERIAL_UPDATE', [beforeSnapshot], 'Materialbearbeitung rückgängig') });
    saveDb();
    emitToAll('material:updated', { material, activity, message: `Material aktualisiert: ${materialTitleText(material)}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
    emitToAll('state:changed', { reason: 'material:updated' });
    res.json({ material });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/materials/:id/delete-non-order', requireAuth, allowRoles('LASER', 'ADMIN'), (req, res) => {
  const material = db.materials.find(m => m.id === req.params.id && !m.archived);
  if (!material) return res.status(404).json({ error: 'Material wurde nicht gefunden.' });
  const blockReason = materialDeleteBlockReason(material);
  if (blockReason) return res.status(400).json({ error: blockReason });
  const beforeSnapshot = materialSnapshotById(material.id);
  const note = cleanText(req.body.note || '');
  material.archived = true;
  material.updatedAt = nowIso();
  const activity = addActivity('MATERIAL', `${req.user.name} hat Material aus der aktiven Liste gelöscht: ${materialTitleText(material)}${note ? `. Grund: ${note}` : ''}.`, req.user, { materialId: material.id, undo: makeUndo('MATERIAL_ARCHIVE', [beforeSnapshot], 'Löschen rückgängig') });
  saveDb();
  emitToAll('material:deleted', { material, activity, message: `Material gelöscht: ${materialTitleText(material)}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  emitToAll('state:changed', { reason: 'material:delete-non-order', version: PROGRAM_VERSION });
  res.json({ ok: true, material, activity, version: PROGRAM_VERSION });
});

app.delete('/api/materials/:id', requireAuth, allowRoles('CHEF', 'ADMIN'), (req, res) => {
  const material = db.materials.find(m => m.id === req.params.id && !m.archived);
  if (!material) return res.status(404).json({ error: 'Material wurde nicht gefunden.' });
  const beforeSnapshot = materialSnapshotById(material.id);
  material.archived = true;
  material.updatedAt = nowIso();
  const activity = addActivity('MATERIAL', `${req.user.name} hat Material archiviert: ${materialTitleText(material)}.`, req.user, { materialId: material.id, undo: makeUndo('MATERIAL_ARCHIVE', [beforeSnapshot], 'Archivierung rückgängig') });
  saveDb();
  emitToAll('material:deleted', { material, activity, message: `Material archiviert: ${material.name}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  emitToAll('state:changed', { reason: 'material:deleted' });
  res.json({ ok: true, material });
});

app.post('/api/materials/:id/restore', requireAuth, allowRoles('ADMIN'), (req, res) => {
  const material = db.materials.find(m => m.id === req.params.id && m.archived);
  if (!material) return res.status(404).json({ error: 'Archiviertes Material wurde nicht gefunden.' });
  const beforeSnapshot = materialSnapshotById(material.id);
  material.archived = false;
  material.updatedAt = nowIso();
  const activity = addActivity('MATERIAL', `${req.user.name} hat Material aus dem Archiv wiederhergestellt: ${materialTitleText(material)}.`, req.user, { materialId: material.id, undo: makeUndo('MATERIAL_RESTORE', [beforeSnapshot], 'Wiederherstellung rückgängig') });
  saveDb();
  emitToAll('material:restored', { material, activity, message: `Material wiederhergestellt: ${material.name}`, targetRoles: ['ADMIN'] });
  emitToAll('state:changed', { reason: 'material:restored' });
  res.json({ ok: true, material });
});


function isOverflowShelf(shelf) {
  return ['Carport', 'Bodenhaltung'].includes(normalizeShelf(shelf));
}

function isTargetRegal(shelf) {
  return ['Regal 1', 'Regal 2', 'Regal 3', 'Regal 4', 'Regal 5', 'Regal 6'].includes(normalizeShelf(shelf));
}

function materialMoveKey(material, targetShelf) {
  return [
    cleanText(material.name).toLowerCase(),
    normalizeThickness(material.thickness).toLowerCase(),
    normalizeFormat(material.format),
    normalizeShelf(targetShelf),
    material.rest ? 'REST' : 'NORMAL'
  ].join('|');
}

app.post('/api/materials/:id/move', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF', 'ADMIN'), (req, res) => {
  const material = db.materials.find(m => m.id === req.params.id && !m.archived);
  if (!material) return res.status(404).json({ error: 'Material wurde nicht gefunden.' });
  if (material.storage === 'KONSI') return res.status(400).json({ error: 'Konsi-Material wird über Paket-Entnahme bewegt.' });
  if (!isOverflowShelf(material.shelf)) return res.status(400).json({ error: 'Verräumen ist nur von Carport oder Bodenhaltung möglich.' });

  const qty = Math.floor(Number(req.body.qty));
  const targetShelf = normalizeShelf(req.body.targetShelf);
  const note = cleanText(req.body.note, '');
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Bitte eine gültige Tafel-Anzahl eingeben.' });
  if (!isTargetRegal(targetShelf)) return res.status(400).json({ error: 'Bitte Regal 1 bis Regal 6 als Ziel auswählen.' });

  const beforeSourceSnapshot = materialSnapshotById(material.id);
  const beforeSourceSheets = Math.max(0, numberOr(material.sheetStock, numberOr(material.stock, 0)));
  const beforeSourcePackages = Math.max(0, numberOr(material.packageStock, 0));
  if (qty > beforeSourceSheets) return res.status(400).json({ error: `Es sind nur ${beforeSourceSheets} Tafeln verfügbar.` });

  const sourceShelf = normalizeShelf(material.shelf);
  const sourceBeforeText = quantityText(material);
  const targetKey = materialMoveKey(material, targetShelf);
  let target = db.materials.find(m => !m.archived && m.id !== material.id && m.storage !== 'KONSI' && materialMoveKey(m, m.shelf) === targetKey);
  const beforeTargetSnapshot = target ? materialSnapshotById(target.id) : null;

  if (!target) {
    target = normalizeMaterial({
      ...material,
      id: uid('m'),
      shelf: targetShelf,
      stock: qty,
      packageStock: 0,
      sheetStock: qty,
      packageNumbers: [],
      deliveryPending: false,
      deliveryStatus: '',
      deliveredAt: null,
      deliveredBy: '',
      deliveredFromOrderId: '',
      lastPackageWeightKg: null,
      archived: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      note: material.note
    });
    target.stock = qty;
    target.packageStock = 0;
    target.sheetStock = qty;
    target.deliveryPending = false;
    target.deliveryStatus = '';
    target.deliveredAt = null;
    target.deliveredBy = '';
    target.deliveredFromOrderId = '';
    target.lastPackageWeightKg = null;
    db.materials.push(target);
  } else {
    const targetSheets = Math.max(0, numberOr(target.sheetStock, numberOr(target.stock, 0)));
    target.sheetStock = targetSheets + qty;
    target.stock = Math.max(0, numberOr(target.packageStock, 0)) + target.sheetStock;
    target.deliveryPending = false;
    target.deliveryStatus = '';
    target.deliveredAt = null;
    target.deliveredBy = '';
    target.deliveredFromOrderId = '';
    target.lastPackageWeightKg = null;
    target.updatedAt = nowIso();
  }

  material.sheetStock = Math.max(0, beforeSourceSheets - qty);
  material.stock = beforeSourcePackages + material.sheetStock;
  material.updatedAt = nowIso();
  const sourceEmpty = material.stock <= 0;
  if (sourceEmpty) material.archived = true;

  const extra = note ? ` Hinweis: ${note}` : '';
  const deletedText = sourceEmpty ? ' Die ursprüngliche Position wurde entfernt, weil dort keine Tafeln mehr liegen.' : '';
  const targetSnapshot = beforeTargetSnapshot || { id: target.id, existed: false, material: null };
  const activity = addActivity('BESTAND', `${req.user.name} hat ${qty} Tafel(n) ${materialTitleText(material)} von ${sourceShelf} nach ${targetShelf} verräumt.${deletedText}${extra}`, req.user, { materialId: material.id, materialIds: [material.id, target.id], undo: makeUndo('MATERIAL_MOVE', [beforeSourceSnapshot, targetSnapshot], 'Verräumen rückgängig') });
  saveDb();
  emitToAll('material:changed', { material: target, activity, message: `${qty} Tafel(n) verräumt: ${sourceShelf} → ${targetShelf}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  emitToAll('state:changed', { reason: 'material:move' });
  res.json({ source: material, target, sourceBefore: sourceBeforeText, sourceAfter: quantityText(material) });
});

app.post('/api/materials/:id/stock', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF', 'ADMIN'), (req, res) => {
  const material = db.materials.find(m => m.id === req.params.id && !m.archived);
  if (!material) return res.status(404).json({ error: 'Material wurde nicht gefunden.' });
  const action = String(req.body.action || 'REMOVE').toUpperCase();
  const qty = Number(req.body.qty);
  const note = cleanText(req.body.note, '');
  const packageNumber = cleanText(req.body.packageNumber, '');
  const targetShelf = normalizeShelf(req.body.targetShelf);
  if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ error: 'Bitte eine gültige Menge eingeben.' });
  if (req.user.role === 'LASER' && !['REMOVE', 'SET'].includes(action)) return res.status(403).json({ error: 'Laser darf nur Entnahmen oder Korrekturen speichern.' });

  const beforeSnapshot = materialSnapshotById(material.id);
  const beforeStock = Number(material.stock) || 0;
  const isKonsi = material.storage === 'KONSI';

  if (isKonsi && action === 'REMOVE') {
    material.packageNumbers = normalizePackageNumbers(material.packageNumbers);
    if (!packageNumber) return res.status(400).json({ error: 'Bitte eine Konsi-Paketnummer auswählen.' });
    const packageIndex = material.packageNumbers.indexOf(packageNumber);
    if (packageIndex < 0) return res.status(400).json({ error: 'Diese Paketnummer ist beim Material nicht hinterlegt oder wurde bereits entnommen.' });
    // Bei doppelt vorhandenen Paketnummern nur genau ein Paket entfernen.
    material.packageNumbers.splice(packageIndex, 1);
    material.stock = material.packageNumbers.length;
    material.sheetStock = 0;
  } else if (action === 'REMOVE') {
    const beforeSheets = Number(material.sheetStock ?? material.stock) || 0;
    material.sheetStock = Math.max(0, beforeSheets - qty);
    material.stock = (Number(material.packageStock) || 0) + material.sheetStock;
  } else if (action === 'ADD') {
    const beforeSheets = Number(material.sheetStock ?? material.stock) || 0;
    material.sheetStock = beforeSheets + qty;
    material.stock = (Number(material.packageStock) || 0) + material.sheetStock;
  } else if (action === 'SET') {
    material.packageStock = 0;
    material.sheetStock = qty;
    material.stock = qty;
  } else return res.status(400).json({ error: 'Unbekannte Bestandsaktion.' });

  material.updatedAt = nowIso();
  const actionText = action === 'REMOVE' ? 'entnommen' : action === 'ADD' ? 'zugebucht' : 'Bestand korrigiert';
  const beforeText = isKonsi ? `${beforeStock} Pakete` : `${beforeStock} ${material.unit || 'Tafeln'}`;
  const afterText = quantityText(material);
  const targetText = isKonsi && action === 'REMOVE' ? ` Paketnummer: ${packageNumber}. Ziel: ${targetShelf || '-'}.` : '';
  const extra = note ? ` Hinweis: ${note}` : '';
  const activityType = action === 'SET' ? 'KORREKTUR' : 'BESTAND';
  const undoLabel = action === 'SET' ? 'Korrektur rückgängig' : 'Bestandsbuchung rückgängig';
  const activity = addActivity(activityType, `${req.user.name} hat ${materialTitleText(material)}: ${actionText} (${beforeText} → ${afterText}).${targetText}${extra}`, req.user, { materialId: material.id, undo: makeUndo('MATERIAL_STOCK', [beforeSnapshot], undoLabel) });
  saveDb();
  emitToAll('material:changed', { material, activity, message: `${material.name}: ${beforeText} → ${afterText}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  if (isMaterialLow(material)) {
    emitToAll('stock:low', { material, message: `Mindestbestand erreicht: ${material.name}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  }
  emitToAll('state:changed', { reason: 'material:stock' });
  res.json({ material });
});

app.post('/api/materials/:id/remove', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF', 'ADMIN'), (req, res) => {
  const material = db.materials.find(m => m.id === req.params.id && !m.archived);
  if (!material) return res.status(404).json({ error: 'Material wurde nicht gefunden.' });
  const qty = Number(req.body.qty || 0);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Bitte eine gültige Menge eingeben.' });
  const beforeSnapshot = materialSnapshotById(material.id);
  const before = Number(material.stock);
  material.stock = Math.max(0, before - qty);
  material.updatedAt = nowIso();
  const activity = addActivity('BESTAND', `${req.user.name} hat ${materialTitleText(material)}: entnommen (${before} → ${material.stock}).`, req.user, { materialId: material.id, undo: makeUndo('MATERIAL_REMOVE', [beforeSnapshot], 'Entnahme rückgängig') });
  saveDb();
  emitToAll('material:changed', { material, activity, message: `${material.name}: Bestand ${before} → ${material.stock}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  if (isMaterialLow(material)) {
    emitToAll('stock:low', { material, message: `Mindestbestand erreicht: ${material.name}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  }
  emitToAll('state:changed', { reason: 'material:remove' });
  res.json({ material });
});


function inventoryMaterialItems(area) {
  if (area === 'KONSI') {
    return visibleMaterials()
      .filter(m => m.storage === 'KONSI')
      .flatMap(m => normalizePackageNumbers(m.packageNumbers).map(packageNumber => ({
        id: uid('invi'),
        materialId: m.id,
        materialName: m.name,
        title: materialTitleText(m),
        thickness: m.thickness || '',
        format: m.format || '',
        shelf: m.shelf || '',
        packageNumber,
        expectedPresent: true,
        present: null,
        note: ''
      })));
  }
  return visibleMaterials()
    .filter(m => m.storage !== 'KONSI' && normalizeShelf(m.shelf) === area)
    .map(m => ({
      id: uid('invi'),
      materialId: m.id,
      materialName: m.name,
      title: materialTitleText(m),
      thickness: m.thickness || '',
      format: m.format || '',
      shelf: m.shelf || '',
      expectedPackages: Math.max(0, numberOr(m.packageStock, 0)),
      expectedSheets: Math.max(0, numberOr(m.sheetStock, numberOr(m.stock, 0))),
      countedPackages: null,
      countedSheets: null,
      note: ''
    }));
}

app.post('/api/inventories', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF'), (req, res) => {
  const rawArea = cleanText(req.body.area, 'Regal 1');
  const area = rawArea === 'KONSI' ? 'KONSI' : normalizeShelf(rawArea);
  db.inventories = db.inventories || [];
  const existingActive = db.inventories.find(session => session.area === area && session.status !== 'ABGESCHLOSSEN' && session.status !== 'ABGEBROCHEN');
  if (existingActive) {
    return res.status(409).json({ error: `Für ${inventoryAreaLabel(area)} läuft bereits eine Inventur. Bitte diese weiterführen oder abbrechen.`, session: existingActive });
  }
  const items = inventoryMaterialItems(area);
  if (!items.length) return res.status(400).json({ error: 'Für diesen Bereich sind keine Materialien vorhanden.' });
  const cycleId = currentInventoryCycleId();
  const session = {
    id: uid('inv'),
    cycleId,
    area,
    status: 'OFFEN',
    createdBy: req.user.name,
    createdByRole: req.user.role,
    createdAt: nowIso(),
    updatedBy: req.user.name,
    updatedAt: nowIso(),
    checkedBy: '',
    checkedAt: null,
    closedBy: '',
    closedAt: null,
    items
  };
  db.inventories.unshift(session);
  const activity = addActivity('INVENTUR', `${req.user.name} hat eine Inventur für ${inventoryAreaLabel(area)} gestartet.`, req.user);
  saveDb();
  emitToAll('inventory:changed', { session, activity, message: `Inventur gestartet: ${inventoryAreaLabel(area)}`, targetRoles: ['LASER', 'BUERO', 'CHEF'] });
  emitToAll('state:changed', { reason: 'inventory:created' });
  res.status(201).json({ session });
});


app.post('/api/inventories/:id/cancel', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF'), (req, res) => {
  const session = (db.inventories || []).find(i => i.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Inventur wurde nicht gefunden.' });
  if (session.status === 'ABGESCHLOSSEN') return res.status(400).json({ error: 'Abgeschlossene Inventuren können nicht abgebrochen werden.' });
  if (session.status === 'ABGEBROCHEN') return res.status(400).json({ error: 'Diese Inventur wurde bereits abgebrochen.' });
  session.status = 'ABGEBROCHEN';
  session.canceledBy = req.user.name;
  session.canceledAt = nowIso();
  session.cancelReason = cleanText(req.body.reason, 'Vorzeitig beendet');
  session.updatedBy = req.user.name;
  session.updatedAt = session.canceledAt;
  const activity = addActivity('INVENTUR', `${req.user.name} hat die Inventur ${inventoryAreaLabel(session.area)} vorzeitig beendet.`, req.user);
  saveDb();
  emitToAll('inventory:changed', { session, activity, message: `Inventur beendet: ${inventoryAreaLabel(session.area)}`, targetRoles: ['LASER', 'BUERO', 'CHEF'] });
  emitToAll('state:changed', { reason: 'inventory:canceled' });
  res.json({ session });
});

app.get('/api/inventory-cycles/:cycleId/export/xls', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF'), (req, res) => {
  const summary = inventoryCycleSummary(req.params.cycleId);
  if (!summary.sessions.length) return res.status(404).send('Inventur wurde nicht gefunden.');
  if (!summary.complete) return res.status(400).send('Die Gesamtinventur ist noch nicht vollständig abgeschlossen.');
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${inventoryCycleExportFilename(req.params.cycleId, 'xls')}"`);
  res.send(inventoryCycleExcelHtml(req.params.cycleId));
});

app.get('/api/inventory-cycles/:cycleId/print', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF'), (req, res) => {
  const summary = inventoryCycleSummary(req.params.cycleId);
  if (!summary.sessions.length) return res.status(404).send('Inventur wurde nicht gefunden.');
  if (!summary.complete) return res.status(400).send('Die Gesamtinventur ist noch nicht vollständig abgeschlossen.');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(inventoryCyclePrintHtml(req.params.cycleId));
});

app.post('/api/inventories/:id/items', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF'), (req, res) => {
  const session = (db.inventories || []).find(i => i.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Inventur wurde nicht gefunden.' });
  if (session.status === 'ABGESCHLOSSEN') return res.status(400).json({ error: 'Diese Inventur ist bereits abgeschlossen.' });
  if (!['Carport', 'Bodenhaltung'].includes(normalizeShelf(session.area))) return res.status(400).json({ error: 'Zusatzmaterial kann nur bei Carport oder Bodenhaltung eingefügt werden.' });

  const name = cleanText(req.body.name);
  if (!name) return res.status(400).json({ error: 'Bitte Materialname eingeben.' });
  const packages = Math.max(0, numberOr(req.body.countedPackages, 0));
  const sheets = Math.max(0, numberOr(req.body.countedSheets, 0));
  if (packages + sheets <= 0) return res.status(400).json({ error: 'Bitte gezählte Pakete oder Tafeln eingeben.' });

  const item = {
    id: uid('invi'),
    materialId: '',
    materialName: name,
    title: materialTitleText({ name, thickness: req.body.thickness }),
    thickness: normalizeThickness(req.body.thickness),
    format: normalizeFormat(req.body.format),
    shelf: normalizeShelf(session.area),
    expectedPackages: 0,
    expectedSheets: 0,
    countedPackages: packages,
    countedSheets: sheets,
    note: cleanText(req.body.note, ''),
    extraMaterial: true,
    rest: Boolean(req.body.rest)
  };
  session.items = Array.isArray(session.items) ? session.items : [];
  session.items.push(item);
  session.status = 'IN_BEARBEITUNG';
  session.updatedBy = req.user.name;
  session.updatedAt = nowIso();
  const activity = addActivity('INVENTUR', `${req.user.name} hat Zusatzmaterial zur Inventur ${inventoryAreaLabel(session.area)} hinzugefügt: ${item.title}.`, req.user);
  saveDb();
  emitToAll('inventory:changed', { session, activity, message: `Zusatzmaterial eingefügt: ${item.title}`, targetRoles: ['LASER', 'BUERO', 'CHEF'] });
  emitToAll('state:changed', { reason: 'inventory:item-added' });
  res.status(201).json({ session, item });
});

app.get('/api/inventories/:id/export/xls', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF'), (req, res) => {
  const session = (db.inventories || []).find(i => i.id === req.params.id);
  if (!session) return res.status(404).send('Inventur wurde nicht gefunden.');
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${inventoryExportFilename(session, 'xls')}"`);
  res.send(inventoryExcelHtml(session));
});

app.get('/api/inventories/:id/print', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF'), (req, res) => {
  const session = (db.inventories || []).find(i => i.id === req.params.id);
  if (!session) return res.status(404).send('Inventur wurde nicht gefunden.');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(inventoryPrintHtml(session));
});

app.patch('/api/inventories/:id', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF'), (req, res) => {
  const session = (db.inventories || []).find(i => i.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Inventur wurde nicht gefunden.' });
  if (session.status === 'ABGESCHLOSSEN') return res.status(400).json({ error: 'Diese Inventur ist bereits abgeschlossen.' });
  const incomingItems = Array.isArray(req.body.items) ? req.body.items : [];
  session.items = session.items.map(item => {
    const incoming = incomingItems.find(x => x.id === item.id);
    if (!incoming) return item;
    if (session.area === 'KONSI') {
      return { ...item, present: incoming.present === null || incoming.present === undefined || incoming.present === '' ? null : Boolean(incoming.present), note: cleanText(incoming.note, '') };
    }
    const hasPackages = hasInventoryValue(incoming.countedPackages);
    const hasSheets = hasInventoryValue(incoming.countedSheets);
    const counted = hasPackages || hasSheets;
    return {
      ...item,
      countedPackages: counted ? Math.max(0, numberOr(hasPackages ? incoming.countedPackages : 0, 0)) : null,
      countedSheets: counted ? Math.max(0, numberOr(hasSheets ? incoming.countedSheets : 0, 0)) : null,
      note: cleanText(incoming.note, '')
    };
  });
  const wantsChecked = req.body.status === 'GEPRUEFT';
  if (wantsChecked && !['BUERO', 'CHEF'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Laser darf die Inventur speichern, aber nicht prüfen oder abschließen.' });
  }
  session.status = wantsChecked ? 'GEPRUEFT' : 'IN_BEARBEITUNG';
  session.updatedBy = req.user.name;
  session.updatedAt = nowIso();
  if (session.status === 'GEPRUEFT') { session.checkedBy = req.user.name; session.checkedAt = nowIso(); }
  const activity = addActivity('INVENTUR', `${req.user.name} hat die Inventur ${inventoryAreaLabel(session.area)} gespeichert.`, req.user);
  saveDb();
  emitToAll('inventory:changed', { session, activity, message: `Inventur gespeichert: ${inventoryAreaLabel(session.area)}`, targetRoles: ['LASER', 'BUERO', 'CHEF'] });
  emitToAll('state:changed', { reason: 'inventory:saved' });
  res.json({ session });
});

app.post('/api/inventories/:id/close', requireAuth, allowRoles('BUERO', 'CHEF'), (req, res) => {
  const session = (db.inventories || []).find(i => i.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Inventur wurde nicht gefunden.' });
  if (session.status === 'ABGESCHLOSSEN') return res.status(400).json({ error: 'Diese Inventur ist bereits abgeschlossen.' });
  const uncounted = session.items.filter(item => {
    if (session.area === 'KONSI') return item.present === null || item.present === undefined;
    return !mainInventoryItemCounted(item);
  });
  if (uncounted.length) return res.status(400).json({ error: `Bitte erst alle Positionen zählen. Offen: ${uncounted.length}` });

  let changedCount = 0;
  if (session.area === 'KONSI') {
    const byMaterial = session.items.reduce((acc, item) => {
      (acc[item.materialId] ||= []).push(item);
      return acc;
    }, {});
    Object.entries(byMaterial).forEach(([materialId, items]) => {
      const material = db.materials.find(m => m.id === materialId && !m.archived);
      if (!material) return;
      const before = normalizePackageNumbers(material.packageNumbers).length;
      const presentNumbers = items.filter(item => item.present).map(item => item.packageNumber).filter(Boolean);
      material.packageNumbers = presentNumbers;
      material.stock = presentNumbers.length;
      material.sheetStock = 0;
      material.packageStock = 0;
      material.updatedAt = nowIso();
      if (before !== presentNumbers.length) changedCount += 1;
    });
  } else {
    session.items.forEach(item => {
      let material = db.materials.find(m => m.id === item.materialId && !m.archived);
      const packages = Math.max(0, numberOr(item.countedPackages, 0));
      const sheets = Math.max(0, numberOr(item.countedSheets, 0));
      if (!material && item.extraMaterial) {
        try {
          const incoming = materialPayload({
            name: item.materialName || item.title || 'Zusatzmaterial',
            thickness: item.thickness,
            format: item.format,
            shelf: normalizeShelf(session.area),
            storage: 'HAUPTLAGER',
            packageStock: packages,
            sheetStock: sheets,
            stock: packages + sheets,
            minStock: Boolean(item.rest) ? 0 : DEFAULT_MATERIAL_MIN_STOCK,
            rest: Boolean(item.rest),
            type: item.rest ? 'Resttafel' : 'Tafel',
            unit: item.rest ? 'Stück' : 'Tafeln',
            note: item.note ? `Aus Inventur ${inventoryAreaLabel(session.area)} übernommen: ${item.note}` : `Aus Inventur ${inventoryAreaLabel(session.area)} übernommen.`
          });
          const duplicate = findDuplicateMaterial(incoming);
          if (duplicate) {
            mergeMaterialQuantities(duplicate, incoming);
            item.materialId = duplicate.id;
          } else {
            db.materials.push(incoming);
            item.materialId = incoming.id;
          }
          item.createdFromInventory = true;
          changedCount += 1;
        } catch (_) {}
        return;
      }
      if (!material) return;
      const beforePackages = numberOr(material.packageStock, 0);
      const beforeSheets = numberOr(material.sheetStock, numberOr(material.stock, 0));
      material.packageStock = packages;
      material.sheetStock = sheets;
      material.stock = packages + sheets;
      material.updatedAt = nowIso();
      if (beforePackages !== packages || beforeSheets !== sheets) changedCount += 1;
    });
  }

  session.status = 'ABGESCHLOSSEN';
  session.closedBy = req.user.name;
  session.closedAt = nowIso();
  session.updatedBy = req.user.name;
  session.updatedAt = session.closedAt;
  const cycleAfterClose = inventoryCycleSummary(inventoryCycleKey(session));
  db.settings = normalizeSettings(db.settings || {});
  if (cycleAfterClose.complete) {
    db.settings.inventoryLastDate = dateOnlyFromIso(cycleAfterClose.closedAt || session.closedAt);
    db.settings.inventoryNextDate = addMonthsToDateOnly(db.settings.inventoryLastDate, db.settings.inventoryIntervalMonths);
    db.settings.updatedAt = session.closedAt;
  }
  const activityText = cycleAfterClose.complete
    ? `${req.user.name} hat ${inventoryAreaLabel(session.area)} abgeschlossen. Die Gesamtinventur ist vollständig. ${changedCount} Bestand/Bestände angepasst.`
    : `${req.user.name} hat die Inventur ${inventoryAreaLabel(session.area)} abgeschlossen. ${changedCount} Bestand/Bestände angepasst.`;
  const activity = addActivity('INVENTUR', activityText, req.user, { materialIds: session.items.map(item => item.materialId).filter(Boolean) });
  saveDb();
  emitToAll('inventory:changed', { session, activity, message: `Inventur abgeschlossen: ${inventoryAreaLabel(session.area)}`, targetRoles: ['LASER', 'BUERO', 'CHEF'] });
  emitToAll('material:changed', { activity, message: `Inventur übernommen: ${inventoryAreaLabel(session.area)}`, targetRoles: ['LASER', 'BUERO', 'CHEF'] });
  emitToAll('state:changed', { reason: 'inventory:closed' });
  res.json({ session, changedCount });
});

app.post('/api/orders', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF'), (req, res) => {
  const materialId = String(req.body.materialId || '').trim();
  const material = db.materials.find(m => m.id === materialId && !m.archived);
  if (!material) return res.status(400).json({ error: 'Material wurde nicht gefunden.' });
  if (material.rest) return res.status(400).json({ error: 'Resttafeln können nicht bestellt werden.' });
  const amount = Number(req.body.amount || 0);
  const sheets = Number(req.body.sheets || 0);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Bitte eine gültige Bestellmenge eingeben.' });
  if (!Number.isFinite(sheets) || sheets < 0) return res.status(400).json({ error: 'Bitte eine gültige Tafel-Angabe eingeben.' });

  const order = {
    id: uid('o'),
    materialId: material.id,
    materialName: material.name,
    materialFormat: material.format || '',
    materialThickness: material.thickness || '',
    storage: material.storage,
    requestedAmount: amount,
    requestedSheets: material.storage === 'KONSI' ? 0 : sheets,
    orderedAmount: null,
    orderedSheets: 0,
    status: 'ANGEFORDERT',
    note: String(req.body.note || '').trim(),
    requestedBy: req.user.name,
    requestedByRole: req.user.role,
    createdAt: nowIso(),
    approvedBy: null,
    approvedAt: null,
    orderedBy: null,
    orderedAt: null,
    receivedAmount: 0,
    receivedSheets: 0,
    receivedBy: null,
    receivedAt: null,
    deliveredToShelf: '',
    deliveries: [],
    doneBy: null,
    doneAt: null,
    lastUpdate: nowIso()
  };
  db.orders.unshift(order);
  const activity = addActivity('BESTELLUNG', `${req.user.name} hat ${orderQuantityText(order, 'request')} ${materialTitleText(material)} als Bestellung angefordert.`, req.user, { materialId: material.id, orderId: order.id });
  saveDb();

  emitToAll('order:new', { order, activity, message: `Neue Bestellanforderung: ${material.name}`, targetRoles: ['LASER', 'BUERO', 'CHEF'] });
  emitToAll('state:changed', { reason: 'order:new' });
  res.status(201).json({ order });
});

app.patch('/api/orders/:id', requireAuth, allowRoles('BUERO', 'CHEF'), (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung wurde nicht gefunden.' });
  const action = String(req.body.action || '').toUpperCase();
  const note = String(req.body.note || '').trim();
  const amount = req.body.orderedAmount === '' || req.body.orderedAmount == null ? null : Number(req.body.orderedAmount);
  const sheets = req.body.orderedSheets === '' || req.body.orderedSheets == null ? 0 : Number(req.body.orderedSheets);
  const changedAt = nowIso();

  if (action === 'ORDERED') {
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) return res.status(400).json({ error: 'Bitte eine gültige bestellte Menge eingeben.' });
    if (!Number.isFinite(sheets) || sheets < 0) return res.status(400).json({ error: 'Bitte eine gültige Tafel-Angabe eingeben.' });
    order.status = 'BESTELLT';
    order.orderedBy = req.user.name;
    order.orderedAt = changedAt;
    order.orderedAmount = amount || order.requestedAmount;
    order.orderedSheets = order.storage === 'KONSI' ? 0 : sheets;
    if (note) order.note = note;
  } else if (action === 'REJECT') {
    order.status = 'ABGELEHNT';
    order.approvedBy = req.user.name;
    order.approvedAt = changedAt;
    if (note) order.note = note;
  } else if (action === 'DONE') {
    order.status = 'ERLEDIGT';
    order.doneBy = req.user.name;
    order.doneAt = changedAt;
    if (note) order.note = note;
  } else {
    return res.status(400).json({ error: 'Unbekannte Aktion.' });
  }
  order.lastUpdate = changedAt;

  const statusText = order.status === 'BESTELLT'
    ? `${order.materialName} wurde durch ${req.user.name} als bestellt markiert (${orderQuantityText(order, 'ordered')}).`
    : `${order.materialName} hat jetzt den Status ${order.status}.`;
  const activity = addActivity('STATUS', statusText, req.user, { orderId: order.id, materialId: order.materialId });
  saveDb();

  emitToAll('order:updated', { order, activity, message: statusText, targetRoles: ['LASER', 'BUERO', 'CHEF'] });
  emitToAll('state:changed', { reason: 'order:updated' });
  res.json({ order });
});



function deliveryTargetKey(material, targetShelf) {
  return [
    cleanText(material.name).toLowerCase(),
    normalizeThickness(material.thickness).toLowerCase(),
    normalizeFormat(material.format),
    normalizeShelf(targetShelf),
    material.rest ? 'REST' : 'NORMAL'
  ].join('|');
}

function findOrCreateDeliveryTarget(sourceMaterial, targetShelf, packages, sheets, meta = {}) {
  const shelf = normalizeShelf(targetShelf || 'Carport');
  const key = deliveryTargetKey(sourceMaterial, shelf);
  const deliveredAt = meta.deliveredAt || nowIso();
  const deliveredBy = cleanText(meta.deliveredBy, '');
  const deliveredFromOrderId = cleanText(meta.deliveredFromOrderId, '');
  let target = db.materials.find(m => !m.archived && m.storage !== 'KONSI' && deliveryTargetKey(m, m.shelf) === key);
  if (!target) {
    target = normalizeMaterial({
      ...sourceMaterial,
      id: uid('m'),
      storage: 'HAUPTLAGER',
      shelf,
      stock: sheets,
      packageStock: 0,
      sheetStock: sheets,
      packageNumbers: [],
      deliveryPending: true,
      deliveryStatus: 'GELIEFERT',
      deliveredAt,
      deliveredBy,
      deliveredFromOrderId,
      deliveredPackageCount: packages,
      lastPackageWeightKg: meta.packageWeightKg ?? null,
      archived: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      note: sourceMaterial.note || ''
    });
    target.packageStock = 0;
    target.sheetStock = sheets;
    target.stock = sheets;
    target.deliveryPending = true;
    target.deliveryStatus = 'GELIEFERT';
    target.deliveredAt = deliveredAt;
    target.deliveredBy = deliveredBy;
    target.deliveredFromOrderId = deliveredFromOrderId;
    target.deliveredPackageCount = packages;
    target.lastPackageWeightKg = meta.packageWeightKg ?? null;
    db.materials.push(target);
  } else {
    const oldDeliveredPackages = Math.max(0, numberOr(target.deliveredPackageCount, numberOr(target.packageStock, 0)));
    target.deliveredPackageCount = oldDeliveredPackages + packages;
    target.packageStock = 0;
    target.sheetStock = Math.max(0, numberOr(target.sheetStock, numberOr(target.stock, 0))) + sheets;
    target.stock = target.sheetStock;
    target.deliveryPending = true;
    target.deliveryStatus = 'GELIEFERT';
    target.deliveredAt = deliveredAt;
    target.deliveredBy = deliveredBy;
    target.deliveredFromOrderId = deliveredFromOrderId;
    target.lastPackageWeightKg = meta.packageWeightKg ?? null;
    target.updatedAt = deliveredAt;
  }
  return target;
}

app.post('/api/orders/:id/receive', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF'), (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung wurde nicht gefunden.' });
  if (!['BESTELLT', 'TEILGELIEFERT'].includes(order.status)) return res.status(400).json({ error: 'Wareneingang ist erst möglich, wenn die Bestellung als bestellt markiert wurde.' });
  const material = db.materials.find(m => m.id === order.materialId && !m.archived);
  if (!material) return res.status(404).json({ error: 'Zugehöriges Material wurde nicht gefunden.' });

  const beforeSourceSnapshot = materialSnapshotById(material.id);
  let beforeTargetSnapshot = null;
  let changedTargetId = null;
  const packages = Math.max(0, Math.floor(numberOr(req.body.receivedAmount, 0)));
  const packageWeightKg = order.storage === 'KONSI' ? 0 : Math.max(0, numberOr(req.body.packageWeightKg, 0));
  const autoSheets = order.storage === 'KONSI' ? 0 : estimateSheetsFromPackageWeight(material, packageWeightKg, packages);
  const sheets = order.storage === 'KONSI' ? 0 : Math.max(0, Math.floor(numberOr(req.body.receivedSheets, autoSheets)));
  const targetShelf = order.storage === 'KONSI' ? KONSI_LOCATION : normalizeShelf(req.body.targetShelf || 'Carport');
  const note = cleanText(req.body.note, '');
  const packageNumbers = normalizePackageNumbers(req.body.packageNumbers);
  if (packages <= 0 && sheets <= 0) return res.status(400).json({ error: 'Bitte gelieferte Pakete oder Tafeln eintragen.' });

  if (order.storage === 'KONSI') {
    if (packageNumbers.length !== packages) return res.status(400).json({ error: 'Beim Konsi-Lager muss für jedes gelieferte Paket genau eine Paketnummer eingetragen werden.' });
    const existingNumbers = normalizePackageNumbers(material.packageNumbers);
    // Gleiche Paketnummern sind erlaubt: jedes Vorkommen zählt als separates Konsi-Paket.
    material.packageNumbers = existingNumbers.concat(packageNumbers);
    material.stock = material.packageNumbers.length;
    material.packageStock = 0;
    material.sheetStock = 0;
    material.updatedAt = nowIso();
  } else {
    const existingTarget = db.materials.find(m => !m.archived && m.storage !== 'KONSI' && deliveryTargetKey(m, m.shelf) === deliveryTargetKey(material, targetShelf));
    beforeTargetSnapshot = existingTarget ? materialSnapshotById(existingTarget.id) : null;
    const changedTarget = findOrCreateDeliveryTarget(material, targetShelf, packages, sheets, { deliveredAt: nowIso(), deliveredBy: req.user.name, deliveredFromOrderId: order.id, packageWeightKg });
    changedTargetId = changedTarget.id;
    if (!beforeTargetSnapshot) beforeTargetSnapshot = { id: changedTarget.id, existed: false, material: null };
  }

  order.receivedAmount = Math.max(0, numberOr(order.receivedAmount, 0)) + packages;
  order.receivedSheets = Math.max(0, numberOr(order.receivedSheets, 0)) + sheets;
  order.deliveredToShelf = targetShelf;
  order.receivedBy = req.user.name;
  order.receivedAt = nowIso();
  order.deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];
  order.deliveries.unshift({ id: uid('d'), packages, sheets, targetShelf, packageNumbers, packageWeightKg, totalWeightKg: packageWeightKg ? packageWeightKg * packages : 0, autoSheets, note, by: req.user.name, at: order.receivedAt });
  order.lastPackageWeightKg = packageWeightKg || order.lastPackageWeightKg || null;

  order.status = 'ERLEDIGT';
  order.doneBy = req.user.name;
  order.doneAt = order.receivedAt;
  order.lastUpdate = order.receivedAt;
  if (note) order.note = note;

  const placeText = order.storage === 'KONSI' ? `Konsi-Lager / ${KONSI_LOCATION}` : targetShelf;
  const weightText = packageWeightKg ? ` (${packages} Paket(e) × ${packageWeightKg} kg = ${packageWeightKg * packages} kg, ca. ${autoSheets} Tafeln berechnet)` : '';
  const undoSnaps = order.storage === 'KONSI' ? [beforeSourceSnapshot] : [beforeSourceSnapshot, beforeTargetSnapshot].filter(Boolean);
  const activity = addActivity('WARENEINGANG', `${req.user.name} hat Wareneingang für ${order.materialName} gebucht: ${orderQuantityText({ ...order, receivedAmount: packages, receivedSheets: sheets }, 'received')} nach ${placeText}${weightText}.`, req.user, { materialId: changedTargetId || material.id, materialIds: Array.from(new Set([material.id, changedTargetId].filter(Boolean))), orderId: order.id, undo: makeUndo('WARENEINGANG', undoSnaps, 'Wareneingang rückgängig') });
  saveDb();
  emitToAll('order:updated', { order, activity, message: `Wareneingang gebucht: ${order.materialName} → ${placeText}`, targetRoles: ['LASER', 'BUERO', 'CHEF'] });
  emitToAll('material:changed', { activity, message: `Bestand durch Lieferung aktualisiert: ${order.materialName}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  emitToAll('state:changed', { reason: 'order:received' });
  res.json({ order });
});

app.post('/api/orders/direct-receive', requireAuth, allowRoles('LASER', 'BUERO', 'CHEF', 'ADMIN'), (req, res) => {
  const materialId = cleanText(req.body.materialId, '');
  const targetShelf = normalizeShelf(req.body.targetShelf || 'Carport');
  const packages = Math.max(0, Math.floor(numberOr(req.body.receivedAmount, 0)));
  const packageWeightKg = Math.max(0, numberOr(req.body.packageWeightKg, 0));
  let sourceMaterial = materialId ? db.materials.find(m => m.id === materialId && !m.archived) : null;

  if (sourceMaterial && sourceMaterial.storage === 'KONSI') {
    return res.status(400).json({ error: 'Wareneingang ohne Bestellung ist hier nur für Hauptlager-Material vorgesehen. Konsi bitte über Konsi-Material/Paketnummern führen.' });
  }

  if (!sourceMaterial) {
    const name = cleanText(req.body.name, '');
    if (!name) return res.status(400).json({ error: 'Bitte Material auswählen oder Materialname eintragen.' });
    sourceMaterial = normalizeMaterial({
      name,
      thickness: req.body.thickness,
      format: req.body.format,
      storage: 'HAUPTLAGER',
      shelf: targetShelf,
      stock: 0,
      sheetStock: 0,
      packageStock: 0,
      minStock: DEFAULT_MATERIAL_MIN_STOCK,
      rest: false,
      note: cleanText(req.body.note, '')
    });
  }

  if (!normalizeThickness(sourceMaterial.thickness)) return res.status(400).json({ error: 'Bitte die Stärke eintragen, bevor der Wareneingang gebucht wird.' });

  const autoSheets = estimateSheetsFromPackageWeight(sourceMaterial, packageWeightKg, packages);
  const sheets = Math.max(0, Math.floor(numberOr(req.body.receivedSheets, autoSheets)));
  const note = cleanText(req.body.note, '');
  if (packages <= 0 && sheets <= 0) return res.status(400).json({ error: 'Bitte gelieferte Pakete oder Tafeln eintragen.' });

  const existingTarget = db.materials.find(m => !m.archived && m.storage !== 'KONSI' && deliveryTargetKey(m, m.shelf) === deliveryTargetKey(sourceMaterial, targetShelf));
  let beforeTargetSnapshot = existingTarget ? materialSnapshotById(existingTarget.id) : null;
  const receivedAt = nowIso();
  const changedTarget = findOrCreateDeliveryTarget(sourceMaterial, targetShelf, packages, sheets, { deliveredAt: receivedAt, deliveredBy: req.user.name, deliveredFromOrderId: '', packageWeightKg });
  if (!beforeTargetSnapshot) beforeTargetSnapshot = { id: changedTarget.id, existed: false, material: null };
  if (note) changedTarget.note = [changedTarget.note, note].filter(Boolean).join(' | ');
  changedTarget.updatedAt = receivedAt;

  const directIncoming = {
    id: uid('o'),
    materialId: changedTarget.id,
    materialName: changedTarget.name,
    materialFormat: changedTarget.format || sourceMaterial.format || '',
    materialThickness: changedTarget.thickness || sourceMaterial.thickness || '',
    storage: 'HAUPTLAGER',
    requestedAmount: packages,
    requestedSheets: sheets,
    orderedAmount: packages,
    orderedSheets: sheets,
    status: 'ERLEDIGT',
    note,
    requestedBy: req.user.name,
    requestedByRole: req.user.role,
    createdAt: receivedAt,
    approvedBy: null,
    approvedAt: null,
    orderedBy: req.user.name,
    orderedAt: receivedAt,
    receivedAmount: packages,
    receivedSheets: sheets,
    receivedBy: req.user.name,
    receivedAt,
    deliveredToShelf: targetShelf,
    deliveries: [{ id: uid('d'), packages, sheets, targetShelf, packageNumbers: [], materialFormat: changedTarget.format || sourceMaterial.format || '', packageWeightKg, totalWeightKg: packageWeightKg ? packageWeightKg * packages : 0, autoSheets, note, by: req.user.name, at: receivedAt, directIncoming: true }],
    directIncoming: true,
    doneBy: req.user.name,
    doneAt: receivedAt,
    lastPackageWeightKg: packageWeightKg || null,
    lastUpdate: receivedAt
  };
  db.orders.unshift(directIncoming);

  const weightText = packageWeightKg ? ` (${packages} Paket(e) × ${packageWeightKg} kg = ${packageWeightKg * packages} kg, ca. ${autoSheets} Tafeln berechnet)` : '';
  const dimensionText = (changedTarget.format || sourceMaterial.format) ? ` · Maße: ${changedTarget.format || sourceMaterial.format}` : '';
  const activity = addActivity('WARENEINGANG', `${req.user.name} hat Wareneingang ohne Bestellung für ${materialTitleText(changedTarget)}${dimensionText} gebucht: ${orderQuantityText({ ...directIncoming, receivedAmount: packages, receivedSheets: sheets }, 'received')} nach ${targetShelf}${weightText}.`, req.user, { materialId: changedTarget.id, materialIds: [changedTarget.id], orderId: directIncoming.id, undo: makeUndo('WARENEINGANG', [beforeTargetSnapshot], 'Wareneingang ohne Bestellung rückgängig') });
  saveDb();
  emitToAll('order:updated', { order: directIncoming, activity, message: `Wareneingang ohne Bestellung: ${changedTarget.name} → ${targetShelf}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  emitToAll('material:changed', { material: changedTarget, activity, message: `Wareneingang gebucht: ${changedTarget.name}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  emitToAll('state:changed', { reason: 'order:direct-receive' });
  res.status(201).json({ order: directIncoming, material: changedTarget });
});


app.put('/api/orders/:id/direct-receive', requireAuth, allowRoles('ADMIN'), (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Wareneingang wurde nicht gefunden.' });
  if (order.storage === 'KONSI') return res.status(400).json({ error: 'Konsi-Wareneingang wird über Paketnummern geführt und kann hier nicht geändert werden.' });
  if (order.status !== 'ERLEDIGT') return res.status(400).json({ error: 'Nur bereits gebuchte Wareneingänge können geändert werden.' });

  const name = cleanText(req.body.name || order.materialName, 'Material');
  const thickness = normalizeThickness(req.body.thickness || order.materialThickness || '');
  if (!thickness) return res.status(400).json({ error: 'Bitte die Stärke eintragen, bevor der Wareneingang geändert wird.' });
  const format = normalizeFormat(req.body.format || order.materialFormat || '3000x1500');
  const targetShelf = normalizeShelf(req.body.targetShelf || order.deliveredToShelf || 'Carport');
  const packages = Math.max(0, Math.floor(numberOr(req.body.receivedAmount, order.receivedAmount || 0)));
  const packageWeightKg = Math.max(0, numberOr(req.body.packageWeightKg, order.lastPackageWeightKg || 0));
  const sourceMaterial = normalizeMaterial({
    name,
    thickness,
    format,
    storage: 'HAUPTLAGER',
    shelf: targetShelf,
    stock: 0,
    sheetStock: 0,
    packageStock: 0,
    rest: false,
    note: cleanText(req.body.note, '')
  });
  const autoSheets = estimateSheetsFromPackageWeight(sourceMaterial, packageWeightKg, packages);
  const sheets = Math.max(0, Math.floor(numberOr(req.body.receivedSheets, autoSheets)));
  const note = cleanText(req.body.note, '');
  if (packages <= 0 && sheets <= 0) return res.status(400).json({ error: 'Bitte gelieferte Pakete oder Tafeln eintragen.' });

  const oldOrderShelf = normalizeShelf(order.deliveredToShelf || targetShelf || 'Carport');
  const oldSourceMaterial = normalizeMaterial({
    name: order.materialName,
    thickness: order.materialThickness,
    format: order.materialFormat,
    storage: 'HAUPTLAGER',
    shelf: oldOrderShelf,
    stock: 0,
    sheetStock: 0,
    packageStock: 0,
    rest: false
  });
  const oldMaterial = order.directIncoming
    ? db.materials.find(m => m.id === order.materialId)
    : db.materials.find(m => !m.archived && m.storage !== 'KONSI' && deliveryTargetKey(m, m.shelf) === deliveryTargetKey(oldSourceMaterial, oldOrderShelf));
  const oldSnapshot = oldMaterial ? materialSnapshotById(oldMaterial.id) : null;
  const oldPackages = Math.max(0, numberOr(order.receivedAmount, 0));
  const oldSheets = Math.max(0, numberOr(order.receivedSheets, 0));
  if (oldMaterial && oldMaterial.storage !== 'KONSI') {
    oldMaterial.deliveredPackageCount = Math.max(0, numberOr(oldMaterial.deliveredPackageCount, 0) - oldPackages);
    oldMaterial.sheetStock = Math.max(0, numberOr(oldMaterial.sheetStock, numberOr(oldMaterial.stock, 0)) - oldSheets);
    oldMaterial.packageStock = Math.max(0, numberOr(oldMaterial.packageStock, 0));
    oldMaterial.stock = oldMaterial.packageStock + oldMaterial.sheetStock;
    oldMaterial.updatedAt = nowIso();
  }

  const existingTarget = db.materials.find(m => !m.archived && m.storage !== 'KONSI' && deliveryTargetKey(m, m.shelf) === deliveryTargetKey(sourceMaterial, targetShelf));
  const targetSnapshot = existingTarget ? materialSnapshotById(existingTarget.id) : null;
  const correctedAt = nowIso();
  const changedTarget = findOrCreateDeliveryTarget(sourceMaterial, targetShelf, packages, sheets, { deliveredAt: correctedAt, deliveredBy: req.user.name, deliveredFromOrderId: order.id, packageWeightKg });
  changedTarget.name = name;
  changedTarget.thickness = thickness;
  changedTarget.format = format;
  changedTarget.shelf = targetShelf;
  changedTarget.storage = 'HAUPTLAGER';
  changedTarget.deliveryPending = true;
  changedTarget.deliveryStatus = 'GELIEFERT';
  changedTarget.deliveredAt = correctedAt;
  changedTarget.deliveredBy = req.user.name;
  changedTarget.deliveredFromOrderId = order.id;
  changedTarget.lastPackageWeightKg = packageWeightKg || null;
  if (note) changedTarget.note = note;
  changedTarget.updatedAt = correctedAt;

  order.materialId = changedTarget.id;
  order.materialName = changedTarget.name;
  order.materialFormat = changedTarget.format;
  order.materialThickness = changedTarget.thickness;
  order.requestedAmount = packages;
  order.requestedSheets = sheets;
  order.orderedAmount = packages;
  order.orderedSheets = sheets;
  order.receivedAmount = packages;
  order.receivedSheets = sheets;
  order.deliveredToShelf = targetShelf;
  order.receivedBy = req.user.name;
  order.receivedAt = correctedAt;
  order.doneBy = req.user.name;
  order.doneAt = correctedAt;
  order.status = 'ERLEDIGT';
  order.note = note;
  order.lastPackageWeightKg = packageWeightKg || null;
  order.lastUpdate = correctedAt;
  order.deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];
  order.deliveries.unshift({ id: uid('d'), packages, sheets, targetShelf, packageNumbers: [], materialFormat: changedTarget.format, packageWeightKg, totalWeightKg: packageWeightKg ? packageWeightKg * packages : 0, autoSheets, note, by: req.user.name, at: correctedAt, directIncoming: Boolean(order.directIncoming), correction: true });

  const snapshots = [oldSnapshot, targetSnapshot || { id: changedTarget.id, existed: false, material: null }].filter(Boolean);
  const dimensionText = changedTarget.format ? ` · Maße: ${changedTarget.format}` : '';
  const activity = addActivity('KORREKTUR', `${req.user.name} hat Wareneingang korrigiert: ${materialTitleText(changedTarget)}${dimensionText}, ${packages} Paket(e) / ${sheets} Tafel(n) nach ${targetShelf}.`, req.user, { materialId: changedTarget.id, materialIds: Array.from(new Set([oldMaterial && oldMaterial.id, changedTarget.id].filter(Boolean))), orderId: order.id, undo: makeUndo('WARENEINGANG_KORREKTUR', snapshots, 'Wareneingang-Korrektur rückgängig') });

  saveDb();
  emitToAll('order:updated', { order, activity, message: `Wareneingang korrigiert: ${changedTarget.name}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  emitToAll('material:changed', { material: changedTarget, activity, message: `Wareneingang korrigiert: ${changedTarget.name}`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  emitToAll('state:changed', { reason: 'order:direct-receive-edited' });
  res.json({ order, material: changedTarget });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const oldPassword = String(req.body.oldPassword || '');
  const newPassword = String(req.body.newPassword || '').trim();
  if (req.user.password !== oldPassword) return res.status(400).json({ error: 'Altes Passwort ist falsch.' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'Neues Passwort muss mindestens 4 Zeichen haben.' });
  req.user.password = newPassword;
  req.user.mustChangePassword = false;
  req.user.updatedAt = nowIso();
  const activity = addActivity('BENUTZER', `${req.user.name} hat das Passwort geändert.`, req.user);
  saveDb();
  emitToAll('users:changed', { user: publicManagedUser(req.user), activity, message: `Passwort geändert: ${req.user.name}`, targetRoles: ['ADMIN'] });
  emitToAll('state:changed', { reason: 'password:changed' });
  res.json({ ok: true, user: publicUser(req.user) });
});

app.get('/api/admin/backups', requireAuth, allowRoles('ADMIN'), (req, res) => {
  res.json({ backups: listBackups(), status: systemStatus() });
});

app.post('/api/admin/backups', requireAuth, allowRoles('ADMIN'), (req, res) => {
  const backup = createBackup(req.body.label || `Manuelle Sicherung durch ${req.user.name}`);
  const activity = addActivity('SYSTEM', `${req.user.name} hat eine Datensicherung erstellt: ${backup.file}.`, req.user);
  saveDb();
  emitToAll('state:changed', { reason: 'backup:created' });
  res.status(201).json({ backup, activity, backups: listBackups() });
});

app.get('/api/admin/backups/:file/download', requireAuth, allowRoles('ADMIN'), (req, res) => {
  const file = safeBackupName(req.params.file);
  if (!file) return res.status(400).send('Ungültiger Dateiname.');
  const full = path.join(backupDirPath(), file);
  if (!fs.existsSync(full)) return res.status(404).send('Backup wurde nicht gefunden.');
  res.download(full, file);
});

app.post('/api/admin/backups/:file/restore', requireAuth, allowRoles('ADMIN'), (req, res) => {
  const file = safeBackupName(req.params.file);
  if (!file) return res.status(400).json({ error: 'Ungültiger Dateiname.' });
  const full = path.join(backupDirPath(), file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Backup wurde nicht gefunden.' });
  try {
    createBackup(`Automatisch vor Wiederherstellung durch ${req.user.name}`);
    const payload = JSON.parse(fs.readFileSync(full, 'utf8'));
    const restored = payload && payload.data ? payload.data : payload;
    db = migrateDb(restored);
    addActivity('SYSTEM', `${req.user.name} hat eine Datensicherung wiederhergestellt: ${file}.`, req.user);
    saveDb();
    emitToAll('state:changed', { reason: 'backup:restored' });
    res.json({ ok: true, backups: listBackups() });
  } catch (error) {
    res.status(400).json({ error: 'Backup konnte nicht wiederhergestellt werden.' });
  }
});

app.get('/api/admin/export/materials', requireAuth, allowRoles('ADMIN'), (req, res) => {
  const csv = materialsToCsv(db.materials);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="eckl_materialien_admin_komplett.csv"');
  res.send('\uFEFF' + csv);
});

app.get('/api/materials/export-csv', requireAuth, allowRoles('BUERO', 'CHEF', 'ADMIN'), (req, res) => {
  const csv = materialsToCsv(visibleMaterials());
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="eckl_materialliste_aktiv.csv"');
  res.send('\uFEFF' + csv);
});

app.post('/api/admin/materials/delete-empty', requireAuth, allowRoles('ADMIN'), (req, res) => {
  const allMaterials = Array.isArray(db.materials) ? db.materials : [];
  const emptyMaterials = allMaterials.filter(isEmptyMaterial);
  if (!emptyMaterials.length) return res.json({ ok: true, deletedMaterials: 0, remainingMaterials: allMaterials.length, version: PROGRAM_VERSION });
  let backup;
  try {
    backup = createBackup(`Automatisch vor Leere-Materialien-Löschen durch ${req.user.name}`);
  } catch (error) {
    return res.status(500).json({ error: `Backup konnte vor dem Löschen nicht erstellt werden: ${error.message}` });
  }
  const emptyIds = emptyMaterials.map(m => m.id);
  const related = purgeRelatedDataForMaterialIds(emptyIds);
  db.materials = allMaterials.filter(material => !emptyIds.includes(material.id));
  const activity = addActivity('SYSTEM', `${req.user.name} hat ${emptyMaterials.length} leere Materialposition(en) gelöscht. Backup: ${backup.file}.`, req.user, { materialIds: emptyIds });
  saveDb();
  emitToAll('material:deleted', { activity, message: `${emptyMaterials.length} leere Materialposition(en) gelöscht`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
  emitToAll('state:changed', { reason: 'materials:delete-empty', version: PROGRAM_VERSION });
  res.json({ ok: true, version: PROGRAM_VERSION, deletedMaterials: emptyMaterials.length, remainingMaterials: db.materials.length, backup, ...related });
});



function clearOperationalDatabaseForAdmin(user, backup, counts = {}) {
  const preservedUsers = Array.isArray(db.users) ? cloneData(db.users) : defaultDb().users;
  const preservedSessions = db.sessions && typeof db.sessions === 'object' ? cloneData(db.sessions) : {};
  const preservedSettings = normalizeSettings(db.settings || defaultSettings());
  const created = nowIso();
  db = {
    version: 19,
    users: preservedUsers,
    sessions: preservedSessions,
    materials: [],
    orders: [],
    activities: [
      { id: uid('a'), type: 'SYSTEM', text: `${user.name} hat die Materialdatenbank hart geleert. Backup: ${backup && backup.file ? backup.file : 'erstellt'}.`, at: created, userId: user.id, userName: user.name, userRole: user.role }
    ],
    inventories: [],
    settings: { ...preservedSettings, updatedAt: preservedSettings.updatedAt || created },
    materialDatabaseCleared: true,
    materialDatabaseClearedVersion: PROGRAM_VERSION,
    materialDatabaseResetAt: created,
    materialDatabaseResetBy: user.name,
    materialDatabaseResetCounts: counts
  };
  saveDb(db);
  const reloaded = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  db = migrateDb(reloaded);
  db.materials = [];
  db.orders = [];
  db.inventories = [];
  db.materialDatabaseCleared = true;
  db.materialDatabaseClearedVersion = PROGRAM_VERSION;
  db.materialDatabaseResetAt = created;
  db.materialDatabaseResetBy = user.name;
  saveDb(db);
  return {
    remainingMaterials: Array.isArray(db.materials) ? db.materials.length : 0,
    remainingOrders: Array.isArray(db.orders) ? db.orders.length : 0,
    remainingInventories: Array.isArray(db.inventories) ? db.inventories.length : 0
  };
}

app.post('/api/admin/materials/delete-all', requireAuth, allowRoles('ADMIN'), (req, res) => {
  const confirmText = cleanText(req.body && req.body.confirmText);
  if (!isDeleteConfirmTextValid(confirmText)) return res.status(400).json({ error: 'Bestätigung fehlt oder ist falsch.' });

  const materialsBefore = Array.isArray(db.materials) ? db.materials : [];
  const materialCount = materialsBefore.length;
  const activeCount = materialsBefore.filter(m => !m.archived).length;
  const archivedCount = materialsBefore.filter(m => m.archived).length;
  const orderCount = Array.isArray(db.orders) ? db.orders.length : 0;
  const inventoryCount = Array.isArray(db.inventories) ? db.inventories.length : 0;
  const activityCount = Array.isArray(db.activities) ? db.activities.length : 0;

  let backup;
  try {
    backup = createBackup(`Automatisch vor hartem Materialdatenbank-Leeren durch ${req.user.name}`);
  } catch (error) {
    return res.status(500).json({ error: `Backup konnte vor dem Löschen nicht erstellt werden: ${error.message}` });
  }

  try {
    const result = clearOperationalDatabaseForAdmin(req.user, backup, { materialCount, activeCount, archivedCount, orderCount, inventoryCount, activityCount });
    if (result.remainingMaterials || result.remainingOrders || result.remainingInventories) {
      return res.status(500).json({ error: `Datenbankprüfung fehlgeschlagen: ${result.remainingMaterials} Materialien, ${result.remainingOrders} Bestellungen, ${result.remainingInventories} Inventuren sind noch vorhanden.` });
    }
    emitToAll('state:changed', { reason: 'materials:delete-all-hard', version: PROGRAM_VERSION });
    return res.json({
      ok: true,
      version: PROGRAM_VERSION,
      deletedMaterials: materialCount,
      activeMaterials: activeCount,
      archivedMaterials: archivedCount,
      deletedOrders: orderCount,
      deletedInventories: inventoryCount,
      removedMaterialActivities: activityCount,
      remainingMaterials: result.remainingMaterials,
      remainingOrders: result.remainingOrders,
      remainingInventories: result.remainingInventories,
      backup,
      dbFile
    });
  } catch (error) {
    return res.status(500).json({ error: `Datenbank konnte nicht geleert werden: ${error.message}` });
  }
});

app.post('/api/materials/import-table', requireAuth, allowRoles('ADMIN'), (req, res) => {
  try {
    const { created, merged, activity } = importMaterialsFromText(req.body.table || req.body.csv || '', req.user, { mode: req.body.mode });
    emitToAll('material:created', { activity, message: `${created.length} Materialien aus Tabelle importiert`, targetRoles: ['LASER', 'BUERO', 'CHEF', 'ADMIN'] });
    emitToAll('state:changed', { reason: 'materials:import-table', version: PROGRAM_VERSION });
    res.status(201).json({ created: created.length, merged: merged.length, version: PROGRAM_VERSION });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Tabellenimport fehlgeschlagen.' });
  }
});

app.post('/api/admin/import/materials', requireAuth, allowRoles('ADMIN'), (req, res) => {
  try {
    const { created, merged, activity } = importMaterialsFromText(req.body.csv || req.body.table || '', req.user);
    emitToAll('material:created', { activity, message: `${created.length} Materialien importiert`, targetRoles: ['ADMIN'] });
    emitToAll('state:changed', { reason: 'materials:imported', version: PROGRAM_VERSION });
    res.status(201).json({ created: created.length, merged: merged.length, version: PROGRAM_VERSION });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Import fehlgeschlagen.' });
  }
});

app.patch('/api/admin/settings', requireAuth, allowRoles('ADMIN'), (req, res) => {
  const settings = normalizeSettings({
    ...(db.settings || {}),
    standardStrengths: normalizeStrengthList(req.body.standardStrengths || (db.settings && db.settings.standardStrengths) || DEFAULT_STANDARD_STRENGTHS),
    autoBackupOnStart: req.body.autoBackupOnStart,
    inventoryLastDate: req.body.inventoryLastDate === undefined ? (db.settings && db.settings.inventoryLastDate) : req.body.inventoryLastDate,
    inventoryIntervalMonths: req.body.inventoryIntervalMonths === undefined ? (db.settings && db.settings.inventoryIntervalMonths) : req.body.inventoryIntervalMonths
  });
  settings.updatedAt = nowIso();
  db.settings = settings;
  const activity = addActivity('SYSTEM', `${req.user.name} hat Admin-Einstellungen gespeichert.`, req.user);
  saveDb();
  emitToAll('state:changed', { reason: 'settings:updated' });
  res.json({ settings, activity });
});

io.on('connection', (socket) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const user = getUserFromToken(token);
  if (!user) {
    socket.emit('auth:error', { error: 'Nicht angemeldet.' });
    socket.disconnect(true);
    return;
  }
  socket.join(user.role);
  socket.emit('connected', { user: publicUser(user), at: nowIso() });
});


app.get('/healthz', (req, res) => {
  res.json({ ok: true, version: PROGRAM_VERSION, storage: pgPool ? 'postgres' : 'file', mode: SERVER_MODE, publicExists: fs.existsSync(publicDir), indexExists: fs.existsSync(indexFile), at: nowIso() });
});

app.get('/api/system/storage', requireAuth, allowRoles('ADMIN'), (req, res) => {
  res.json({ storage: pgPool ? 'Online-Datenbank' : 'Datei-Datenbank', postgres: Boolean(pgPool), render: Boolean(process.env.RENDER), version: PROGRAM_VERSION });
});

app.get('*', (req, res) => {
  sendFrontend(req, res);
});

async function startServer() {
  try {
    db = await loadDbAsync();
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`${APP_NAME} Server läuft auf http://localhost:${PORT}`);
      if (process.env.RENDER_EXTERNAL_URL) console.log(`Render-Adresse: ${process.env.RENDER_EXTERNAL_URL}`);
      const urls = networkUrls();
      if (urls.length) {
        console.log('Im Netzwerk öffnen:');
        urls.forEach(url => console.log(`  ${url}`));
      } else {
        console.log(`Im Netzwerk öffnen: http://<SERVER-IP>:${PORT}`);
      }
    });
  } catch (error) {
    console.error('Server konnte nicht gestartet werden:', error);
    process.exit(1);
  }
}

startServer();
