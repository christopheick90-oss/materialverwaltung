const CLIENT_VERSION = '2.4';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let token = localStorage.getItem('eckl_token') || null;
let currentUser = null;
let state = null;
let currentPage = 'dashboard';
let socket = null;
let materialFilter = { text: '', status: 'all', shelf: 'all', format: 'all', storage: 'all', sort: 'none' };
let materialDrawTimer = null;
let materialSearchComposing = false;
let adminMaterialEditFilter = '';
let orderFilter = { text: '', status: 'all' };
let writtenOffFilter = { text: '' };
let inventoryHistoryFilter = { text: '', date: '' };
let withdrawalHistoryFilter = { text: '' };
let lastTypingAt = 0;

const roleNames = { LASER: 'Laser', BUERO: 'Büro', CHEF: 'Chef', ADMIN: 'System' };
const statusNames = { ANGEFORDERT: 'Angefordert', FREIGEGEBEN: 'Freigegeben', BESTELLT: 'Bestellt', TEILGELIEFERT: 'Bestellt', ABGELEHNT: 'Abgelehnt', ERLEDIGT: 'Geliefert' };
const storageNames = { HAUPTLAGER: 'Hauptlager', KONSI: 'Konsi-Lager' };
const defaultShelves = ['Regal 1', 'Regal 2', 'Regal 3', 'Regal 4', 'Regal 5', 'Regal 6', 'Carport', 'Bodenhaltung'];
const defaultKonsiLocation = 'Garage';
const inventoryRequiredAreas = [...defaultShelves, 'KONSI'];
const materialFormats = ['4000x2000', '3000x1500', '2500x1250', '2000x1000'];
const SPECIAL_FORMAT_FILTER = '__SPECIAL_FORMATS__';
const CUSTOM_FORMAT_VALUE = '__CUSTOM_FORMAT__';
const DEFAULT_MATERIAL_MIN_STOCK = 2;

const pages = [
  { id: 'dashboard', label: 'Dashboard', roles: ['LASER','BUERO','CHEF','ADMIN'] },
  { id: 'materials', label: 'Material', roles: ['LASER','BUERO','CHEF','ADMIN'] },
  { id: 'konsi', label: 'Konsi-Lager', roles: ['LASER','BUERO','CHEF','ADMIN'] },
  { id: 'inventory', label: 'Inventur', roles: ['LASER','BUERO','CHEF','ADMIN'] },
  { id: 'orders', label: 'Bestellungen', roles: ['LASER','BUERO','CHEF','ADMIN'] },
  { id: 'writtenOff', label: 'Ausgebucht', roles: ['LASER','BUERO','CHEF','ADMIN'] },
  { id: 'history', label: 'Historie', roles: ['LASER','BUERO','CHEF','ADMIN'] },
  { id: 'admin', label: 'Verwaltung', roles: ['ADMIN'] },
  { id: 'admin', label: 'Chef-Übersicht', roles: ['CHEF'] },
  { id: 'adminMaterials', label: 'Materialpflege', roles: ['ADMIN'], adminSubpage: true },
  { id: 'users', label: 'Benutzer & Rollen', roles: ['ADMIN'], adminSubpage: true },
  { id: 'adminSettings', label: 'Einstellungen & Rechte', roles: ['ADMIN'], adminSubpage: true },
  { id: 'adminBackup', label: 'Backup & Wiederherstellung', roles: ['ADMIN'], adminSubpage: true },
  { id: 'adminImportExport', label: 'Import & Export', roles: ['ADMIN'], adminSubpage: true },
  { id: 'adminArchive', label: 'Archiv', roles: ['ADMIN'], adminSubpage: true },
  { id: 'adminLog', label: 'Systemprotokoll', roles: ['ADMIN'], adminSubpage: true }
];

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  }).then(async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Unbekannter Fehler.');
      Object.assign(error, data);
      error.status = response.status;
      throw error;
    }
    return data;
  });
}

function fmtDate(iso) {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

function fmtDateOnly(dateOnly) {
  if (!dateOnly) return '-';
  const parts = String(dateOnly).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return '-';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(parts[0], parts[1] - 1, parts[2]));
}

function formatKgPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(2).replace('.', ',')} €/kg`;
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(2).replace('.', ',')} €`;
}

function canSeePrices() {
  return Boolean(state && state.permissions && state.permissions.canManagePrices);
}

function orderPriceLine(order) {
  if (!canSeePrices()) return '';
  const parts = [];
  if (order.kgPrice !== undefined && order.kgPrice !== null && order.kgPrice !== '') parts.push(`KG-Preis: ${formatKgPrice(order.kgPrice)}`);
  if (Number(order.totalWeightKg) > 0) parts.push(`Gewicht: ${String(Number(order.totalWeightKg).toFixed(1)).replace('.', ',')} kg`);
  if (Number(order.totalPrice) > 0) parts.push(`Wert: ${formatMoney(order.totalPrice)}`);
  return parts.length ? `<div class="small muted price-line">${parts.map(escapeHtml).join(' · ')}</div>` : '';
}

function materialPriceLine(material) {
  if (!canSeePrices()) return '';
  return material && material.kgPrice !== undefined && material.kgPrice !== null && material.kgPrice !== ''
    ? `<div><span>KG-Preis</span><strong>${escapeHtml(formatKgPrice(material.kgPrice))}</strong></div>`
    : `<div><span>KG-Preis</span><strong>-</strong></div>`;
}

function inventoryTimerText(schedule) {
  if (!schedule) return 'Nicht eingerichtet';
  const days = Number(schedule.daysUntil);
  if (!Number.isFinite(days)) return 'Nicht eingerichtet';
  if (days < 0) return `überfällig seit ${Math.abs(days)} Tag(en)`;
  if (days === 0) return 'heute fällig';
  return `in ${days} Tag(en)`;
}

function inventoryTimerStatusClass(schedule) {
  if (!schedule) return 'gray';
  const days = Number(schedule.daysUntil);
  if (days <= 0) return 'red';
  if (days <= 14) return 'amber';
  return 'green';
}

function renderInventoryTimerCard(compact = false) {
  const schedule = state && state.inventorySchedule;
  if (!schedule) return '';
  return `
    <div class="stat inventory-next-stat ${compact ? 'compact' : ''}">
      <span>Nächste Inventur</span>
      <strong>${fmtDateOnly(schedule.nextDate)}</strong>
    </div>
  `;
}


function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[c]));
}

function jsString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function parsePackageNumbers(value) {
  // Konsi-Paketnummern dürfen bewusst doppelt vorkommen.
  // Beispiel: mehrere Pakete mit gleicher Nummer werden als einzelne Pakete gezählt.
  return String(value || '')
    .split(/[\n,;]+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function normalizeThicknessInput(value) {
  const text = String(value || '').trim();
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


function smartTitleWord(word) {
  const text = String(word || '');
  if (!text) return '';
  if (/^[A-ZÄÖÜ0-9._+-]+$/.test(text) && /[A-ZÄÖÜ]/.test(text)) return text;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function normalizeMaterialNumberInput(value) {
  let text = String(value || '');
  const knownCompact = {
    '14301': '1.4301', '4301': '1.4301',
    '14404': '1.4404', '4404': '1.4404',
    '14571': '1.4571', '4571': '1.4571',
    '14541': '1.4541', '4541': '1.4541',
    '14016': '1.4016', '4016': '1.4016'
  };
  text = text
    .replace(/\b([1-9])\s*[,\.]\s*(\d{4})\b/g, '$1.$2')
    .replace(/\b1[\s.,-]*(\d{4})\b/g, '1.$1');
  text = text.replace(/(^|[^0-9.,])(1?4(?:301|404|571|541|016))(?=$|[^0-9.,])/g, (match, prefix, code) => `${prefix}${knownCompact[code] || code}`);
  return text;
}

function normalizeMaterialCaseInput(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  let text = normalizeMaterialNumberInput(raw);
  const knownWords = { aluminium: 'Aluminium', alu: 'Alu', edelstahl: 'Edelstahl', stahl: 'Stahl', kupfer: 'Kupfer', messing: 'Messing', verzinkt: 'Verzinkt', schwarz: 'Schwarz', blank: 'Blank', rest: 'Rest' };
  text = text.split(' ').map(part => {
    const key = part.toLowerCase();
    return knownWords[key] || part;
  }).join(' ');
  text = text.replace(/\bal\s*mg\s*(\d+)\b/gi, 'AlMg$1');
  text = text.replace(/\balmg\s*(\d+)\b/gi, 'AlMg$1');
  text = text.replace(/\bal\s*mg\s*si\s*(\d+)\b/gi, 'AlMgSi$1');
  text = text.replace(/\balmgsi\s*(\d+)\b/gi, 'AlMgSi$1');
  text = text.replace(/\bv\s*([24])\s*a\b/gi, 'V$1A');
  text = text.replace(/\bdc\s*(\d{2})\b/gi, 'DC$1');
  text = text.replace(/\bdd\s*(\d{2})\b/gi, 'DD$1');
  text = text.replace(/\bdx\s*(\d{2})\s*d\b/gi, 'DX$1D');
  text = text.replace(/\bs\s*(\d{3})\b/gi, 'S$1');
  text = text.replace(/\bc\s*(\d{2})\b/gi, 'C$1');
  text = text.replace(/\b(\d\.\d{4})\b/g, '$1');
  return text.split(' ').map(part => {
    if (/^(AlMg\d+|AlMgSi\d+|V[24]A|DC\d{2}|DD\d{2}|DX\d{2}D|S\d{3}|C\d{2}|\d\.\d{4})$/i.test(part)) {
      return part
        .replace(/^almg(\d+)$/i, 'AlMg$1')
        .replace(/^almgsi(\d+)$/i, 'AlMgSi$1')
        .replace(/^v([24])a$/i, 'V$1A')
        .replace(/^dc(\d{2})$/i, 'DC$1')
        .replace(/^dd(\d{2})$/i, 'DD$1')
        .replace(/^dx(\d{2})d$/i, 'DX$1D')
        .replace(/^s(\d{3})$/i, 'S$1')
        .replace(/^c(\d{2})$/i, 'C$1');
    }
    return part.split(/([\-/+])/).map(segment => /[\-/+]/.test(segment) ? segment : smartTitleWord(segment)).join('');
  }).join(' ');
}

function normalizeArticleNumberInput(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function attachAutoCase(inputSelector, normalizer) {
  const input = $(inputSelector);
  if (!input || typeof normalizer !== 'function') return;
  input.addEventListener('blur', () => {
    input.value = normalizer(input.value);
  });
}

function attachThicknessAutoFormat(inputSelector, previewSelector = '') {
  const input = $(inputSelector);
  if (!input) return;
  const updatePreview = () => {
    const preview = previewSelector ? $(previewSelector) : null;
    if (!preview) return;
    const normalized = normalizeThicknessInput(input.value);
    preview.textContent = normalized ? `Wird gespeichert als: ${normalized}` : 'Beispiel: 2,00 mm oder 2,50 mm';
  };
  input.addEventListener('input', updatePreview);
  input.addEventListener('blur', () => {
    input.value = normalizeThicknessInput(input.value);
    updatePreview();
  });
  updatePreview();
}

function normalizeFormatValue(value, fallback = '3000x1500') {
  const raw = String(value || '').trim();
  if (!raw || raw === CUSTOM_FORMAT_VALUE) return fallback;
  const text = raw.toLowerCase().replace(/\s+/g, '').replace('×', 'x').replace('*', 'x');
  const match = text.match(/(\d{3,5})x(\d{3,5})/);
  if (match) return `${match[1]}x${match[2]}`;
  return fallback;
}

function isStandardFormatValue(value) {
  const normalized = normalizeFormatValue(value, '');
  return materialFormats.includes(normalized);
}

function formatDisplayValue(value) {
  return normalizeFormatValue(value, String(value || '').trim());
}

function readFormatControls(selectSelector, customSelector) {
  const select = $(selectSelector);
  const custom = $(customSelector);
  if (!select) return '3000x1500';
  if (select.value === CUSTOM_FORMAT_VALUE) {
    return normalizeFormatValue(custom ? custom.value : '', '3000x1500');
  }
  return normalizeFormatValue(select.value, '3000x1500');
}


function setFormatSelectValue(selector, value) {
  const select = $(selector);
  if (!select) return;
  const normalized = normalizeFormatValue(value, '3000x1500');
  const exists = Array.from(select.options || []).some(option => option.value === normalized);
  if (!exists) select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(normalized)}">${escapeHtml(normalized)} · Sonderformat</option>`);
  select.value = normalized;
}

function attachFormatControls(selectSelector, customRowSelector, customInputSelector, previewSelector = '') {
  const select = $(selectSelector);
  const row = $(customRowSelector);
  const input = $(customInputSelector);
  const preview = previewSelector ? $(previewSelector) : null;
  if (!select || !row || !input) return;
  const update = () => {
    const custom = select.value === CUSTOM_FORMAT_VALUE;
    row.classList.toggle('hidden', !custom);
    const normalized = custom ? normalizeFormatValue(input.value, '') : normalizeFormatValue(select.value, '');
    if (preview) preview.textContent = normalized ? `Wird gespeichert als: ${normalized}` : 'Beispiel: 1000 x 1000';
  };
  select.addEventListener('change', update);
  input.addEventListener('input', update);
  input.addEventListener('blur', () => {
    input.value = normalizeFormatValue(input.value, input.value);
    update();
  });
  update();
}

function normalizeSearchText(value) {
  return normalizeMaterialNumberInput(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss');
}

const searchAliasGroups = [
  ['almg3', 'alm g3', 'alu', 'aluminium', 'aluminum'],
  ['1.4301', '14301', 'v2a', 'edelstahl', 'niro', 'inox', 'rostfrei'],
  ['1.4404', '14404', 'v4a', 'edelstahl', 'niro', 'inox', '316l'],
  ['1.4571', '14571', 'v4a', 'edelstahl', 'niro', 'inox', '316ti']
];

function baseSearchVariants(value) {
  const plain = normalizeSearchText(value);
  const compact = plain.replace(/[^a-z0-9]+/g, '');
  return [plain, compact].filter(Boolean);
}

function searchVariants(value) {
  const variants = new Set(baseSearchVariants(value));
  const current = Array.from(variants);
  searchAliasGroups.forEach(group => {
    const normalizedGroup = group.flatMap(item => baseSearchVariants(item));
    const hasMatch = normalizedGroup.some(alias => current.some(v => v.includes(alias)));
    if (hasMatch) normalizedGroup.forEach(alias => variants.add(alias));
  });
  return Array.from(variants).filter(Boolean);
}

function searchTextVariants(value) {
  return searchVariants(value).join(' ');
}

function querySearchVariants(value) {
  return baseSearchVariants(value);
}

function searchMatches(haystack, query) {
  const raw = String(query || '').trim();
  if (!raw) return true;
  const hay = searchTextVariants(haystack);
  return raw.split(/\s+/).filter(Boolean).every(part =>
    querySearchVariants(part).some(needle => hay.includes(needle))
  );
}


function searchTokens(query) {
  return String(query || '').trim().split(/\s+/).filter(Boolean);
}

function normalizeSearchNumber(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s*mm\s*$/i, '')
    .replace(',', '.')
    .trim();
}

function isLikelyThicknessSearchToken(value) {
  const token = normalizeSearchNumber(value);
  if (!token) return false;
  const compactOriginal = String(value || '').toLowerCase().replace(/\s+/g, '').replace(',', '.');
  // Werkstoffnummern wie 1.4301 / 1.4404 / 1.4571 und Teil-Eingaben wie 4571
  // sollen Material-Synonyme bleiben und nicht als Stärke gesucht werden.
  if (/^1\.\d{2,4}$/.test(compactOriginal) || /^1?4(?:301|404|571|541|016)$/.test(compactOriginal.replace('.', ''))) return false;
  if (/^\d+$/.test(token)) return Number(token) <= 50;
  const decimalMatch = token.match(/^\d+\.(\d+)$/);
  if (!decimalMatch) return false;
  return decimalMatch[1].length <= 2 && Number(token) <= 50;
}

function materialThicknessMatchesToken(material, token) {
  const queryNumber = normalizeSearchNumber(token);
  if (!queryNumber) return false;
  const thicknessNumber = parseMillimeters(material && material.thickness);
  if (!thicknessNumber) return false;
  if (queryNumber.includes('.')) {
    return Math.abs(thicknessNumber - Number(queryNumber)) < 0.0001;
  }
  // Suche "1" bedeutet: 1 mm, 1,5 mm, 1,25 mm usw. – aber nicht 10 mm oder Format 3000x1500.
  return Math.floor(thicknessNumber) === Number(queryNumber);
}

function materialSearchMatches(material, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const hay = searchTextVariants(materialSearchText(material));
  return tokens.every(token => {
    const materialTextMatch = querySearchVariants(token).some(needle => hay.includes(needle));
    if (isLikelyThicknessSearchToken(token)) {
      return materialThicknessMatchesToken(material, token);
    }
    return materialTextMatch;
  });
}

function materialSearchText(material) {
  return [
    material && material.name,
    material && material.thickness,
    material && material.format,
    material && material.category,
    material && material.type,
    material && material.unit,
    material && material.supplier,
    material && material.articleNumber,
    material && material.note,
    material && quantityLabel(material),
    material && material.stock,
    material && material.sheetStock,
    material && material.packageStock,
    material && material.shelf,
    material && material.storage,
    material && storageLabel(material),
    material && materialStatus(material).label,
    material && Array.isArray(material.packageNumbers) ? material.packageNumbers.join(' ') : ''
  ].join(' ');
}

function parseMillimeters(value) {
  const match = String(value || '').replace(',', '.').match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : 0;
}

function parseFormatSize(value) {
  const text = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  const match = text.match(/(\d{3,4})[x×](\d{3,4})/);
  return match ? { lengthMm: Number(match[1]), widthMm: Number(match[2]) } : null;
}

function densitySearchText(material) {
  return `${material?.name || ''} ${material?.category || ''} ${material?.type || ''} ${material?.articleNumber || ''} ${material?.note || ''}`
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
  const size = parseFormatSize(material?.format);
  const thickness = parseMillimeters(material?.thickness);
  if (!size || !thickness) return 0;
  return (size.lengthMm / 1000) * (size.widthMm / 1000) * thickness * densityFactorForMaterial(material);
}

function estimatedSheetsFromWeight(material, packageWeightKg, packages) {
  const oneSheet = sheetWeightKg(material);
  const weight = Number(packageWeightKg) || 0;
  const count = Math.max(0, Math.floor(Number(packages) || 0));
  if (!oneSheet || !weight || !count) return 0;
  return Math.max(0, Math.round((weight * count) / oneSheet));
}

function weightInfoText(material) {
  const oneSheet = sheetWeightKg(material);
  if (!oneSheet) return 'Automatische Tafelberechnung nicht möglich, wenn Stärke oder Größe fehlen.';
  const density = densityInfoForMaterial(material);
  return `ca. ${oneSheet.toFixed(1).replace('.', ',')} kg pro Tafel · ${density.label}, ${String(density.factor).replace('.', ',')} kg/dm³`;
}

function sheetWeightShortText(material) {
  const oneSheet = sheetWeightKg(material);
  if (!oneSheet) return '-';
  return `ca. ${oneSheet.toFixed(1).replace('.', ',')} kg/Tafel`;
}

function formatOptions(selected = '', includeCustom = false) {
  const active = normalizeFormatValue(selected, '');
  const custom = active && !materialFormats.includes(active);
  const standardOptions = materialFormats.map(format => `<option value="${escapeHtml(format)}" ${format === active ? 'selected' : ''}>${escapeHtml(format)}</option>`).join('');
  if (includeCustom) return standardOptions + `<option value="${CUSTOM_FORMAT_VALUE}" ${custom ? 'selected' : ''}>Sonderformat</option>`;
  return standardOptions + (custom ? `<option value="${escapeHtml(active)}" selected>${escapeHtml(active)} · Sonderformat</option>` : '');
}

function statusBadge(status) {
  const map = { ANGEFORDERT:'red', FREIGEGEBEN:'amber', BESTELLT:'green', TEILGELIEFERT:'green', ABGELEHNT:'gray', ERLEDIGT:'green' };
  return `<span class="badge ${map[status] || 'gray'}">${statusNames[status] || status}</span>`;
}

function materialHasPackageUnit(material) {
  const text = [material?.unit, material?.type, material?.category].map(v => String(v || '').toLowerCase()).join(' ');
  return text.includes('paket');
}

function materialSheetStock(material) {
  return Math.max(0, Number(material?.sheetStock ?? material?.stock ?? 0) || 0);
}

function materialUsesSheetMinimum(material) {
  if (!material) return false;
  if (material.rest) return false;
  if (material.storage === 'KONSI') return false;
  if (materialHasPackageUnit(material) && materialSheetStock(material) <= 0) return false;
  return true;
}

function materialMinStock(material) {
  return materialUsesSheetMinimum(material) ? DEFAULT_MATERIAL_MIN_STOCK : 0;
}

function materialIsLow(material) {
  return materialUsesSheetMinimum(material) && !material.deliveryPending && materialSheetStock(material) <= DEFAULT_MATERIAL_MIN_STOCK;
}

function materialStatus(material) {
  if (material.deliveryPending) return { key: 'delivered', label: 'Geliefert', cls: 'green' };
  if (material.rest) return { key: 'rest', label: 'Resttafel', cls: 'gray' };
  if (Number(material.stock) <= 0) return { key: 'empty', label: 'Leer', cls: 'red' };
  if (materialIsLow(material)) return { key: 'low', label: 'Warnung', cls: 'amber' };
  return { key: 'ok', label: 'OK', cls: 'green' };
}

function materialStatusBadge(material) {
  const s = materialStatus(material);
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

function materialHasActiveOrderClient(material) {
  if (!material) return false;
  const activeStatuses = ['ANGEFORDERT', 'FREIGEGEBEN', 'BESTELLT', 'TEILGELIEFERT'];
  return (state.orders || []).some(order => order.materialId === material.id && activeStatuses.includes(order.status));
}

function materialDeleteBlockReasonClient(material) {
  if (!material) return 'Material wurde nicht gefunden.';
  if (materialHasActiveOrderClient(material)) return 'Dazu gibt es noch eine offene Bestellung.';
  if (!isEmptyMaterialClient(material)) return 'Dieses Material hat noch Bestand. Löschen ist erst bei Bestand 0 erlaubt.';
  return '';
}

function materialCanDeleteWithoutOrderClient(material) {
  return !materialDeleteBlockReasonClient(material);
}

function storageLabel(material) {
  return storageNames[material.storage || 'HAUPTLAGER'] || 'Hauptlager';
}

function konsiLocation() {
  return (state && state.konsiLocation) || defaultKonsiLocation;
}

function materialLocationLabel(material) {
  return isKonsi(material) ? konsiLocation() : (material && material.shelf ? material.shelf : '-');
}

function isKonsi(material) {
  return material && material.storage === 'KONSI';
}

function materialCountValueClient(material) {
  return (Number(material && material.stock) || 0)
    + (Number(material && material.sheetStock) || 0)
    + (Number(material && material.packageStock) || 0)
    + (Array.isArray(material && material.packageNumbers) ? material.packageNumbers.length : 0);
}

function isEmptyMaterialClient(material) {
  return materialCountValueClient(material) <= 0;
}

function quantityLabel(material) {
  if (isKonsi(material)) {
    const packages = Number(material.stock) || 0;
    return `${packages} Pakete`;
  }
  const packages = Number(material.packageStock) || 0;
  const deliveredPackages = Number(material?.deliveredPackageCount) || (material?.deliveryPending ? packages : 0);
  const sheets = Number(material.sheetStock ?? material.stock) || 0;
  if (material?.deliveryPending && deliveredPackages > 0 && sheets > 0) return `${deliveredPackages} Pakete = ${sheets} Tafeln`;
  if (packages > 0) return `${packages} Pakete${sheets ? ` + ${sheets} Tafeln` : ''}`;
  return `${sheets} ${escapeHtml(material.unit || 'Tafeln')}`;
}


function materialCardQuantityLabel(material) {
  if (isKonsi(material)) {
    const packages = Number(material.stock) || 0;
    return `${packages} Pakete`;
  }
  const packages = Number(material.packageStock) || 0;
  const deliveredPackages = Number(material?.deliveredPackageCount) || (material?.deliveryPending ? packages : 0);
  const sheets = Number(material.sheetStock ?? material.stock) || 0;
  // Bei Wareneingang die Paketanzahl sichtbar lassen, auch wenn intern nur Tafeln verräumt werden.
  if (material?.deliveryPending && deliveredPackages > 0 && sheets > 0) return `${deliveredPackages} Pakete = ${sheets} Tafeln`;
  if (material?.deliveryPending && deliveredPackages > 0) return `${deliveredPackages} Pakete`;
  if (packages > 0) return `${packages} Pakete${sheets ? ` + ${sheets} Tafeln` : ''}`;
  return `${sheets} ${escapeHtml(material.unit || 'Tafeln')}`;
}

function orderQuantityLabel(order, type = 'request') {
  const amount = Number(type === 'ordered' ? order.orderedAmount : (type === 'received' ? order.receivedAmount : order.requestedAmount)) || 0;
  const sheets = Number(type === 'ordered' ? order.orderedSheets : (type === 'received' ? order.receivedSheets : order.requestedSheets)) || 0;
  if (order.storage === 'KONSI') return `${amount || 0} Pakete`;
  if (type === 'received' && amount > 0 && sheets > 0) return `${amount} Pakete = ${sheets} Tafeln`;
  if (amount > 0 && sheets > 0) return `${amount} Pakete + ${sheets} Tafeln`;
  if (sheets > 0) return `${sheets} Tafeln`;
  return `${amount || 0} Pakete`;
}

function orderMaterial(order) {
  return (state.materials || []).find(m => m.id === order.materialId) || null;
}

function orderFormatLabel(order) {
  const material = orderMaterial(order);
  return order.materialFormat || order.format || (material && material.format) || '';
}

function orderThicknessLabel(order) {
  const material = orderMaterial(order);
  return order.materialThickness || order.thickness || (material && material.thickness) || '';
}

function orderMaterialTitle(order) {
  const name = String(order && order.materialName ? order.materialName : '').trim();
  const thickness = normalizeThicknessInput(orderThicknessLabel(order) || '').trim();
  if (!thickness) return name || 'Material';
  const lowerName = name.toLowerCase().replace(/\s+/g, ' ');
  const lowerThickness = thickness.toLowerCase();
  if (lowerName.includes(lowerThickness)) return name || 'Material';
  const numberOnly = lowerThickness.replace(/\s*mm$/i, '').trim();
  if (numberOnly) {
    const variants = Array.from(new Set([
      numberOnly,
      numberOnly.replace(',', '.'),
      numberOnly.replace('.', ',')
    ].filter(Boolean)));
    if (variants.some(v => lowerName.includes(`${v} mm`) || lowerName.includes(`${v}mm`))) return name || 'Material';
  }
  return `${name || 'Material'} ${thickness}`;
}

function orderThicknessLine(order) {
  const thickness = orderThicknessLabel(order);
  return thickness ? `<div class="order-material-strength"><strong>Stärke: ${escapeHtml(thickness)}</strong></div>` : '';
}

function orderDimensionLine(order) {
  const format = orderFormatLabel(order);
  return format ? `<br><span class="small muted">Maße: ${escapeHtml(format)}</span>` : '';
}

function shelfOptions(selected = '') {
  const shelves = (state && state.shelfOptions && state.shelfOptions.length) ? state.shelfOptions : defaultShelves;
  return shelves.map(shelf => `<option value="${escapeHtml(shelf)}" ${shelf === selected ? 'selected' : ''}>${escapeHtml(shelf)}</option>`).join('');
}

function orderFlow(status) {
  if (status === 'ABGELEHNT') return `<div class="status-flow"><span class="flow-step active">Abgelehnt</span></div>`;
  const normalizedStatus = status === 'TEILGELIEFERT' ? 'BESTELLT' : status;
  const order = ['ANGEFORDERT','BESTELLT','ERLEDIGT'];
  const activeIndex = order.includes(normalizedStatus) ? order.indexOf(normalizedStatus) : 0;
  return `<div class="status-flow">${order.map((step, i) => {
    const cls = i < activeIndex ? 'done' : (i === activeIndex ? 'active' : '');
    return `${i ? '<span class="flow-arrow">→</span>' : ''}<span class="flow-step ${cls}">${statusNames[step]}</span>`;
  }).join('')}</div>`;
}
function showToast(title, message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong><div>${escapeHtml(message)}</div><small>${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</small>`;
  $('#toastArea').appendChild(toast);
  setTimeout(() => toast.remove(), 6500);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body: message }); } catch (_) {}
  }
}

function currentServerLabel() {
  const host = window.location.host || 'lokal';
  return host;
}

function connectionText(base) {
  return `${base} · ${currentServerLabel()}`;
}

function setConnection(online, text) {
  $('#connectionDot').className = `dot ${online ? 'online' : 'offline'}`;
  $('#connectionText').textContent = connectionText(text || (online ? 'Verbunden' : 'Getrennt'));
}

function openModal(html) {
  $('#modalInner').innerHTML = html;
  $('#modal').classList.add('active');
}

function closeModal() {
  $('#modal').classList.remove('active');
  $('#modalInner').innerHTML = '';
}

let pendingLiveRefresh = false;
function activeInputElement() {
  const el = document.activeElement;
  if (!el) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
}
function markTypingActivity(event) {
  const el = event && event.target;
  if (!el) return;
  if (['INPUT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable) lastTypingAt = Date.now();
}
['input', 'keydown', 'paste', 'compositionstart'].forEach(type => document.addEventListener(type, markTypingActivity, true));
function shouldDelayAutoRefresh() {
  const modalOpen = $('#modal') && $('#modal').classList.contains('active');
  const recentlyTyped = Date.now() - lastTypingAt < 1500;
  return activeInputElement() || recentlyTyped || modalOpen;
}
async function safeLiveRefresh() {
  if (shouldDelayAutoRefresh()) {
    pendingLiveRefresh = true;
    return;
  }
  pendingLiveRefresh = false;
  await loadState(true);
}
function flushPendingLiveRefresh() {
  setTimeout(() => {
    if (pendingLiveRefresh && !shouldDelayAutoRefresh()) safeLiveRefresh();
  }, 120);
}
document.addEventListener('focusout', flushPendingLiveRefresh, true);
document.addEventListener('change', flushPendingLiveRefresh, true);

$('#modal').addEventListener('click', (event) => {
  if (event.target.id === 'modal') closeModal();
});

async function loadState(silent = false) {
  try {
    const nextState = await api('/api/state');
    state = nextState;
    currentUser = state.user;
    if (silent && shouldDelayAutoRefresh()) {
      pendingLiveRefresh = true;
      if (!silent) setConnection(true, 'Verbunden');
      return;
    }
    renderApp();
    if (!silent) setConnection(true, 'Verbunden');
  } catch (error) {
    if (!silent) showToast('Fehler', error.message);
    if (error.message.includes('angemeldet')) logoutLocal();
  }
}

function renderApp() {
  if (!state || !currentUser) return;
  $('#loginScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#profileName').textContent = currentUser.name;
  $('#roleBadge').textContent = currentUser.role === 'ADMIN' ? '' : (roleNames[currentUser.role] || currentUser.role);
  if ($('#appVersion')) $('#appVersion').textContent = `Version ${state.version || CLIENT_VERSION}`;
  if ($('#serverModeBadge')) {
    const mode = (state.systemStatus && state.systemStatus.serverMode) || state.serverMode || 'Test';
    const label = mode === 'client' ? 'Client' : (mode === 'server' ? 'Server' : 'Lokal');
    $('#serverModeBadge').textContent = `${label}: ${currentServerLabel()}`;
  }
  renderNav();
  renderCurrentPage();
  if (currentUser.mustChangePassword) setTimeout(() => openChangePasswordModal(true), 200);
}

function renderNav() {
  const pendingForOffice = state.orders.filter(o => ['ANGEFORDERT','BESTELLT','TEILGELIEFERT'].includes(o.status)).length;
  const myOpen = state.orders.filter(o => ['ANGEFORDERT','BESTELLT','TEILGELIEFERT'].includes(o.status)).length;
  const warnings = state.lowMaterials.length;
  const currentDefinition = pages.find(p => p.id === currentPage && p.roles.includes(currentUser.role));
  const activeMainPage = currentDefinition && currentDefinition.adminSubpage ? 'admin' : currentPage;
  $('#nav').innerHTML = pages
    .filter(p => p.roles.includes(currentUser.role) && !p.adminSubpage)
    .map(p => {
      const count = p.id === 'orders'
        ? (currentUser.role === 'LASER' ? myOpen : pendingForOffice)
        : (p.id === 'materials' ? warnings
          : (p.id === 'konsi' ? state.materials.filter(m => m.storage === 'KONSI').length
            : (p.id === 'writtenOff' ? ((state.writtenOffMaterials || []).length) : 0)));
      return `<button data-page="${p.id}" class="${activeMainPage === p.id ? 'active' : ''}">${p.label}${count ? `<span class="count">${count}</span>` : ''}</button>`;
    }).join('');

  $$('#nav button').forEach(btn => btn.addEventListener('click', () => {
    currentPage = btn.dataset.page;
    renderCurrentPage();
  }));
}

function renderCurrentPage() {
  if (!pages.some(p => p.id === currentPage && p.roles.includes(currentUser.role))) currentPage = 'dashboard';
  $$('.section').forEach(s => s.classList.remove('active'));
  const section = $(`#${currentPage}`);
  if (!section) return;
  section.classList.add('active');
  const page = pages.find(p => p.id === currentPage && p.roles.includes(currentUser.role));
  $('#pageTitle').textContent = page && page.adminSubpage ? `Verwaltung · ${page.label}` : (page ? page.label : 'Dashboard');
  $('#pageSubtitle').textContent = subtitleForPage(currentPage);
  if (currentPage === 'dashboard') renderDashboard();
  if (currentPage === 'materials') renderMaterials();
  if (currentPage === 'konsi') renderKonsi();
  if (currentPage === 'inventory') renderInventory();
  if (currentPage === 'orders') renderOrders();
  if (currentPage === 'writtenOff') renderWrittenOff();
  if (currentPage === 'history') renderHistory();
  if (currentPage === 'admin') renderSystem();
  if (currentPage === 'adminMaterials') renderSystemMaterials();
  if (currentPage === 'users') renderUsers();
  if (currentPage === 'adminSettings') renderSystemSettings();
  if (currentPage === 'adminBackup') renderSystemBackup();
  if (currentPage === 'adminImportExport') renderSystemImportExport();
  if (currentPage === 'adminArchive') renderSystemArchive();
  if (currentPage === 'adminLog') renderSystemLog();
  renderNav();
}

function subtitleForPage(page) {
  const role = roleNames[currentUser.role] || currentUser.role;
  const map = {
    dashboard: `${role}-Ansicht mit aktuellen Aufgaben und Meldungen`,
    materials: 'Materialstamm, Bestände, Mindestbestand und Bestellanforderung',
    konsi: 'Separater Überblick für Konsi-Materialien',
    inventory: 'Inventur starten, zählen, Differenzen prüfen und Bestände übernehmen',
    orders: 'Bestellung und Status-Rückmeldung',
    writtenOff: 'Komplett ausgebuchte Materialien mit Werkszeugnis, AB und Lieferschein',
    history: 'Letzte Aktivitäten aller Arbeitsplätze',
    admin: currentUser.role === 'ADMIN' ? 'Verwaltung' : 'Gesamtübersicht für Chef',
    adminMaterials: 'Mehrere Materialien schnell hintereinander anlegen',
    users: 'Benutzer anlegen, Rollen vergeben und Zugänge deaktivieren',
    adminSettings: 'Regale, Standardwerte, Rechte und Systemstatus',
    adminBackup: 'Datensicherung erstellen, herunterladen oder wiederherstellen',
    adminImportExport: 'Materiallisten exportieren oder per CSV importieren',
    adminArchive: 'Archivierte Materialien ansehen und wiederherstellen',
    adminLog: 'Systemprotokoll mit Änderungen und Anmeldungen'
  };
  return map[page] || '';
}


const adminMenuGroups = [
  {
    title: 'Benutzer & Rechte',
    text: 'Zugänge, Rollen und Grundeinstellungen',
    items: [
      { page: 'users', title: 'Benutzer & Rollen', text: 'Zugänge, Passwörter, Rollen' },
      { page: 'adminSettings', title: 'Einstellungen & Rechte', text: 'Regale, Stärken, Systemstatus' }
    ]
  },
  {
    title: 'Material & Listen',
    text: 'Materialdaten pflegen, importieren und archivieren',
    items: [
      { page: 'adminMaterials', title: 'Materialpflege', text: 'Mehrfachanlage, Korrektur, Einzel-Löschen' },
      { page: 'adminImportExport', title: 'Import & Export', text: 'CSV und Google-Sheets-Daten' },
      { page: 'adminArchive', title: 'Archiv', text: 'Archivierte Materialien wiederherstellen' }
    ]
  },
  {
    title: 'Sicherung & Kontrolle',
    text: 'Daten sichern, prüfen und nachvollziehen',
    items: [
      { page: 'adminBackup', title: 'Backup', text: 'Sichern und wiederherstellen' },
      { page: 'adminLog', title: 'Systemprotokoll', text: 'Änderungen und Logins' },
      { page: 'history', title: 'Historie', text: 'Alle Aktivitäten ansehen' }
    ]
  },
  {
    title: 'Tägliche Kontrolle',
    text: 'Schnellzugriff auf Arbeitsbereiche',
    items: [
      { page: 'materials', title: 'Materialbestand', text: 'Bestände prüfen und korrigieren' },
      { page: 'orders', title: 'Wareneingang', text: 'Bestellungen und Korrekturen' },
      { page: 'konsi', title: 'Konsi-Lager', text: 'Konsi-Material einsehen' }
    ]
  }
];

function adminMenuButton(item, activePage = '') {
  const isActive = item.page === activePage;
  return `<button class="admin-tile ${isActive ? 'active' : ''}" onclick="goPage('${jsString(item.page)}')"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span></button>`;
}

function renderSystemMenuOverview(activePage = '') {
  return `<div class="admin-menu-overview">
    ${adminMenuGroups.map(group => `<div class="card admin-menu-section">
      <div class="admin-section-title"><div><h2>${escapeHtml(group.title)}</h2><p>${escapeHtml(group.text)}</p></div></div>
      <div class="admin-tile-grid admin-tile-grid-compact">${group.items.map(item => adminMenuButton(item, activePage)).join('')}</div>
    </div>`).join('')}
  </div>`;
}

function renderSystemSubnav(activePage) {
  return `<div class="card admin-subnav-card">
    <div class="admin-subnav-head">
      <div><strong>Verwaltung</strong><span>Untermenüs sind hier gruppiert und nicht mehr einzeln in der linken Hauptnavigation.</span></div>
      <button class="secondary mini" onclick="goPage('admin')">Zur Übersicht</button>
    </div>
    <div class="admin-subnav-row">
      ${adminMenuGroups.flatMap(group => group.items).filter(item => item.page !== 'history' && item.page !== 'materials' && item.page !== 'orders' && item.page !== 'konsi').map(item => `<button class="ghost mini ${item.page === activePage ? 'active' : ''}" onclick="goPage('${jsString(item.page)}')">${escapeHtml(item.title)}</button>`).join('')}
    </div>
  </div>`;
}


function renderSystemDashboard() {
  const users = state.users || [];
  const active = users.filter(u => u.active !== false).length;
  const inactive = users.length - active;
  const status = state.systemStatus || {};
  const archived = (state.archivedMaterials || []).length;
  const target = currentPage === 'admin' ? '#admin' : '#dashboard';
  $(target).innerHTML = `
    <div class="dashboard-compact">
      <div class="card admin-hero-card">
        <div>
          <h2>Verwaltung</h2>
          <p>Alle Verwaltungsfunktionen sind in Gruppen sortiert. Links bleibt nur noch der Hauptpunkt <strong>Verwaltung</strong>, damit die Navigation übersichtlich bleibt.</p>
        </div>
        <div class="admin-hero-badges"><span class="badge gray">Gruppierte Menüs</span><span class="badge gray">Weniger Seitenleiste</span></div>
      </div>
      <div class="grid dashboard-stats">
        <div class="stat"><span>Aktive Benutzer</span><strong>${active}</strong></div>
        <div class="stat"><span>Deaktiviert</span><strong>${inactive}</strong></div>
        <div class="stat"><span>Materialien</span><strong>${state.materials.length}</strong></div>
        <div class="stat"><span>Archiv</span><strong>${archived}</strong></div>
        <div class="stat"><span>Backups</span><strong>${(state.backups || []).length}</strong></div>
      </div>
      ${renderSystemMenuOverview('admin')}
      ${renderInventoryTimerCard(true)}
      <div class="split">
        <div class="card compact-activity-card"><h2>Systemstatus</h2>${renderSystemStatus(status)}</div>
        <div class="card compact-activity-card"><h2>Letzte Aktivitäten</h2>${renderActivityList(state.activities.slice(0, 6))}</div>
      </div>
    </div>
  `;
}

function roleOptions(selected = 'LASER') {
  const roles = ['LASER','BUERO','CHEF'];
  return roles.map(role => `<option value="${role}" ${role === selected ? 'selected' : ''}>${escapeHtml(roleNames[role] || role)}</option>`).join('');
}

function renderDashboard() {
  if (currentUser.role === 'ADMIN') return renderSystemDashboard();
  const openOrders = state.orders.filter(o => ['ANGEFORDERT','BESTELLT','TEILGELIEFERT'].includes(o.status));
  const ordered = state.orders.filter(o => o.status === 'BESTELLT' || o.status === 'TEILGELIEFERT');
  const low = state.lowMaterials;
  const lowPreview = low.slice(0, 5);
  const konsi = state.materials.filter(m => m.storage === 'KONSI');
  const target = currentPage === 'admin' ? '#admin' : '#dashboard';
  $(target).innerHTML = `
    <div class="dashboard-compact">
      <div class="grid dashboard-stats">
        <div class="stat"><span>Materialien</span><strong>${state.materials.length}</strong></div>
        <div class="stat"><span>Warnungen</span><strong>${low.length}</strong></div>
        <div class="stat"><span>Offene Bestellungen</span><strong>${openOrders.length}</strong></div>
        <div class="stat"><span>Bestellt / Lieferung</span><strong>${ordered.length}</strong></div>
        <div class="stat"><span>Konsi-Lager</span><strong>${konsi.length}</strong></div>
      </div>
      ${renderInventoryTimerCard(true)}
      <div class="dashboard-grid dashboard-grid-compact">
        <div class="card">
          <h2>${currentUser.role === 'LASER' ? 'Laser Aufgaben' : currentUser.role === 'BUERO' ? 'Büro Eingang' : 'Chef Übersicht'}</h2>
          ${renderRoleTasks()}
        </div>
        <div class="card compact-warning-card">
          <h2>Mindestbestand</h2>
          ${lowPreview.length ? `<div class="quick-list compact-warnings">${lowPreview.map(m => `<div class="quick-item warning-mini"><strong>${escapeHtml(materialTitle(m))}</strong><small>${quantityLabel(m)} · ${escapeHtml(materialLocationLabel(m))}</small>${state.permissions.canRequestOrder ? `<button class="ghost mini" onclick="openOrderModal('${jsString(m.id)}'${isKonsi(m) ? ",'KONSI_REQUEST'" : ''})">Bestellung</button>` : ''}</div>`).join('')}</div>${low.length > 5 ? `<div class="footer-note">${low.length - 5} weitere Warnung(en) in Material anzeigen.</div>` : ''}` : '<div class="empty">Keine kritischen Materialien.</div>'}
        </div>
      </div>
      <div class="card compact-activity-card">
        <h2>Letzte Aktivitäten</h2>
        ${renderActivityList(state.activities.slice(0, 6))}
      </div>
    </div>
  `;
}

function renderRoleTasks() {
  if (currentUser.role === 'LASER') {
    const mine = state.orders.filter(o => o.requestedBy === currentUser.name || o.requestedByRole === 'LASER').slice(0, 6);
    return `
      <div class="toolbar"><button class="primary" onclick="openOrderModal()">Bestellung angeben</button><button class="secondary" onclick="goPage('materials')">Material prüfen</button></div>
      ${mine.length ? renderOrdersTable(mine, true) : '<div class="empty">Noch keine Bestellanforderungen vom Laser.</div>'}
    `;
  }
  if (currentUser.role === 'BUERO') {
    const incoming = state.orders.filter(o => ['ANGEFORDERT','BESTELLT','TEILGELIEFERT'].includes(o.status)).slice(0, 6);
    return `
      <div class="toolbar"><button class="primary" onclick="openMaterialModal()">Material anlegen</button><button class="secondary" onclick="goPage('inventory')">Inventur / Bestand</button></div>
      ${incoming.length ? renderOrdersTable(incoming, true) : '<div class="empty">Aktuell keine offenen Bestellungen oder Lieferungen.</div>'}
    `;
  }
  const allOpen = state.orders.filter(o => ['ANGEFORDERT','BESTELLT','TEILGELIEFERT'].includes(o.status)).slice(0, 8);
  return `
    <div class="toolbar"><button class="primary" onclick="openMaterialModal()">Material anlegen</button><button class="secondary" onclick="goPage('inventory')">Inventur</button></div>
    ${allOpen.length ? renderOrdersTable(allOpen, true) : '<div class="empty">Alle Bestellungen sind erledigt oder bestellt.</div>'}
  `;
}

function renderMaterials() {
  const canCreate = state.permissions.canCreateMaterial;
  const canTableImport = currentUser && currentUser.role === 'ADMIN';
  const canExportMaterials = state.permissions.canExportMaterials;
  $('#materials').innerHTML = `
    <div class="searchbar"><strong>Suche</strong><input id="materialSearch" placeholder="Material, Stärke, Menge, Größe oder Regal suchen ..." value="${escapeHtml(materialFilter.text)}"></div>
    <div class="toolbar">
      ${canCreate ? '<button class="primary" onclick="openMaterialModal()">Material anlegen</button>' : ''}
      ${canTableImport ? '<button class="secondary" onclick="openPasteTableModal()">Tabelle einfügen</button>' : ''}
      ${canExportMaterials ? '<button class="secondary" onclick="exportVisibleMaterialsCsv()">Materialliste CSV</button>' : ''}
      ${state.permissions.canRequestOrder ? '<button class="secondary" onclick="openOrderModal()">Bestellung angeben</button>' : ''}
      <span class="badge red">Regale: 1-6 · Carport · Bodenhaltung</span><span class="badge gray">Konsi: Garage</span>
    </div>
    ${materialFilterPanel()}
    <div id="deliveredMaterials"></div>
    <div id="materialGrid" class="material-grid"></div>
  `;
  const input = $('#materialSearch');
  input.addEventListener('compositionstart', () => { materialSearchComposing = true; });
  input.addEventListener('compositionend', () => {
    materialSearchComposing = false;
    materialFilter.text = input.value;
    scheduleMaterialDraw(80);
  });
  input.addEventListener('input', () => {
    materialFilter.text = input.value;
    if (!materialSearchComposing) scheduleMaterialDraw(140);
  });
  updateMaterialFilterUi();
  drawMaterialCards();
}

function applyMaterialFilterChange(key, value) {
  materialFilter[key] = value;
  updateMaterialFilterUi();
  drawMaterialCards();
}

window.setMaterialFilter = (status) => applyMaterialFilterChange('status', status);
window.setMaterialShelfFilter = (shelf) => applyMaterialFilterChange('shelf', shelf);
window.setMaterialStorageFilter = (storage) => applyMaterialFilterChange('storage', storage);
window.setMaterialFormatFilter = (format) => applyMaterialFilterChange('format', format);
window.setMaterialSort = (sort) => applyMaterialFilterChange('sort', sort);

window.resetMaterialFilters = () => {
  materialFilter = { text: '', status: 'all', shelf: 'all', format: 'all', storage: 'all', sort: 'none' };
  const input = $('#materialSearch');
  if (input) input.value = '';
  updateMaterialFilterUi();
  drawMaterialCards();
};

function scheduleMaterialDraw(delay = 140) {
  if (materialDrawTimer) clearTimeout(materialDrawTimer);
  materialDrawTimer = setTimeout(() => {
    materialDrawTimer = null;
    drawMaterialCards();
  }, delay);
}

function updateMaterialFilterUi() {
  $$('[data-material-filter]').forEach(button => {
    const key = button.getAttribute('data-filter-key');
    const value = button.getAttribute('data-filter-value');
    button.classList.toggle('active-filter', String(materialFilter[key] ?? '') === String(value ?? ''));
  });
  const input = $('#materialSearch');
  if (input && input.value !== String(materialFilter.text || '') && document.activeElement !== input) input.value = materialFilter.text || '';
}

function filterButton(active, label, onclick, cls = 'ghost', key = '', value = '') {
  const dataAttrs = key ? ` data-material-filter="1" data-filter-key="${escapeHtml(key)}" data-filter-value="${escapeHtml(value)}"` : '';
  return `<button type="button" class="${cls} ${active ? 'active-filter' : ''}"${dataAttrs} onclick="${onclick}">${escapeHtml(label)}</button>`;
}

function materialFilterPanel() {
  const shelves = (state && state.shelfOptions && state.shelfOptions.length) ? state.shelfOptions : defaultShelves;
  return `
    <div class="filter-panel material-filter-panel">
      <div class="filter-row"><span>Status</span>
        ${filterButton(materialFilter.status === 'all', 'Alle', "setMaterialFilter('all')", 'ghost', 'status', 'all')}
        ${filterButton(materialFilter.status === 'ok', 'OK', "setMaterialFilter('ok')", 'ghost', 'status', 'ok')}
        ${filterButton(materialFilter.status === 'low', 'Warnungen', "setMaterialFilter('low')", 'ghost', 'status', 'low')}
        ${filterButton(materialFilter.status === 'delivered', 'Geliefert', "setMaterialFilter('delivered')", 'ghost', 'status', 'delivered')}
        ${filterButton(materialFilter.status === 'rest', 'Resttafeln', "setMaterialFilter('rest')", 'ghost', 'status', 'rest')}
        ${filterButton(materialFilter.status === 'empty', 'Leer', "setMaterialFilter('empty')", 'ghost', 'status', 'empty')}
      </div>
      <div class="filter-row"><span>Bereich</span>
        ${filterButton(materialFilter.storage === 'all', 'Alle', "setMaterialStorageFilter('all')", 'ghost', 'storage', 'all')}
        ${filterButton(materialFilter.storage === 'HAUPTLAGER', 'Hauptlager', "setMaterialStorageFilter('HAUPTLAGER')", 'ghost', 'storage', 'HAUPTLAGER')}
        ${filterButton(materialFilter.storage === 'KONSI', 'Konsi', "setMaterialStorageFilter('KONSI')", 'ghost', 'storage', 'KONSI')}
      </div>
      <div class="filter-row"><span>Lagerplatz</span>
        ${filterButton(materialFilter.shelf === 'all', 'Alle', "setMaterialShelfFilter('all')", 'ghost', 'shelf', 'all')}
        ${shelves.map(shelf => filterButton(materialFilter.shelf === shelf, shelf, `setMaterialShelfFilter('${jsString(shelf)}')`, 'ghost', 'shelf', shelf)).join('')}
      </div>
      <div class="filter-row"><span>Größe</span>
        ${filterButton(materialFilter.format === 'all', 'Alle', "setMaterialFormatFilter('all')", 'ghost', 'format', 'all')}
        ${materialFormats.map(format => filterButton(materialFilter.format === format, format, `setMaterialFormatFilter('${jsString(format)}')`, 'ghost', 'format', format)).join('')}
        ${filterButton(materialFilter.format === SPECIAL_FORMAT_FILTER, 'Sonderformate', "setMaterialFormatFilter(SPECIAL_FORMAT_FILTER)", 'ghost', 'format', SPECIAL_FORMAT_FILTER)}
      </div>
      <div class="filter-row"><span>Sortierung</span>
        ${filterButton(materialFilter.sort === 'none', 'Standard', "setMaterialSort('none')", 'ghost', 'sort', 'none')}
        ${filterButton(materialFilter.sort === 'size-desc', 'Größe groß → klein', "setMaterialSort('size-desc')", 'ghost', 'sort', 'size-desc')}
        ${filterButton(materialFilter.sort === 'size-asc', 'Größe klein → groß', "setMaterialSort('size-asc')", 'ghost', 'sort', 'size-asc')}
      </div>
      <div class="filter-summary"><span id="materialFilterCount">-</span><button class="ghost mini" onclick="resetMaterialFilters()">Filter zurücksetzen</button></div>
    </div>`;
}

function materialFilterIsActive() {
  return Boolean(String(materialFilter.text || '').trim())
    || materialFilter.status !== 'all'
    || materialFilter.shelf !== 'all'
    || materialFilter.format !== 'all'
    || materialFilter.storage !== 'all'
    || materialFilter.sort !== 'none';
}

function materialFormatArea(material) {
  const parsed = parseFormatSize(material && material.format ? material.format : '');
  if (!parsed) return 0;
  return parsed.lengthMm * parsed.widthMm;
}

function sortMaterialsForList(materials) {
  const sort = materialFilter.sort || 'none';
  if (sort !== 'size-desc' && sort !== 'size-asc') return materials;
  const direction = sort === 'size-desc' ? -1 : 1;
  return materials
    .map((material, index) => ({ material, index }))
    .sort((a, b) => {
      const areaDiff = materialFormatArea(a.material) - materialFormatArea(b.material);
      if (areaDiff !== 0) return areaDiff * direction;
      const thicknessDiff = parseMillimeters(a.material.thickness) - parseMillimeters(b.material.thickness);
      if (thicknessDiff !== 0) return thicknessDiff * direction;
      const titleDiff = materialTitle(a.material).localeCompare(materialTitle(b.material), 'de', { numeric: true, sensitivity: 'base' });
      if (titleDiff !== 0) return titleDiff;
      return a.index - b.index;
    })
    .map(entry => entry.material);
}

function filteredMaterials() {
  if (!materialFilterIsActive()) return [];
  const text = String(materialFilter.text || '');
  const materials = state.materials
    .filter(m => !m.archived)
    .filter(m => materialSearchMatches(m, text))
    .filter(m => {
      if (materialFilter.storage !== 'all' && (m.storage || 'HAUPTLAGER') !== materialFilter.storage) return false;
      if (materialFilter.shelf !== 'all' && String(m.shelf || '') !== materialFilter.shelf) return false;
      if (materialFilter.format === SPECIAL_FORMAT_FILTER) {
        if (materialFormats.includes(normalizeFormatValue(m.format || ''))) return false;
      } else if (materialFilter.format !== 'all' && normalizeFormatValue(m.format || '') !== materialFilter.format) return false;
      if (materialFilter.status === 'all') return true;
      if (materialFilter.status === 'rest') return !!m.rest;
      if (materialFilter.status === 'low') return materialIsLow(m);
      if (materialFilter.status === 'delivered') return !!m.deliveryPending;
      if (materialFilter.status === 'empty') return !m.deliveryPending && Number(m.stock) <= 0;
      if (materialFilter.status === 'ok') return materialStatus(m).key === 'ok';
      return true;
    });
  return sortMaterialsForList(materials);
}

function materialTitle(m) {
  const name = String(m.name || '').trim();
  const thickness = normalizeThicknessInput(m.thickness || '').trim();
  if (!thickness) return name || 'Material';
  const lowerName = name.toLowerCase();
  const lowerThickness = thickness.toLowerCase();
  if (lowerName.includes(lowerThickness)) return name || 'Material';
  const numberOnly = lowerThickness.replace(/\s*mm$/i, '').trim();
  if (numberOnly && lowerName.includes(numberOnly + ' mm')) return name || 'Material';
  return `${name || 'Material'} ${thickness}`;
}

function canMoveMaterial(m) {
  return !isKonsi(m) && ['Carport', 'Bodenhaltung'].includes(String(m.shelf || '')) && (Number(m.sheetStock ?? m.stock) || 0) > 0;
}

function materialCardHtml(m) {
  const status = materialStatus(m);
  const fill = materialMinStock(m) ? Math.max(0, Math.min(100, Math.round((materialSheetStock(m) / Math.max(materialMinStock(m), 1)) * 100))) : 100;
  return `
    <div class="material-card ${m.deliveryPending ? 'delivered' : (m.rest ? 'rest' : (m.storage === 'KONSI' ? 'konsi' : (status.key === 'low' || status.key === 'empty' ? 'low' : '')))}">
      <div class="material-head"><h3>${escapeHtml(materialTitle(m))}</h3>${materialStatusBadge(m)}</div>
      <div class="meta compact-material">
        <div><span>Menge</span><strong>${materialCardQuantityLabel(m)}</strong></div>
        <div><span>Format</span><strong>${escapeHtml(formatDisplayValue(m.format || '-'))}</strong></div>
        <div><span>Lagerplatz</span><strong>${escapeHtml(materialLocationLabel(m))}</strong></div>
        ${m.articleNumber ? `<div><span>Teilenr.</span><strong>${escapeHtml(m.articleNumber)}</strong></div>` : ''}
        ${materialPriceLine(m)}
      </div>
      <div class="stock-fill"><span style="width:${fill}%"></span></div>
      <div class="actions">
        <button class="ghost mini" onclick="openStockModal('${jsString(m.id)}','REMOVE')">Entnahme</button>
        <button class="ghost mini" onclick="openMaterialHistoryModal('${jsString(m.id)}')">Historie</button>
        ${m.certificate ? `<button class="ghost mini" onclick="openMaterialCertificate('${jsString(m.id)}')">Werkszeugnis</button>` : ''}
        <button class="ghost mini" onclick="uploadMaterialCertificate('${jsString(m.id)}')">${m.certificate ? 'Werkszeugnis ändern' : 'Werkszeugnis PDF'}</button>
        ${canSeePrices() ? `<button class="ghost mini" onclick="openMaterialPriceModal('${jsString(m.id)}')">KG-Preis</button>` : ''}
        ${state.permissions.canDirectWriteOff && (Number(m.stock) || Number(m.sheetStock) || Number(m.packageStock) || (Array.isArray(m.packageNumbers) && m.packageNumbers.length)) ? `<button class="secondary danger mini" onclick="openDirectWriteOffModal('${jsString(m.id)}')">Komplett ausbuchen</button>` : ''}
        ${canMoveMaterial(m) ? `<button class="secondary mini" onclick="openMoveMaterialModal('${jsString(m.id)}')">Verräumen</button>` : ''}
        ${state.permissions.canAdjustStock && !isKonsi(m) ? `<button class="secondary mini" onclick="openStockModal('${jsString(m.id)}','SET')">Bestand buchen</button>` : ''}
        ${!m.rest && state.permissions.canRequestOrder ? `<button class="primary mini" onclick="openOrderModal('${jsString(m.id)}'${isKonsi(m) ? ",'KONSI_REQUEST'" : ''})">Bestellung</button>` : (m.rest ? `<span class="badge gray">Resttafel</span>` : '')}
        ${state.permissions.canCorrectMaterial ? `<button class="secondary mini" onclick="openSystemMaterialEditModal('${jsString(m.id)}')">Korrigieren</button>` : (state.permissions.canEditMaterial ? `<button class="ghost mini" onclick="openMaterialModal('${jsString(m.id)}')">Bearbeiten</button>` : '')}
        ${state.permissions.canDeleteNonOrderMaterial && materialCanDeleteWithoutOrderClient(m) ? `<button class="secondary danger mini" onclick="deleteNonOrderMaterial('${jsString(m.id)}')">Löschen</button>` : ''}
        ${state.permissions.canDeleteMaterial && !state.permissions.canDeleteNonOrderMaterial ? `<button class="secondary danger mini" onclick="archiveMaterial('${jsString(m.id)}')">Archivieren</button>` : ''}
      </div>
    </div>
  `;
}

function renderDeliveredMaterials() {
  const container = $('#deliveredMaterials');
  if (!container) return;
  const delivered = (state.materials || []).filter(m => m.deliveryPending && !m.archived).slice(0, 6);
  if (!delivered.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="card delivered-panel delivered-panel-small">
      <div class="panel-head"><h2>Geliefert</h2><span class="badge green">Wareneingang</span></div>
      <div class="quick-list delivered-list delivered-list-small">
        ${delivered.map(m => `<div class="quick-item delivered-mini"><strong>${escapeHtml(materialTitle(m))}</strong><small>${materialCardQuantityLabel(m)} · Maße: ${escapeHtml(formatDisplayValue(m.format || '-'))} · ${escapeHtml(materialLocationLabel(m))}</small><div class="row-actions">${canMoveMaterial(m) ? `<button class="secondary mini" onclick="openMoveMaterialModal('${jsString(m.id)}')">Verräumen</button>` : ''}<button class="ghost mini" onclick="openStockModal('${jsString(m.id)}','REMOVE')">Entnahme</button><button class="ghost mini" onclick="openMaterialHistoryModal('${jsString(m.id)}')">Historie</button></div></div>`).join('')}
      </div>
      ${delivered.length >= 6 ? '<div class="footer-note">Weitere gelieferte Positionen sind unten in der Materialliste sichtbar.</div>' : ''}
    </div>`;
}

function drawMaterialCards() {
  const active = materialFilterIsActive();
  // Gelieferte Positionen sollen immer direkt im Bereich Material sichtbar sein.
  renderDeliveredMaterials();
  const materials = filteredMaterials();
  const count = $('#materialFilterCount');
  if (count) count.textContent = active ? `${materials.length} von ${(state.materials || []).filter(m => !m.archived).length} Positionen` : 'Bitte Filter oder Suche auswählen';
  $('#materialGrid').innerHTML = active
    ? (materials.map(materialCardHtml).join('') || '<div class="empty">Keine Materialien gefunden.</div>')
    : '<div class="empty">Bitte erst eine Suche oder einen Filter auswählen. Danach werden die passenden Materialien angezeigt.</div>';
}

function konsiMaterialsFiltered() {
  const text = String(materialFilter.text || '');
  return state.materials
    .filter(m => m.storage === 'KONSI')
    .filter(m => materialSearchMatches(m, text));
}

function drawKonsiCards() {
  const grid = $('#konsiGrid');
  if (!grid) return;
  const konsiMaterials = konsiMaterialsFiltered();
  grid.innerHTML = konsiMaterials.map(materialCardHtml).join('') || '<div class="empty">Noch kein Material im Konsi-Lager.</div>';
}

function renderKonsi() {
  const canCreate = state.permissions.canCreateMaterial;
  const canImportKonsiTable = currentUser && currentUser.role === 'ADMIN';
  $('#konsi').innerHTML = `
    <div class="searchbar"><strong>Konsi</strong><input id="konsiSearch" placeholder="Konsi-Material suchen ..." value="${escapeHtml(materialFilter.text)}"></div>
    <div class="toolbar">
      ${canCreate ? '<button class="primary" onclick="openMaterialModal(\'\', \'KONSI\')">Konsi-Material anlegen</button>' : ''}
      ${canImportKonsiTable ? '<button class="secondary" onclick="openPasteTableModal()">Konsi-Tabelle einfügen</button>' : ''}
      <button class="secondary" onclick="loadState()">Aktualisieren</button>
      <span class="badge gray">Konsi für alle sichtbar</span><span class="badge gray">Tabellenimport</span><span class="badge red">Standort: Garage</span>
    </div>
    <div id="konsiGrid" class="material-grid"></div>
  `;
  $('#konsiSearch').addEventListener('input', (event) => {
    materialFilter.text = event.target.value;
    drawKonsiCards();
  });
  drawKonsiCards();
}


function inventoryAreaLabel(area) {
  return area === 'KONSI' ? 'Konsi-Lager' : area;
}

function inventoryStatusLabel(status) {
  return ({ OFFEN: 'Offen', IN_BEARBEITUNG: 'In Bearbeitung', GEPRUEFT: 'Geprüft', ABGESCHLOSSEN: 'Abgeschlossen', ABGEBROCHEN: 'Abgebrochen' }[status] || status || 'Offen');
}

function inventoryStatusBadge(status) {
  const cls = status === 'ABGESCHLOSSEN' ? 'green' : (status === 'ABGEBROCHEN' ? 'gray' : (status === 'GEPRUEFT' ? 'amber' : (status === 'IN_BEARBEITUNG' ? 'red' : 'gray')));
  return `<span class="badge ${cls}">${inventoryStatusLabel(status)}</span>`;
}

function inventoryAreaOptions(selected = 'Regal 1') {
  const areas = [...defaultShelves, 'KONSI'];
  return areas.map(area => `<option value="${escapeHtml(area)}" ${area === selected ? 'selected' : ''}>${escapeHtml(inventoryAreaLabel(area))}</option>`).join('');
}

function hasInventoryValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function mainInventoryItemCounted(item) {
  return hasInventoryValue(item.countedPackages) || hasInventoryValue(item.countedSheets);
}

function inventoryDiffText(item, area) {
  if (area === 'KONSI') {
    if (item.present === null || item.present === undefined) return 'Noch nicht gezählt';
    return item.present ? 'Vorhanden' : 'Fehlt';
  }
  const expP = Number(item.expectedPackages) || 0;
  const expS = Number(item.expectedSheets) || 0;
  if (!mainInventoryItemCounted(item)) return 'Noch nicht gezählt';
  const cntP = hasInventoryValue(item.countedPackages) ? Number(item.countedPackages) || 0 : 0;
  const cntS = hasInventoryValue(item.countedSheets) ? Number(item.countedSheets) || 0 : 0;
  const dp = cntP - expP;
  const ds = cntS - expS;
  if (dp === 0 && ds === 0) return 'OK';
  const parts = [];
  if (dp) parts.push(`${dp > 0 ? '+' : ''}${dp} Paket(e)`);
  if (ds) parts.push(`${ds > 0 ? '+' : ''}${ds} Tafel(n)`);
  return parts.join(' / ');
}

function inventoryDifferenceCount(session) {
  return session.items.filter(item => inventoryDiffText(item, session.area) !== 'OK' && inventoryDiffText(item, session.area) !== 'Vorhanden' && inventoryDiffText(item, session.area) !== 'Noch nicht gezählt').length;
}

function inventoryItemCounted(item, area) {
  if (area === 'KONSI') return item.present !== null && item.present !== undefined;
  return mainInventoryItemCounted(item);
}

function inventoryProgress(session) {
  const items = session.items || [];
  const total = items.length;
  const done = items.filter(item => inventoryItemCounted(item, session.area)).length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const next = items.find(item => !inventoryItemCounted(item, session.area));
  return { total, done, open: Math.max(0, total - done), percent, next };
}

function inventoryNextText(session) {
  const progress = inventoryProgress(session);
  if (!progress.next) return 'Alles gezählt';
  const item = progress.next;
  if (session.area === 'KONSI') return `${item.packageNumber || '-'} · ${item.title || item.materialName}`;
  return `${item.title || item.materialName} · ${item.shelf || session.area}`;
}

function inventoryCycleKey(session) {
  if (!session) return '';
  return session.cycleId || `legacy_${String(session.closedAt || session.createdAt || '').slice(0, 10)}`;
}

function inventorySearchText(inv) {
  return [
    inventoryAreaLabel(inv.area), inv.status, inventoryStatusLabel(inv.status), inv.createdBy, inv.updatedBy, inv.closedBy, inv.canceledBy,
    fmtDate(inv.createdAt), fmtDate(inv.closedAt), fmtDate(inv.canceledAt), (inv.createdAt || '').slice(0, 10), (inv.closedAt || '').slice(0, 10),
    ...(inv.items || []).flatMap(item => [item.materialName, item.title, item.thickness, item.format, item.shelf, item.packageNumber, item.note])
  ].join(' ').toLowerCase();
}

function buildInventoryCycleSummary(sessions) {
  const relevant = (sessions || []).filter(inv => inv.status !== 'ABGEBROCHEN');
  const closed = relevant.filter(inv => inv.status === 'ABGESCHLOSSEN');
  const doneAreas = new Set(closed.map(inv => inv.area));
  const activeAreas = new Set(relevant.filter(inv => inv.status !== 'ABGESCHLOSSEN').map(inv => inv.area));
  const missingAreas = inventoryRequiredAreas.filter(area => !doneAreas.has(area) && !activeAreas.has(area));
  const openAreas = inventoryRequiredAreas.filter(area => activeAreas.has(area));
  const done = inventoryRequiredAreas.filter(area => doneAreas.has(area)).length;
  const startedAt = relevant.map(inv => inv.createdAt).filter(Boolean).sort()[0] || '';
  const closedValues = closed.map(inv => inv.closedAt).filter(Boolean).sort();
  const closedAt = done >= inventoryRequiredAreas.length ? (closedValues[closedValues.length - 1] || '') : '';
  const totalItems = relevant.reduce((sum, inv) => sum + (inv.items || []).length, 0);
  const doneItems = relevant.reduce((sum, inv) => sum + inventoryProgress(inv).done, 0);
  return {
    cycleId: relevant[0] ? inventoryCycleKey(relevant[0]) : (sessions && sessions[0] ? inventoryCycleKey(sessions[0]) : ''),
    sessions: relevant,
    done,
    total: inventoryRequiredAreas.length,
    percent: inventoryRequiredAreas.length ? Math.round((done / inventoryRequiredAreas.length) * 100) : 0,
    complete: done >= inventoryRequiredAreas.length,
    doneAreas: Array.from(doneAreas),
    openAreas,
    missingAreas,
    startedAt,
    closedAt,
    totalItems,
    doneItems,
    createdBy: (relevant.find(inv => inv.createdBy) || {}).createdBy || '',
    closedBy: (closed.slice().reverse().find(inv => inv.closedBy) || {}).closedBy || ''
  };
}

function buildInventoryCycles(inventories) {
  const map = new Map();
  (inventories || []).forEach(inv => {
    if (inv.status === 'ABGEBROCHEN') return;
    const key = inventoryCycleKey(inv);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(inv);
  });
  return Array.from(map.values()).map(buildInventoryCycleSummary);
}

function currentInventoryCycle(inventories) {
  const cycles = buildInventoryCycles(inventories);
  return cycles.find(cycle => !cycle.complete) || null;
}

function inventoryCycleSearchText(cycle) {
  return [
    'Gesamtinventur', cycle.cycleId, cycle.createdBy, cycle.closedBy, fmtDate(cycle.startedAt), fmtDate(cycle.closedAt),
    (cycle.startedAt || '').slice(0, 10), (cycle.closedAt || '').slice(0, 10),
    ...cycle.sessions.flatMap(inventorySearchText)
  ].join(' ').toLowerCase();
}

function filteredInventoryArchive(inventories) {
  const text = String(inventoryHistoryFilter.text || '').toLowerCase();
  const date = String(inventoryHistoryFilter.date || '').trim();
  return buildInventoryCycles(inventories)
    .filter(cycle => cycle.complete)
    .filter(cycle => !text || inventoryCycleSearchText(cycle).includes(text))
    .filter(cycle => !date || String(cycle.closedAt || cycle.startedAt || '').slice(0, 10) === date)
    .sort((a, b) => new Date(b.closedAt || b.startedAt || 0) - new Date(a.closedAt || a.startedAt || 0));
}

function drawInventoryArchive() {
  const closed = filteredInventoryArchive(state.inventories || []);
  const count = $('#inventoryArchiveCount');
  if (count) count.textContent = `${closed.length} gefunden`;
  const box = $('#inventoryArchiveResult');
  if (box) box.innerHTML = closed.length ? renderInventoryHistory(closed) : '<div class="empty">Noch keine vollständig abgeschlossene Gesamtinventur gefunden.</div>';
}

function canAddInventoryExtraMaterial(session) {
  return ['Carport', 'Bodenhaltung'].includes(session.area) && !['ABGESCHLOSSEN', 'ABGEBROCHEN'].includes(session.status);
}

function renderInventory() {
  const inventories = state.inventories || [];
  const active = inventories.filter(inv => inv.status !== 'ABGESCHLOSSEN' && inv.status !== 'ABGEBROCHEN');
  const closed = filteredInventoryArchive(inventories);
  $('#inventory').innerHTML = `
    ${renderInventoryTimerCard(false)}
    <div class="toolbar">
      <button class="primary" onclick="openInventoryStartModal()">Inventur starten</button>
      <button class="secondary" onclick="loadState()">Aktualisieren</button>
      <span class="badge gray">Fortschritt wird gespeichert</span>
      <span class="badge gray">Carport/Bodenhaltung mit Zusatzmaterial</span>
    </div>
    ${renderInventoryCycleOverview(inventories)}
    ${active.length ? active.map(renderInventorySession).join('') : renderInventoryStartOverview()}
    <div class="card inventory-history-card">
      <h2>Inventur-Datenbank</h2>
      <p class="muted">Die Inventur erscheint hier erst, wenn alle Bereiche abgeschlossen sind: Regal 1–6, Carport, Bodenhaltung und Konsi-Lager.</p>
      <div class="filter-panel inventory-archive-filter">
        <div class="searchbar inline-search"><strong>Suche</strong><input id="inventoryArchiveSearch" placeholder="Gesamtinventur suchen nach Datum, Bereich, Material, Benutzer ..." value="${escapeHtml(inventoryHistoryFilter.text)}"></div>
        <div class="filter-row"><span>Datum</span><input id="inventoryArchiveDate" type="date" value="${escapeHtml(inventoryHistoryFilter.date)}"><button class="ghost" onclick="resetInventoryArchiveFilter()">Zurücksetzen</button><span id="inventoryArchiveCount" class="badge gray">${closed.length} gefunden</span></div>
      </div>
      <div id="inventoryArchiveResult">${closed.length ? renderInventoryHistory(closed) : '<div class="empty">Noch keine vollständig abgeschlossene Gesamtinventur gefunden.</div>'}</div>
    </div>
  `;
  const archiveSearch = $('#inventoryArchiveSearch');
  if (archiveSearch) archiveSearch.addEventListener('input', event => { inventoryHistoryFilter.text = event.target.value; drawInventoryArchive(); });
  const archiveDate = $('#inventoryArchiveDate');
  if (archiveDate) archiveDate.addEventListener('change', event => { inventoryHistoryFilter.date = event.target.value; drawInventoryArchive(); });
  bindInventoryLive();
}

function renderInventoryCycleOverview(inventories) {
  const cycle = currentInventoryCycle(inventories || []);
  if (!cycle) return '';
  const nextArea = cycle.openAreas[0] || cycle.missingAreas[0] || '';
  const doneText = cycle.doneAreas.length ? cycle.doneAreas.map(inventoryAreaLabel).join(', ') : 'Noch kein Bereich abgeschlossen';
  const openText = cycle.openAreas.length ? cycle.openAreas.map(inventoryAreaLabel).join(', ') : 'keine laufenden Bereiche';
  const missingText = cycle.missingAreas.length ? cycle.missingAreas.map(inventoryAreaLabel).join(', ') : 'keine fehlenden Bereiche';
  return `
    <div class="card inventory-cycle-card">
      <div class="inventory-head">
        <div>
          <h2>Gesamtfortschritt Inventur</h2>
          <div class="inventory-progress-line"><strong>Bereiche abgeschlossen:</strong> ${cycle.done}/${cycle.total} · ${cycle.percent}% <span class="muted">Weiter bei: <strong>${escapeHtml(nextArea ? inventoryAreaLabel(nextArea) : 'Alles abgeschlossen')}</strong></span></div>
          <div class="inventory-progress-bar"><span style="width:${Math.max(0, Math.min(100, cycle.percent))}%"></span></div>
        </div>
        <div class="inventory-head-right"><span class="badge ${cycle.done ? 'amber' : 'gray'}">Gesamtinventur läuft</span></div>
      </div>
      <div class="settings-list compact-settings">
        <div><strong>Abgeschlossen</strong><span>${escapeHtml(doneText)}</span></div>
        <div><strong>Offen / laufend</strong><span>${escapeHtml(openText)}</span></div>
        <div><strong>Noch zu starten</strong><span>${escapeHtml(missingText)}</span></div>
      </div>
      <div class="footer-note">Die Inventur-Datenbank zeigt diese Inventur erst an, wenn alle Regale, Carport, Bodenhaltung und Konsi-Lager abgeschlossen sind.</div>
    </div>
  `;
}

function renderInventoryStartOverview() {
  return `
    <div class="card">
      <h2>Neue Inventur</h2>
      <p class="muted">Bereich auswählen, zählen, Differenzen prüfen und erst danach die Bestände übernehmen.</p>
      <div class="inventory-area-grid">
        ${defaultShelves.map(area => `<button class="inventory-area-card" onclick="startInventory('${jsString(area)}')"><strong>${escapeHtml(area)}</strong><span>Hauptlager · Pakete + Tafeln</span></button>`).join('')}
        <button class="inventory-area-card konsi-area" onclick="startInventory('KONSI')"><strong>Konsi-Lager</strong><span>Paketnummern vorhanden / fehlt</span></button>
      </div>
    </div>
  `;
}

function renderInventorySession(session) {
  const isK = session.area === 'KONSI';
  const progress = inventoryProgress(session);
  const openItems = progress.open;
  const differences = inventoryDifferenceCount(session);
  return `
    <div class="card inventory-session-card" data-inventory-id="${escapeHtml(session.id)}">
      <div class="inventory-head">
        <div>
          <h2>Inventur ${escapeHtml(inventoryAreaLabel(session.area))}</h2>
          <div class="muted">Gestartet von ${escapeHtml(session.createdBy || '-')} · ${fmtDate(session.createdAt)} · ${session.items.length} Position(en)</div>
          <div class="inventory-progress-line"><strong>Fortschritt:</strong> <span class="inventory-progress-text">${progress.done}/${progress.total} · ${progress.percent}%</span> <span class="muted">Weiter bei: <strong class="inventory-next-text">${escapeHtml(inventoryNextText(session))}</strong></span></div>
          <div class="inventory-progress-bar"><span style="width:${Math.max(0, Math.min(100, progress.percent))}%"></span></div>
        </div>
        <div class="inventory-head-right">
          ${inventoryStatusBadge(session.status)}
          <span class="badge ${openItems ? 'red' : 'green'} inventory-open-badge">${openItems ? `${openItems} offen` : 'vollständig'}</span>
          <span class="badge amber inventory-diff-badge ${differences ? '' : 'hidden'}">${differences} Differenz(en)</span>
        </div>
      </div>
      ${isK ? renderKonsiInventoryTable(session) : renderMainInventoryTable(session)}
      <div class="toolbar inventory-actions">
        <button class="secondary" onclick="saveInventory('${jsString(session.id)}')">Zwischenstand speichern</button>
        <button class="secondary danger" onclick="cancelInventory('${jsString(session.id)}')">Inventur abbrechen</button>
        ${canAddInventoryExtraMaterial(session) ? `<button class="ghost" onclick="openInventoryExtraItemModal('${jsString(session.id)}')">Material hinzufügen</button>` : ''}
        <button class="ghost" onclick="openInventoryPrint('${jsString(session.id)}')">PDF / Drucken</button>
        <button class="ghost" onclick="openInventoryExcel('${jsString(session.id)}')">Excel</button>
        ${currentUser.role !== 'LASER' ? `<button class="ghost" onclick="saveInventory('${jsString(session.id)}', true)">Als geprüft markieren</button>` : ''}
        ${currentUser.role !== 'LASER' ? `<button class="primary" onclick="closeInventory('${jsString(session.id)}')">Inventur abschließen & Bestand übernehmen</button>` : ''}
      </div>
      <div class="footer-note">${currentUser.role === 'LASER' ? 'Laser speichert den Zwischenstand. Wenn es am nächsten Tag weitergeht, zeigt die Karte automatisch die nächste offene Position.' : 'Beim Abschließen werden die gezählten Werte in die Materialbestände übernommen. Zusatzmaterial aus Carport/Bodenhaltung wird dann sauber angelegt.'}</div>
    </div>
  `;
}

function renderMainInventoryTable(session) {
  return `
    <table class="inventory-table">
      <thead><tr><th>Material</th><th>Größe</th><th>Soll</th><th>Gezählt</th>${canSeePrices() ? '<th>KG-Preis</th>' : ''}<th>Differenz</th><th>Bemerkung</th></tr></thead>
      <tbody>${session.items.map(item => `
        <tr data-item-id="${escapeHtml(item.id)}">
          <td><strong>${escapeHtml(item.title || item.materialName)}</strong>${item.extraMaterial ? '<div><span class="badge green">Zusatzmaterial</span></div>' : ''}<div class="small muted">${escapeHtml(item.shelf || session.area)}</div></td>
          <td>${escapeHtml(item.format || '-')}</td>
          <td><strong>${Number(item.expectedPackages) || 0} Pakete</strong><br><strong>${Number(item.expectedSheets) || 0} Tafeln</strong></td>
          <td><div class="inventory-count-grid"><label>Pakete<input class="inv-packages" type="number" min="0" step="1" value="${item.countedPackages ?? ''}" placeholder="0"></label><label>Tafeln<input class="inv-sheets" type="number" min="0" step="1" value="${item.countedSheets ?? ''}" placeholder="0"></label></div></td>
          ${canSeePrices() ? `<td><input class="inv-kg-price" type="number" min="0" step="0.01" value="${item.kgPrice ?? ''}" placeholder="€/kg"></td>` : ''}
          <td><span class="inventory-diff">${escapeHtml(inventoryDiffText(item, session.area))}</span></td>
          <td><input class="inv-note" value="${escapeHtml(item.note || '')}" placeholder="optional"></td>
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

function renderKonsiInventoryTable(session) {
  return `
    <table class="inventory-table">
      <thead><tr><th>Paketnummer</th><th>Material</th><th>Status</th>${canSeePrices() ? '<th>KG-Preis</th>' : ''}<th>Bemerkung</th></tr></thead>
      <tbody>${session.items.map(item => `
        <tr data-item-id="${escapeHtml(item.id)}">
          <td><strong>${escapeHtml(item.packageNumber || '-')}</strong></td>
          <td>${escapeHtml(item.title || item.materialName)}<div class="small muted">${escapeHtml(item.shelf || '-')}</div></td>
          <td><select class="inv-present"><option value="" ${item.present === null || item.present === undefined ? 'selected' : ''}>Noch offen</option><option value="true" ${item.present === true ? 'selected' : ''}>Vorhanden</option><option value="false" ${item.present === false ? 'selected' : ''}>Fehlt</option></select></td>
          ${canSeePrices() ? `<td><input class="inv-kg-price" type="number" min="0" step="0.01" value="${item.kgPrice ?? ''}" placeholder="€/kg"></td>` : ''}
          <td><input class="inv-note" value="${escapeHtml(item.note || '')}" placeholder="optional"></td>
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

function renderInventoryHistory(cycles) {
  return `
    <table>
      <thead><tr><th>Inventur</th><th>Status</th><th>Gestartet</th><th>Abgeschlossen</th><th>Bereiche</th><th>Positionen</th><th>Ausgabe</th></tr></thead>
      <tbody>${cycles.map(cycle => `<tr><td><strong>Gesamtinventur</strong><div class="small muted">Regale + Carport + Bodenhaltung + Konsi</div></td><td><span class="badge green">Vollständig</span></td><td>${escapeHtml(cycle.createdBy || '-')}<div class="small muted">${fmtDate(cycle.startedAt)}</div></td><td>${escapeHtml(cycle.closedBy || '-')}<div class="small muted">${fmtDate(cycle.closedAt)}</div></td><td>${cycle.done}/${cycle.total}<div class="small muted">${cycle.percent}%</div></td><td>${cycle.doneItems}/${cycle.totalItems}</td><td><div class="row-actions"><button class="ghost mini" onclick="openInventoryCycleDetailModal('${jsString(cycle.cycleId)}')">Details</button><button class="ghost mini" onclick="openInventoryCyclePrint('${jsString(cycle.cycleId)}')">PDF</button><button class="ghost mini" onclick="openInventoryCycleExcel('${jsString(cycle.cycleId)}')">Excel</button></div></td></tr>`).join('')}</tbody>
    </table>
  `;
}

window.openInventoryStartModal = () => {
  openModal(`
    <h2>Inventur starten</h2>
    <p class="muted">Die Inventur wird für einen Bereich erstellt. Danach wird gezählt und erst beim Abschluss werden die Bestände geändert.</p>
    <form id="inventoryStartForm" class="form-grid">
      <div class="form-full"><label>Bereich</label><select id="inventoryArea">${inventoryAreaOptions('Regal 1')}</select></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Inventur starten</button></div>
    </form>
  `);
  $('#inventoryStartForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await startInventory($('#inventoryArea').value);
  });
};

window.startInventory = async (area) => {
  try {
    await api('/api/inventories', { method: 'POST', body: JSON.stringify({ area }) });
    closeModal();
    showToast('Inventur gestartet', inventoryAreaLabel(area));
    await loadState(true);
  } catch (error) {
    showToast('Fehler', error.message);
    if (error.status === 409) await loadState(true);
  }
};

window.cancelInventory = async (sessionId) => {
  const session = (state.inventories || []).find(inv => inv.id === sessionId);
  if (!session) return;
  const ok = confirm(`Inventur vorzeitig beenden?\n\nBereich: ${inventoryAreaLabel(session.area)}\nEs werden keine Bestände übernommen. Diese Inventur verschwindet aus der laufenden Inventur.`);
  if (!ok) return;
  try {
    await api(`/api/inventories/${sessionId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Vorzeitig beendet' }) });
    showToast('Inventur beendet', `${inventoryAreaLabel(session.area)} wurde ohne Bestandsübernahme beendet.`);
    await loadState(true);
  } catch (error) { showToast('Fehler', error.message); }
};

function bindInventoryLive() {
  document.querySelectorAll('.inventory-session-card').forEach(card => {
    const sessionId = card.dataset.inventoryId;
    card.querySelectorAll('.inv-packages, .inv-sheets, .inv-present, .inv-kg-price').forEach(input => {
      input.addEventListener('input', () => updateInventoryCardLive(sessionId));
      input.addEventListener('change', () => updateInventoryCardLive(sessionId));
    });
    updateInventoryCardLive(sessionId);
  });
}

function updateInventoryCardLive(sessionId) {
  const session = (state.inventories || []).find(inv => inv.id === sessionId);
  const card = document.querySelector(`[data-inventory-id="${sessionId}"]`);
  if (!session || !card) return;
  let openItems = 0;
  let differences = 0;
  let firstOpenText = '';
  const rows = Array.from(card.querySelectorAll('tr[data-item-id]'));
  rows.forEach(row => {
    const base = session.items.find(item => item.id === row.dataset.itemId) || {};
    let current = { ...base };
    if (session.area === 'KONSI') {
      const value = row.querySelector('.inv-present')?.value || '';
      current.present = value === '' ? null : value === 'true';
      if (current.present === null || current.present === undefined) {
        openItems += 1;
        if (!firstOpenText) firstOpenText = `${base.packageNumber || '-'} · ${base.title || base.materialName || '-'}`;
      }
    } else {
      const packagesValue = row.querySelector('.inv-packages')?.value ?? '';
      const sheetsValue = row.querySelector('.inv-sheets')?.value ?? '';
      current.countedPackages = hasInventoryValue(packagesValue) ? Number(packagesValue) : null;
      current.countedSheets = hasInventoryValue(sheetsValue) ? Number(sheetsValue) : null;
      if (!mainInventoryItemCounted(current)) {
        openItems += 1;
        if (!firstOpenText) firstOpenText = `${base.title || base.materialName || '-'} · ${base.shelf || session.area}`;
      }
    }
    const diff = inventoryDiffText(current, session.area);
    const diffCell = row.querySelector('.inventory-diff');
    if (diffCell) diffCell.textContent = diff;
    if (diff !== 'OK' && diff !== 'Vorhanden' && diff !== 'Noch nicht gezählt') differences += 1;
  });
  const openBadge = card.querySelector('.inventory-open-badge');
  if (openBadge) {
    openBadge.textContent = openItems ? `${openItems} offen` : 'vollständig';
    openBadge.classList.toggle('red', !!openItems);
    openBadge.classList.toggle('green', !openItems);
  }
  const diffBadge = card.querySelector('.inventory-diff-badge');
  if (diffBadge) {
    diffBadge.textContent = `${differences} Differenz(en)`;
    diffBadge.classList.toggle('hidden', !differences);
  }
  const total = rows.length;
  const done = Math.max(0, total - openItems);
  const percent = total ? Math.round((done / total) * 100) : 0;
  const progressText = card.querySelector('.inventory-progress-text');
  if (progressText) progressText.textContent = `${done}/${total} · ${percent}%`;
  const nextText = card.querySelector('.inventory-next-text');
  if (nextText) nextText.textContent = firstOpenText || 'Alles gezählt';
  const progressBar = card.querySelector('.inventory-progress-bar span');
  if (progressBar) progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function collectInventoryPayload(sessionId) {
  const session = (state.inventories || []).find(inv => inv.id === sessionId);
  const card = document.querySelector(`[data-inventory-id="${sessionId}"]`);
  if (!session || !card) return { items: [] };
  const items = Array.from(card.querySelectorAll('tr[data-item-id]')).map(row => {
    const id = row.dataset.itemId;
    if (session.area === 'KONSI') {
      const value = row.querySelector('.inv-present').value;
      return { id, present: value === '' ? null : value === 'true', note: row.querySelector('.inv-note').value, kgPrice: canSeePrices() && row.querySelector('.inv-kg-price') ? row.querySelector('.inv-kg-price').value : '' };
    }
    const packagesValue = row.querySelector('.inv-packages').value.trim();
    const sheetsValue = row.querySelector('.inv-sheets').value.trim();
    const hasPackages = hasInventoryValue(packagesValue);
    const hasSheets = hasInventoryValue(sheetsValue);
    const isCounted = hasPackages || hasSheets;
    return {
      id,
      countedPackages: isCounted ? (hasPackages ? packagesValue : 0) : null,
      countedSheets: isCounted ? (hasSheets ? sheetsValue : 0) : null,
      kgPrice: canSeePrices() && row.querySelector('.inv-kg-price') ? row.querySelector('.inv-kg-price').value : '',
      note: row.querySelector('.inv-note').value
    };
  });
  return { items };
}

window.saveInventory = async (sessionId, checked = false) => {
  try {
    const payload = collectInventoryPayload(sessionId);
    if (checked) payload.status = 'GEPRUEFT';
    await api(`/api/inventories/${sessionId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    showToast(checked ? 'Inventur geprüft' : 'Inventur gespeichert', 'Der Zwischenstand wurde gespeichert.');
    await loadState(true);
  } catch (error) { showToast('Fehler', error.message); }
};

window.closeInventory = async (sessionId) => {
  const session = (state.inventories || []).find(inv => inv.id === sessionId);
  if (!session) return;
  const ok = confirm(`Inventur wirklich abschließen und Bestand übernehmen?\n\nBereich: ${inventoryAreaLabel(session.area)}\nDanach sind die gezählten Werte der neue Bestand.`);
  if (!ok) return;
  try {
    const payload = collectInventoryPayload(sessionId);
    await api(`/api/inventories/${sessionId}`, { method: 'PATCH', body: JSON.stringify({ ...payload, status: 'GEPRUEFT' }) });
    await api(`/api/inventories/${sessionId}/close`, { method: 'POST', body: JSON.stringify({}) });
    showToast('Inventur abgeschlossen', 'Die Bestände wurden übernommen.');
    await loadState(true);
  } catch (error) { showToast('Fehler', error.message); }
};


window.openInventoryExtraItemModal = (sessionId) => {
  const session = (state.inventories || []).find(inv => inv.id === sessionId);
  if (!session || !canAddInventoryExtraMaterial(session)) return showToast('Nicht möglich', 'Zusatzmaterial kann nur bei Carport oder Bodenhaltung eingefügt werden.');
  openModal(`
    <h2>Material zur Inventur hinzufügen</h2>
    <p class="muted">Für ${escapeHtml(inventoryAreaLabel(session.area))}. Das Material wird erst beim Inventurabschluss in den Bestand übernommen.</p>
    <form id="inventoryExtraItemForm" class="form-grid">
      <div><label>Material</label><input id="extraInvName" required placeholder="z. B. Aluminium"></div>
      <div><label>Stärke</label><input id="extraInvThickness" placeholder="z. B. 2 oder 2 mm"></div>
      <div><label>Größe</label><select id="extraInvFormat">${formatOptions('3000x1500')}</select></div>
      <div><label>Lagerplatz</label><input value="${escapeHtml(session.area)}" disabled></div>
      <div><label>Gezählte Pakete</label><input id="extraInvPackages" type="number" min="0" step="1" value="0"></div>
      <div><label>Gezählte Tafeln</label><input id="extraInvSheets" type="number" min="0" step="1" value="0"></div>
      ${canSeePrices() ? `<div><label>KG-Preis €/kg</label><input id="extraInvKgPrice" type="number" min="0" step="0.01" placeholder="z. B. 2,35"></div>` : ''}
      <label class="checkline form-full"><input id="extraInvRest" type="checkbox"> <span>Resttafel / Restmaterial</span></label>
      <div class="form-full"><label>Bemerkung</label><input id="extraInvNote" placeholder="optional"></div>
      <div class="notice form-full">Wichtig: Diese Position wird im Fortschritt mitgezählt. Beim Abschließen wird daraus automatisch eine Materialposition in ${escapeHtml(session.area)}.</div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Hinzufügen</button></div>
    </form>
  `);
  attachThicknessAutoFormat('#extraInvThickness');
  $('#inventoryExtraItemForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api(`/api/inventories/${sessionId}/items`, { method: 'POST', body: JSON.stringify({
        name: $('#extraInvName').value,
        thickness: normalizeThicknessInput($('#extraInvThickness').value),
        format: $('#extraInvFormat').value,
        countedPackages: Number($('#extraInvPackages').value || 0),
        countedSheets: Number($('#extraInvSheets').value || 0),
        kgPrice: canSeePrices() && $('#extraInvKgPrice') ? $('#extraInvKgPrice').value : '',
        rest: $('#extraInvRest').checked,
        note: $('#extraInvNote').value
      }) });
      closeModal();
      showToast('Material hinzugefügt', 'Die Position wurde zur Inventur eingefügt.');
      await loadState(true);
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.openInventoryPrint = (sessionId) => {
  window.open(`/api/inventories/${encodeURIComponent(sessionId)}/print?token=${encodeURIComponent(token)}`, '_blank');
};

window.openInventoryExcel = (sessionId) => {
  window.open(`/api/inventories/${encodeURIComponent(sessionId)}/export/xls?token=${encodeURIComponent(token)}`, '_blank');
};

window.openInventoryCyclePrint = (cycleId) => {
  window.open(`/api/inventory-cycles/${encodeURIComponent(cycleId)}/print?token=${encodeURIComponent(token)}`, '_blank');
};

window.openInventoryCycleExcel = (cycleId) => {
  window.open(`/api/inventory-cycles/${encodeURIComponent(cycleId)}/export/xls?token=${encodeURIComponent(token)}`, '_blank');
};

window.resetInventoryArchiveFilter = () => {
  inventoryHistoryFilter = { text: '', date: '' };
  renderInventory();
};

window.openInventoryCycleDetailModal = (cycleId) => {
  const cycle = buildInventoryCycles(state.inventories || []).find(item => item.cycleId === cycleId);
  if (!cycle) return;
  const sections = cycle.sessions
    .filter(session => session.status === 'ABGESCHLOSSEN')
    .map(session => {
      const progress = inventoryProgress(session);
      const isK = session.area === 'KONSI';
      return `
        <div class="card inner-card">
          <h3>${escapeHtml(inventoryAreaLabel(session.area))}</h3>
          <p class="muted">${escapeHtml(session.closedBy || session.updatedBy || session.createdBy || '-')} · ${fmtDate(session.closedAt || session.updatedAt || session.createdAt)} · ${progress.done}/${progress.total} Positionen</p>
          <div class="history-list">${isK ? renderKonsiInventoryTable(session) : renderMainInventoryTable(session)}</div>
        </div>
      `;
    }).join('');
  openModal(`
    <h2>Gesamtinventur</h2>
    <p class="muted">Vollständig abgeschlossen · ${fmtDate(cycle.closedAt)}</p>
    <div class="settings-list">
      <div><strong>Bereiche</strong><span>${cycle.done}/${cycle.total}</span></div>
      <div><strong>Positionen</strong><span>${cycle.doneItems}/${cycle.totalItems}</span></div>
      <div><strong>Gestartet</strong><span>${fmtDate(cycle.startedAt)}</span></div>
      <div><strong>Abgeschlossen</strong><span>${fmtDate(cycle.closedAt)}</span></div>
    </div>
    <div class="history-list">${sections}</div>
    <div class="modal-footer"><button class="ghost" onclick="openInventoryCyclePrint('${jsString(cycle.cycleId)}')">PDF / Drucken</button><button class="ghost" onclick="openInventoryCycleExcel('${jsString(cycle.cycleId)}')">Excel</button><button class="primary" onclick="closeModal()">Schließen</button></div>
  `);
};

window.setOrderFilter = (status) => {
  orderFilter.status = status;
  renderOrders();
};

window.resetOrderFilters = () => {
  orderFilter = { text: '', status: 'all' };
  renderOrders();
};

function orderDayKey(order) {
  const value = orderSortDate(order) || order.createdAt || order.lastUpdate || new Date().toISOString();
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : new Date().toISOString().slice(0, 10);
}

function orderDayLabel(dateKey) {
  if (!dateKey) return '-';
  const date = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateKey : date.toLocaleDateString('de-DE');
}


function normalizeOrderCustomerName(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!text || /^ohne\s+kunde$/i.test(text)) return 'Ohne Lieferant';
  return text;
}

function normalizeOrderCustomerKey(value) {
  const name = normalizeOrderCustomerName(value);
  if (name === 'Ohne Lieferant') return 'ohne_kunde';
  const normalized = name.normalize ? name.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : name;
  return normalized
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'ohne_kunde';
}

function orderCustomerName(order) {
  return normalizeOrderCustomerName(order && (order.supplierName || order.lieferant || order.customerName || order.customer || order.kunde));
}

function orderCustomerKey(order) {
  return normalizeOrderCustomerKey(order && (order.supplierKey || order.supplierName || order.lieferant || order.customerKey || order.customerName || order.customer || order.kunde));
}


function orderDayConfirmations(dateKey) {
  const groups = state.orderDayConfirmations || {};
  const list = groups[dateKey];
  return Array.isArray(list) ? list : [];
}

function orderDayDeliveryNotes(dateKey) {
  const groups = state.orderDayDeliveryNotes || {};
  const list = groups[dateKey];
  return Array.isArray(list) ? list : [];
}

function orderDayKonsiDocuments(dateKey) {
  const groups = state.orderDayKonsiDocuments || {};
  const list = groups[dateKey];
  return Array.isArray(list) ? list : [];
}


function orderCustomerDocumentList(collectionName, dateKey, customerKey) {
  const byDate = state[collectionName] || {};
  const dayGroup = byDate[dateKey];
  if (!dayGroup) return [];
  if (Array.isArray(dayGroup)) return customerKey === 'ohne_kunde' ? dayGroup : [];
  if (typeof dayGroup !== 'object') return [];
  const list = dayGroup[customerKey];
  return Array.isArray(list) ? list : [];
}

function orderCustomerConfirmations(dateKey, customerKey) {
  return orderCustomerDocumentList('orderCustomerConfirmations', dateKey, customerKey);
}

function orderCustomerDeliveryNotes(dateKey, customerKey) {
  return orderCustomerDocumentList('orderCustomerDeliveryNotes', dateKey, customerKey);
}

function orderCustomerKonsiConfirmations(dateKey, customerKey) {
  return orderCustomerDocumentList('orderCustomerKonsiConfirmations', dateKey, customerKey);
}

function orderCustomerKonsiDeliveryNotes(dateKey, customerKey) {
  return orderCustomerDocumentList('orderCustomerKonsiDeliveryNotes', dateKey, customerKey);
}

function orderCustomerKonsiDocuments(dateKey, customerKey) {
  return orderCustomerDocumentList('orderCustomerKonsiDocuments', dateKey, customerKey);
}

function orderCustomerSearchText(dateKey, customerKey) {
  const docs = [
    ...orderCustomerConfirmations(dateKey, customerKey).map(item => [item.originalName, item.uploadedBy, item.uploadedAt ? fmtDate(item.uploadedAt) : '', 'Auftragsbestätigung', 'AB PDF'].join(' ')),
    ...orderCustomerDeliveryNotes(dateKey, customerKey).map(item => [item.originalName, item.uploadedBy, item.uploadedAt ? fmtDate(item.uploadedAt) : '', 'Lieferschein', 'LS PDF'].join(' ')),
    ...orderCustomerKonsiConfirmations(dateKey, customerKey).map(item => [item.originalName, item.uploadedBy, item.uploadedAt ? fmtDate(item.uploadedAt) : '', 'Konsi Auftragsbestätigung', 'Konsi AB PDF'].join(' ')),
    ...orderCustomerKonsiDeliveryNotes(dateKey, customerKey).map(item => [item.originalName, item.uploadedBy, item.uploadedAt ? fmtDate(item.uploadedAt) : '', 'Konsi Lieferschein', 'Konsi LS PDF'].join(' '))
  ];
  return docs.join(' ');
}

function orderDaySearchText(dateKey) {
  const docs = [
    ...orderDayConfirmations(dateKey).map(item => [item.originalName, item.uploadedBy, item.uploadedAt ? fmtDate(item.uploadedAt) : '', 'Auftragsbestätigung', 'AB PDF'].join(' ')),
    ...orderDayDeliveryNotes(dateKey).map(item => [item.originalName, item.uploadedBy, item.uploadedAt ? fmtDate(item.uploadedAt) : '', 'Lieferschein', 'LS PDF'].join(' ')),
    ...orderDayKonsiDocuments(dateKey).map(item => [item.originalName, item.uploadedBy, item.uploadedAt ? fmtDate(item.uploadedAt) : '', 'Konsi', 'Konsi Dokument Alt'].join(' '))
  ];
  return docs.join(' ');
}

function orderSearchText(order) {
  return [
    order.materialName, orderThicknessLabel(order), orderFormatLabel(order), orderCustomerName(order), order.note, order.requestedBy, order.requestedByRole,
    order.deliveredToShelf, order.status, statusNames[order.status], order.manualOrder ? 'Handeingabe Bestellung selbst erfasst' : '', order.manualRequest ? 'Handeingabe freie Materialanfrage' : '', order.konsiOrder || order.storage === 'KONSI' ? 'Konsi separate Konsi-Bestellung' : '', order.quantityUnit,
    order.createdAt ? fmtDate(order.createdAt) : '',
    order.lastUpdate ? fmtDate(order.lastUpdate) : '',
    order.orderedAt ? fmtDate(order.orderedAt) : '',
    order.receivedAt ? fmtDate(order.receivedAt) : '',
    order.confirmation && order.confirmation.originalName,
    order.confirmation && order.confirmation.uploadedBy,
    order.confirmation && order.confirmation.uploadedAt ? fmtDate(order.confirmation.uploadedAt) : '',
    order.kgPrice !== undefined && order.kgPrice !== null ? formatKgPrice(order.kgPrice) : '',
    order.id
  ].join(' ').toLowerCase();
}

function filteredOrdersList(baseOrders) {
  const text = String(orderFilter.text || '');
  return baseOrders
    .filter(o => searchMatches([orderSearchText(o), orderDaySearchText(orderDayKey(o)), orderCustomerSearchText(orderDayKey(o), orderCustomerKey(o))].join(' '), text))
    .filter(o => {
      if (orderFilter.status === 'all') return true;
      if (orderFilter.status === 'open') return ['ANGEFORDERT','BESTELLT','TEILGELIEFERT'].includes(o.status);
      if (orderFilter.status === 'requested') return o.status === 'ANGEFORDERT';
      if (orderFilter.status === 'ordered') return o.status === 'BESTELLT' || o.status === 'TEILGELIEFERT';
      if (orderFilter.status === 'delivered') return o.status === 'ERLEDIGT';
      if (orderFilter.status === 'rejected') return o.status === 'ABGELEHNT';
      return true;
    })
    .sort((a, b) => new Date(orderSortDate(b) || 0) - new Date(orderSortDate(a) || 0));
}

function orderSortDate(order) {
  return order.orderedAt || order.createdAt || order.lastUpdate || '';
}

function orderDateLabel(order) {
  const date = orderSortDate(order);
  return date ? fmtDate(date) : '-';
}

function orderConfirmationLabel(order) {
  return '';
}

function renderCustomerPdfList(dateKey, customerKey, title, emptyText, list, badgeText, openFn) {
  if (!list.length) return '';
  return `<div class="order-day-confirmations">
    <strong>${escapeHtml(title)}</strong>
    <div class="ab-list">
      ${list.map(item => `<div class="ab-item"><span class="badge green">${escapeHtml(badgeText)}</span><button class="ghost mini" onclick="${openFn}('${jsString(dateKey)}','${jsString(customerKey)}','${jsString(item.id)}')">Öffnen</button><div class="small muted">${escapeHtml(item.originalName || 'Dokument.pdf')} · ${escapeHtml(item.uploadedBy || '-')} · ${fmtDate(item.uploadedAt)}</div></div>`).join('')}
    </div>
  </div>`;
}

function renderOrderCustomerDocuments(dateKey, customerKey) {
  return `
    ${renderCustomerPdfList(dateKey, customerKey, 'Auftragsbestätigungen für diesen Lieferanten', '', orderCustomerConfirmations(dateKey, customerKey), 'AB PDF', 'openOrderCustomerConfirmation')}
    ${renderCustomerPdfList(dateKey, customerKey, 'Lieferscheine für diesen Lieferanten', '', orderCustomerDeliveryNotes(dateKey, customerKey), 'LS PDF', 'openOrderCustomerDeliveryNote')}
  `;
}

function renderOrderCustomerKonsiDocuments(dateKey, customerKey) {
  return `
    ${renderCustomerPdfList(dateKey, customerKey, 'Konsi-Auftragsbestätigungen für diesen Lieferanten', '', orderCustomerKonsiConfirmations(dateKey, customerKey), 'Konsi AB', 'openOrderCustomerKonsiConfirmation')}
    ${renderCustomerPdfList(dateKey, customerKey, 'Konsi-Lieferscheine für diesen Lieferanten', '', orderCustomerKonsiDeliveryNotes(dateKey, customerKey), 'Konsi LS', 'openOrderCustomerKonsiDeliveryNote')}
  `;
}

function renderOrderDayConfirmations(dateKey) {
  return '';
}

function groupOrdersByDay(orders) {
  const map = new Map();
  (orders || []).forEach(order => {
    const key = orderDayKey(order);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(order);
  });
  return Array.from(map.entries())
    .map(([dateKey, items]) => ({
      dateKey,
      orders: items.sort((a, b) => new Date(orderSortDate(b) || 0) - new Date(orderSortDate(a) || 0))
    }))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

function groupOrdersByCustomer(orders) {
  const map = new Map();
  (orders || []).forEach(order => {
    const key = orderCustomerKey(order);
    if (!map.has(key)) map.set(key, { customerKey: key, customerName: orderCustomerName(order), orders: [] });
    map.get(key).orders.push(order);
  });
  return Array.from(map.values())
    .map(group => ({ ...group, orders: group.orders.sort((a, b) => new Date(orderSortDate(b) || 0) - new Date(orderSortDate(a) || 0)) }))
    .sort((a, b) => a.customerName.localeCompare(b.customerName, 'de'));
}


function orderSearchIsSupplierFocused(orders) {
  const text = String(orderFilter.text || '').trim();
  if (!text) return false;
  return (orders || []).some(order => searchMatches(orderCustomerName(order), text));
}

function groupOrdersBySupplierAcrossDates(orders) {
  return groupOrdersByCustomer(orders).map(group => ({
    ...group,
    orders: group.orders.sort((a, b) => new Date(orderSortDate(b) || 0) - new Date(orderSortDate(a) || 0))
  }));
}

function renderOrdersGroupedBySupplier(orders, withActions) {
  const suppliers = groupOrdersBySupplierAcrossDates(orders);
  return suppliers.map(customer => {
    const normalOrders = customer.orders.filter(o => o.storage !== 'KONSI');
    const konsiOrders = customer.orders.filter(o => o.storage === 'KONSI');
    const dates = Array.from(new Set(customer.orders.map(orderDayKey))).sort((a, b) => b.localeCompare(a));
    const subtitle = `${customer.orders.length} Vorgang/Vorgänge · ${dates.length} Datum/Datumsangaben`;
    return `<div class="order-day-group supplier-search-group">
      <div class="order-day-head">
        <div><h3>Lieferant: ${escapeHtml(customer.customerName)}</h3><div class="small muted">${escapeHtml(subtitle)} zusammengefasst</div></div>
      </div>
      ${normalOrders.length ? `<div class="order-subgroup-title"><strong>Bestellungen / Lieferungen</strong></div>${renderOrdersTable(normalOrders, withActions, { showDateBeforeMaterial: true, hideSupplierLine: true })}` : ''}
      ${konsiOrders.length ? `<div class="order-subgroup-title konsi"><strong>Konsi separat</strong></div>${renderOrdersTable(konsiOrders, withActions, { showDateBeforeMaterial: true, hideSupplierLine: true })}` : ''}
    </div>`;
  }).join('');
}

function renderOrdersGrouped(orders, withActions) {
  if (orderSearchIsSupplierFocused(orders)) return renderOrdersGroupedBySupplier(orders, withActions);
  const groups = groupOrdersByDay(orders);
  return groups.map(group => {
    const orderCount = group.orders.filter(o => !o.directIncoming).length;
    const incomingCount = group.orders.filter(o => o.directIncoming).length;
    const customers = groupOrdersByCustomer(group.orders);
    const titleParts = [];
    if (orderCount) titleParts.push(`${orderCount} Bestellung(en)`);
    if (incomingCount) titleParts.push(`${incomingCount} Wareneingang`);
    titleParts.push(`${customers.length} Lieferant(en)`);
    return `<div class="order-day-group">
      <div class="order-day-head">
        <div><h3>Bestellungen vom ${orderDayLabel(group.dateKey)}</h3><div class="small muted">${titleParts.join(' · ')} zusammengefasst</div></div>
      </div>
      ${customers.map(customer => {
        const normalOrders = customer.orders.filter(o => o.storage !== 'KONSI');
        const konsiOrders = customer.orders.filter(o => o.storage === 'KONSI');
        const customerOrderCount = normalOrders.filter(o => !o.directIncoming).length;
        const customerIncomingCount = normalOrders.filter(o => o.directIncoming).length;
        const customerKonsiCount = konsiOrders.length;
        const subtitle = [customerOrderCount ? `${customerOrderCount} Bestellung(en)` : '', customerIncomingCount ? `${customerIncomingCount} Wareneingang` : '', customerKonsiCount ? `${customerKonsiCount} Konsi` : ''].filter(Boolean).join(' · ') || `${customer.orders.length} Vorgang/Vorgänge`;
        return `<div class="order-customer-group">
          <div class="order-customer-head">
            <div><h4>Lieferant: ${escapeHtml(customer.customerName)}</h4><div class="small muted">${escapeHtml(subtitle)}</div></div>
            <div class="row-actions">
              ${customerOrderCount ? `<button class="ghost mini" onclick="uploadOrderCustomerConfirmation('${jsString(group.dateKey)}','${jsString(customer.customerKey)}')">AB PDF hochladen</button>` : ''}
              ${(customerOrderCount || customerIncomingCount) ? `<button class="ghost mini" onclick="uploadOrderCustomerDeliveryNote('${jsString(group.dateKey)}','${jsString(customer.customerKey)}')">Lieferschein PDF hochladen</button>` : ''}
            </div>
          </div>
          ${normalOrders.length ? `${renderOrderCustomerDocuments(group.dateKey, customer.customerKey)}<div class="order-subgroup-title"><strong>Bestellungen / Lieferungen</strong></div>${renderOrdersTable(normalOrders, withActions)}` : ''}
          ${konsiOrders.length ? `<div class="order-subgroup-title konsi"><strong>Konsi separat</strong><span class="row-actions"><button class="ghost mini" onclick="uploadOrderCustomerKonsiConfirmation('${jsString(group.dateKey)}','${jsString(customer.customerKey)}')">Konsi AB hochladen</button><button class="ghost mini" onclick="uploadOrderCustomerKonsiDeliveryNote('${jsString(group.dateKey)}','${jsString(customer.customerKey)}')">Konsi Lieferschein hochladen</button></span></div>${renderOrderCustomerKonsiDocuments(group.dateKey, customer.customerKey)}${renderOrdersTable(konsiOrders, withActions)}` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

function orderFilterPanel(orders, filtered) {
  return `
    <div class="filter-panel order-filter-panel">
      <div class="searchbar inline-search"><strong>Lieferung / Bestellung suchen</strong><input id="orderSearch" placeholder="Material, Ablageort, Hinweis, Benutzer oder Datum suchen ..." value="${escapeHtml(orderFilter.text)}"></div>
      <div class="filter-row"><span>Status</span>
        ${filterButton(orderFilter.status === 'all', 'Alle', "setOrderFilter('all')")}
        ${filterButton(orderFilter.status === 'open', 'Offen', "setOrderFilter('open')")}
        ${filterButton(orderFilter.status === 'requested', 'Angefordert', "setOrderFilter('requested')")}
        ${filterButton(orderFilter.status === 'ordered', 'Bestellt / Lieferung offen', "setOrderFilter('ordered')")}
        ${filterButton(orderFilter.status === 'delivered', 'Geliefert', "setOrderFilter('delivered')")}
        ${filterButton(orderFilter.status === 'rejected', 'Abgelehnt', "setOrderFilter('rejected')")}
      </div>
      <div class="filter-summary"><span id="orderFilterCount">${filtered.length} von ${orders.length} Vorgängen</span><button class="ghost mini" onclick="resetOrderFilters()">Filter zurücksetzen</button></div>
    </div>`;
}

function currentOrderBaseList() {
  return state.orders || [];
}

function drawOrdersList() {
  const incoming = currentOrderBaseList();
  const filtered = filteredOrdersList(incoming);
  const count = $('#orderFilterCount');
  if (count) count.textContent = `${filtered.length} von ${incoming.length} Vorgängen`;
  const box = $('#ordersResult');
  if (box) box.innerHTML = filtered.length ? renderOrdersGrouped(filtered, true) : '<div class="empty">Keine Bestellung oder Lieferung gefunden.</div>';
}

function renderOrders() {
  const incoming = currentOrderBaseList();
  const filtered = filteredOrdersList(incoming);
  const canOpenOrderCapture = state.permissions.canRequestOrder || state.permissions.canReceiveDelivery;
  $('#orders').innerHTML = `
    <div class="toolbar">
      ${canOpenOrderCapture ? '<button class="primary" onclick="openOrderModal()">Vorgang erfassen</button>' : ''}
      <button class="secondary" onclick="loadState()">Aktualisieren</button>
    </div>
    ${orderFilterPanel(incoming, filtered)}
    <div class="card">
      <h2>Bestellungen nach Tag und Lieferant</h2>
      <div id="ordersResult">${filtered.length ? renderOrdersGrouped(filtered, true) : '<div class="empty">Keine Bestellung oder Lieferung gefunden.</div>'}</div>
    </div>
  `;
  $('#orderSearch').addEventListener('input', (event) => {
    orderFilter.text = event.target.value;
    drawOrdersList();
  });
}

function renderOrdersTable(orders, withActions, options = {}) {
  const showDateBeforeMaterial = Boolean(options.showDateBeforeMaterial);
  const hideSupplierLine = Boolean(options.hideSupplierLine);
  return `
    <table>
      <thead><tr><th>Status</th><th>Material</th><th>Menge</th><th>Info</th><th>Verlauf</th>${withActions ? '<th>Aktion</th>' : ''}</tr></thead>
      <tbody>
        ${orders.map(o => `
          <tr>
            <td>${o.directIncoming ? '<span class="badge green">Wareneingang</span>' : `${statusBadge(o.status)}${o.storage === 'KONSI' ? '<br><span class="badge red">Konsi</span>' : ''}${(o.manualOrder || o.manualRequest) ? '<br><span class="badge gray">Handeingabe</span>' : ''}`}</td>
            <td>${showDateBeforeMaterial ? `<span class="badge gray">${escapeHtml(orderDayLabel(orderDayKey(o)))}</span><br>` : ''}<strong class="order-material-title">${escapeHtml(orderMaterialTitle(o))}</strong>${orderDimensionLine(o)}${hideSupplierLine ? '' : `<div class="small muted">Lieferant: ${escapeHtml(orderCustomerName(o))}</div>`}<div class="small muted">${o.directIncoming ? 'Erfasst von' : (o.manualOrder ? 'Bestellung erfasst von' : (o.manualRequest ? 'Per Handeingabe angefragt von' : 'Angefragt von'))} ${escapeHtml(o.requestedBy)} · ${fmtDate(o.createdAt)}</div>${o.directIncoming ? '<div class="small muted">ohne vorherige Bestellung</div>' : ''}${o.manualOrder ? '<div class="small muted">Bestellung per Handeingabe</div>' : ''}${o.manualRequest ? '<div class="small muted">Freie Materialanfrage</div>' : ''}${orderConfirmationLabel(o)}${orderPriceLine(o)}</td>
            <td>${o.directIncoming ? `Wareneingang: <strong>${orderQuantityLabel(o, 'received')}</strong>${orderDimensionLine(o)}${o.deliveredToShelf ? `<br><span class="small muted">Ablage: ${escapeHtml(o.deliveredToShelf)}</span>` : ''}` : `Anfrage: <strong>${orderQuantityLabel(o, 'request')}</strong>${o.orderedAmount ? `<br>Bestellt: <strong>${orderQuantityLabel(o, 'ordered')}</strong>` : ''}${(Number(o.receivedAmount)||Number(o.receivedSheets)) ? `<br>Geliefert: <strong>${orderQuantityLabel(o, 'received')}</strong>${orderDimensionLine(o)}${o.deliveredToShelf ? `<br><span class="small muted">Ablage: ${escapeHtml(o.deliveredToShelf)}</span>` : ''}` : ''}`}</td>
            <td class="order-note">${escapeHtml(o.note || '-')}</td>
            <td>${orderFlow(o.status)}<div class="small muted">Letzte Änderung: ${fmtDate(o.lastUpdate)}</div>${o.status === 'ERLEDIGT' ? `<div class="small muted">Geliefert: ${fmtDate(o.receivedAt || o.lastUpdate)}</div>` : ''}</td>
            ${withActions ? `<td>${renderOrderActions(o)}</td>` : ''}
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

function renderOrderActions(order) {
  const actions = [];
  const hasBookedIncoming = ['ERLEDIGT','TEILGELIEFERT'].includes(order.status) && (order.directIncoming || Number(order.receivedAmount || 0) > 0 || Number(order.receivedSheets || 0) > 0 || (Array.isArray(order.deliveries) && order.deliveries.length));
  if (state.permissions.canCorrectIncoming && hasBookedIncoming) {
    actions.push(`<button class="primary mini" onclick="openEditDirectIncomingModal('${jsString(order.id)}')">Wareneingang ändern</button>`);
  }
  if (state.permissions.canMarkOrdered && order.status === 'ANGEFORDERT') {
    actions.push(`<button class="primary mini" onclick="openOrderedModal('${jsString(order.id)}')">Bestellt</button>`);
    actions.push(`<button class="secondary danger mini" onclick="updateOrder('${jsString(order.id)}','REJECT')">Ablehnen</button>`);
  }
  if (state.permissions.canMarkOrdered && order.status === 'FREIGEGEBEN') actions.push(`<button class="primary mini" onclick="openOrderedModal('${jsString(order.id)}')">Bestellt</button>`);
  if (state.permissions.canMarkOrdered) actions.push(`<button class="ghost mini" onclick="openOrderSupplierModal('${jsString(order.id)}')">Lieferant ändern</button>`);
  if (state.permissions.canCorrectIncoming && hasBookedIncoming) actions.push(`<button class="secondary danger mini" onclick="openUndoDeliveryModal('${jsString(order.id)}')">Geliefert rückgängig</button>`);
  if (state.permissions.canReceiveDelivery && (order.status === 'BESTELLT' || order.status === 'TEILGELIEFERT')) actions.push(`<button class="primary mini" onclick="openReceiveModal('${jsString(order.id)}')">Lieferung annehmen</button>`);
  return `<div class="row-actions">${actions.join('') || '<span class="small muted">Keine Aktion</span>'}</div>`;
}


function writtenOffTitle(item) {
  const name = String(item.materialName || item.name || '').trim() || 'Material';
  const thickness = normalizeThicknessInput(item.materialThickness || item.thickness || '').trim();
  if (!thickness) return name;
  const lowerName = name.toLowerCase();
  const lowerThickness = thickness.toLowerCase();
  const numberOnly = lowerThickness.replace(/\s*mm$/i, '').trim();
  if (lowerName.includes(lowerThickness) || (numberOnly && lowerName.includes(numberOnly + ' mm'))) return name;
  return `${name} ${thickness}`;
}

function writtenOffSearchText(item) {
  return [
    writtenOffTitle(item), item.materialFormat, item.supplier, item.shelf, item.compartment, item.articleNumber,
    item.quantityBefore, item.note, item.writtenOffBy, item.writtenOffAt ? fmtDate(item.writtenOffAt) : '',
    item.sourceCustomerName, item.sourceDateKey,
    ...(Array.isArray(item.documents) ? item.documents.map(doc => [doc.label, doc.originalName, doc.uploadedBy].join(' ')) : [])
  ].join(' ').toLowerCase();
}

function filteredWrittenOffList() {
  const text = String(writtenOffFilter.text || '').trim().toLowerCase();
  return (state.writtenOffMaterials || [])
    .filter(item => !text || searchMatches(writtenOffSearchText(item), text))
    .sort((a, b) => new Date(b.writtenOffAt || 0) - new Date(a.writtenOffAt || 0));
}

function writtenOffDocumentButtons(item) {
  const docs = Array.isArray(item.documents) ? item.documents : [];
  if (!docs.length) return '<div class="small muted">Keine AB/Lieferschein-PDF übernommen.</div>';
  return `<div class="written-off-docs">
    ${docs.map(doc => `<button class="ghost mini" onclick="openWrittenOffDocument('${jsString(item.id)}','${jsString(doc.id || doc.fileName)}')">${escapeHtml(doc.label || doc.type || 'PDF')}</button>`).join('')}
  </div>`;
}

function renderWrittenOffCard(item) {
  const priceLine = canSeePrices() ? [
    item.kgPrice !== undefined && item.kgPrice !== null && item.kgPrice !== '' ? `KG-Preis: ${formatKgPrice(item.kgPrice)}` : '',
    Number(item.totalWeightKg) > 0 ? `Gewicht: ${String(Number(item.totalWeightKg).toFixed(1)).replace('.', ',')} kg` : '',
    Number(item.totalPrice) > 0 ? `Wert: ${formatMoney(item.totalPrice)}` : ''
  ].filter(Boolean).join(' · ') : '';
  return `<div class="material-card written-off-card">
    <div class="card-topline"><span class="badge gray">Ausgebucht</span><span>${escapeHtml(fmtDate(item.writtenOffAt))}</span></div>
    <h3>${escapeHtml(writtenOffTitle(item))}</h3>
    <div class="meta-grid">
      <div><span>Format</span><strong>${escapeHtml(item.materialFormat || '-')}</strong></div>
      <div><span>Vorher</span><strong>${escapeHtml(item.quantityBefore || `${item.stockBefore || 0}`)}</strong></div>
      <div><span>Lieferant</span><strong>${escapeHtml(item.supplier || item.sourceCustomerName || 'Ohne Lieferant')}</strong></div>
      <div><span>Ablage vorher</span><strong>${escapeHtml([item.shelf, item.compartment].filter(Boolean).join(' · ') || '-')}</strong></div>
      ${item.articleNumber ? `<div><span>Teilenr.</span><strong>${escapeHtml(item.articleNumber)}</strong></div>` : ''}
      ${priceLine ? `<div class="form-full"><span>Preis</span><strong>${escapeHtml(priceLine)}</strong></div>` : ''}
    </div>
    <div class="small muted">Ausgebucht von ${escapeHtml(item.writtenOffBy || '-')} · Quelle: ${escapeHtml(item.sourceCustomerName || item.supplier || 'Ohne Lieferant')}${item.sourceDateKey ? ` · ${escapeHtml(orderDayLabel(item.sourceDateKey))}` : ''}</div>
    ${item.note ? `<div class="notice small">${escapeHtml(item.note)}</div>` : ''}
    <div class="actions">
      ${item.certificate ? `<button class="ghost mini" onclick="openWrittenOffCertificate('${jsString(item.id)}')">Werkszeugnis</button>` : '<span class="small muted">Kein Werkszeugnis</span>'}
      ${writtenOffDocumentButtons(item)}
    </div>
  </div>`;
}

function renderWrittenOff() {
  const all = state.writtenOffMaterials || [];
  const filtered = filteredWrittenOffList();
  $('#writtenOff').innerHTML = `
    <div class="toolbar"><button class="secondary" onclick="loadState()">Aktualisieren</button></div>
    <div class="filter-panel">
      <div class="searchbar inline-search"><strong>Ausgebuchte Materialien suchen</strong><input id="writtenOffSearch" placeholder="Material, Lieferant, Datum, AB oder Lieferschein suchen ..." value="${escapeHtml(writtenOffFilter.text)}"></div>
      <div class="filter-summary"><span>${filtered.length} von ${all.length} ausgebuchten Materialkarten</span><button class="ghost mini" onclick="writtenOffFilter.text=''; renderWrittenOff();">Filter zurücksetzen</button></div>
    </div>
    <div class="card">
      <h2>Ausgebuchte Materialien</h2>
      ${filtered.length ? `<div class="material-grid">${filtered.map(renderWrittenOffCard).join('')}</div>` : '<div class="empty">Noch kein komplett ausgebuchtes Material vorhanden.</div>'}
    </div>`;
  $('#writtenOffSearch').addEventListener('input', (event) => { writtenOffFilter.text = event.target.value; renderWrittenOff(); });
}

window.openWrittenOffCertificate = (id) => {
  if (!token) return showToast('Nicht angemeldet', 'Bitte neu anmelden.');
  window.open(`/api/written-off/${encodeURIComponent(id)}/certificate?token=${encodeURIComponent(token)}`, '_blank');
};

window.openWrittenOffDocument = (id, fileId) => {
  if (!token) return showToast('Nicht angemeldet', 'Bitte neu anmelden.');
  window.open(`/api/written-off/${encodeURIComponent(id)}/documents/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`, '_blank');
};


window.openOrderCustomerConfirmation = (dateKey, customerKey, fileId) => {
  if (!token) return showToast('Nicht angemeldet', 'Bitte neu anmelden.');
  window.open(`/api/order-groups/${encodeURIComponent(dateKey)}/${encodeURIComponent(customerKey)}/confirmations/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`, '_blank');
};

window.openOrderCustomerDeliveryNote = (dateKey, customerKey, fileId) => {
  if (!token) return showToast('Nicht angemeldet', 'Bitte neu anmelden.');
  window.open(`/api/order-groups/${encodeURIComponent(dateKey)}/${encodeURIComponent(customerKey)}/delivery-notes/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`, '_blank');
};

window.openOrderCustomerKonsiConfirmation = (dateKey, customerKey, fileId) => {
  if (!token) return showToast('Nicht angemeldet', 'Bitte neu anmelden.');
  window.open(`/api/order-groups/${encodeURIComponent(dateKey)}/${encodeURIComponent(customerKey)}/konsi-confirmations/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`, '_blank');
};

window.openOrderCustomerKonsiDeliveryNote = (dateKey, customerKey, fileId) => {
  if (!token) return showToast('Nicht angemeldet', 'Bitte neu anmelden.');
  window.open(`/api/order-groups/${encodeURIComponent(dateKey)}/${encodeURIComponent(customerKey)}/konsi-delivery-notes/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`, '_blank');
};

window.openOrderCustomerKonsiDocument = (dateKey, customerKey, fileId) => {
  if (!token) return showToast('Nicht angemeldet', 'Bitte neu anmelden.');
  window.open(`/api/order-groups/${encodeURIComponent(dateKey)}/${encodeURIComponent(customerKey)}/konsi-documents/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`, '_blank');
};

function uploadOrderCustomerPdf(dateKey, customerKey, endpoint, successTitle, successText) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return showToast('Falsche Datei', 'Bitte eine PDF-Datei auswählen.');
    if (file.size > 15 * 1024 * 1024) return showToast('PDF zu groß', 'Bitte maximal 15 MB hochladen.');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api(`/api/order-groups/${encodeURIComponent(dateKey)}/${encodeURIComponent(customerKey)}/${endpoint}`, { method: 'POST', body: JSON.stringify({ fileName: file.name, data: reader.result }) });
        showToast(successTitle, successText);
        await loadState();
        currentPage = 'orders';
        renderCurrentPage();
      } catch (err) { showToast('Upload fehlgeschlagen', err.message || 'Die PDF konnte nicht gespeichert werden.'); }
    };
    reader.onerror = () => showToast('PDF konnte nicht gelesen werden', 'Bitte die Datei erneut auswählen.');
    reader.readAsDataURL(file);
  });
  input.click();
}

window.uploadOrderCustomerConfirmation = (dateKey, customerKey) => uploadOrderCustomerPdf(dateKey, customerKey, 'confirmation', 'Auftragsbestätigung gespeichert', `Die PDF wurde für den Lieferanten am ${orderDayLabel(dateKey)} abgelegt.`);
window.uploadOrderCustomerDeliveryNote = (dateKey, customerKey) => uploadOrderCustomerPdf(dateKey, customerKey, 'delivery-note', 'Lieferschein gespeichert', `Der Lieferschein wurde für den Lieferanten am ${orderDayLabel(dateKey)} abgelegt.`);
window.uploadOrderCustomerKonsiConfirmation = (dateKey, customerKey) => uploadOrderCustomerPdf(dateKey, customerKey, 'konsi-confirmation', 'Konsi-Auftragsbestätigung gespeichert', `Die Konsi-AB wurde für den Lieferanten am ${orderDayLabel(dateKey)} abgelegt.`);
window.uploadOrderCustomerKonsiDeliveryNote = (dateKey, customerKey) => uploadOrderCustomerPdf(dateKey, customerKey, 'konsi-delivery-note', 'Konsi-Lieferschein gespeichert', `Der Konsi-Lieferschein wurde für den Lieferanten am ${orderDayLabel(dateKey)} abgelegt.`);
window.uploadOrderCustomerKonsiDocument = window.uploadOrderCustomerKonsiConfirmation;

function uploadPdfFileToOrderCustomer(dateKey, customerKey, endpoint, file) {
  if (!file) return Promise.resolve(false);
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return Promise.reject(new Error('Bitte eine PDF-Datei auswählen.'));
  if (file.size > 15 * 1024 * 1024) return Promise.reject(new Error('PDF ist zu groß. Maximal 15 MB.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api(`/api/order-groups/${encodeURIComponent(dateKey)}/${encodeURIComponent(customerKey)}/${endpoint}`, { method: 'POST', body: JSON.stringify({ fileName: file.name, data: reader.result }) });
        resolve(true);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('PDF konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

function readPdfFileAsDataUrl(file) {
  if (!file) return Promise.resolve('');
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return Promise.reject(new Error('Bitte eine PDF-Datei auswählen.'));
  if (file.size > 15 * 1024 * 1024) return Promise.reject(new Error('PDF ist zu groß. Maximal 15 MB.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('PDF konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

async function certificatePayloadFromInput(inputId) {
  const input = $('#'+inputId);
  const file = input && input.files ? input.files[0] : null;
  if (!file) return {};
  const data = await readPdfFileAsDataUrl(file);
  return { certificateFileName: file.name, certificateData: data };
}

// Alte Tagesfunktionen bleiben als Weiterleitung für bestehende Buttons/Tests erhalten.
window.openOrderDayConfirmation = (dateKey, fileId) => window.openOrderCustomerConfirmation(dateKey, 'ohne_kunde', fileId);
window.openOrderDayDeliveryNote = (dateKey, fileId) => window.openOrderCustomerDeliveryNote(dateKey, 'ohne_kunde', fileId);
window.openOrderDayKonsiDocument = (dateKey, fileId) => window.openOrderCustomerKonsiConfirmation(dateKey, 'ohne_kunde', fileId);
window.uploadOrderDayConfirmation = (dateKey) => window.uploadOrderCustomerConfirmation(dateKey, 'ohne_kunde');
window.uploadOrderDayDeliveryNote = (dateKey) => window.uploadOrderCustomerDeliveryNote(dateKey, 'ohne_kunde');
window.uploadOrderDayKonsiDocument = (dateKey) => window.uploadOrderCustomerKonsiConfirmation(dateKey, 'ohne_kunde');
function uploadOrderDayPdf(dateKey, endpoint, successTitle, successText) { return uploadOrderCustomerPdf(dateKey, 'ohne_kunde', endpoint, successTitle, successText); }
function uploadPdfFileToOrderDay(dateKey, endpoint, file) { return uploadPdfFileToOrderCustomer(dateKey, 'ohne_kunde', endpoint, file); }

window.openOrderConfirmation = (orderId) => {
  if (!token) return showToast('Nicht angemeldet', 'Bitte neu anmelden.');
  window.open(`/api/orders/${encodeURIComponent(orderId)}/confirmation?token=${encodeURIComponent(token)}`, '_blank');
};

window.uploadOrderConfirmation = (orderId) => {
  const order = (state.orders || []).find(o => o.id === orderId);
  if (!order) return showToast('Bestellung fehlt', 'Die Bestellung wurde nicht gefunden.');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return showToast('Falsche Datei', 'Bitte eine PDF-Datei auswählen.');
    const maxBytes = 15 * 1024 * 1024;
    if (file.size > maxBytes) return showToast('PDF zu groß', 'Bitte maximal 15 MB hochladen.');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api(`/api/orders/${encodeURIComponent(orderId)}/confirmation`, {
          method: 'POST',
          body: JSON.stringify({ fileName: file.name, data: reader.result })
        });
        showToast('Auftragsbestätigung gespeichert', 'Die PDF wurde bei der Bestellung abgelegt.');
        await loadState();
        currentPage = 'orders';
        render();
      } catch (err) {
        showToast('Upload fehlgeschlagen', err.message || 'Die PDF konnte nicht gespeichert werden.');
      }
    };
    reader.onerror = () => showToast('PDF konnte nicht gelesen werden', 'Bitte die Datei erneut auswählen.');
    reader.readAsDataURL(file);
  });
  input.click();
};


window.openMaterialCertificate = (materialId) => {
  if (!token) return showToast('Nicht angemeldet', 'Bitte neu anmelden.');
  window.open(`/api/materials/${encodeURIComponent(materialId)}/certificate?token=${encodeURIComponent(token)}`, '_blank');
};

window.uploadMaterialCertificate = (materialId) => {
  const material = (state.materials || []).find(m => m.id === materialId);
  if (!material) return showToast('Material fehlt', 'Material wurde nicht gefunden.');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return showToast('Falsche Datei', 'Bitte eine PDF-Datei auswählen.');
    if (file.size > 15 * 1024 * 1024) return showToast('PDF zu groß', 'Bitte maximal 15 MB hochladen.');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api(`/api/materials/${encodeURIComponent(materialId)}/certificate`, { method: 'POST', body: JSON.stringify({ fileName: file.name, data: reader.result }) });
        showToast('Werkszeugnis gespeichert', materialTitle(material));
        await loadState(true);
        renderCurrentPage();
      } catch (err) { showToast('Upload fehlgeschlagen', err.message || 'Die PDF konnte nicht gespeichert werden.'); }
    };
    reader.onerror = () => showToast('PDF konnte nicht gelesen werden', 'Bitte die Datei erneut auswählen.');
    reader.readAsDataURL(file);
  });
  input.click();
};

window.openMaterialPriceModal = (materialId) => {
  if (!canSeePrices()) return showToast('Keine Berechtigung', 'KG-Preise sind nur für Büro und Chef sichtbar.');
  const material = (state.materials || []).find(m => m.id === materialId);
  if (!material) return showToast('Material fehlt', 'Material wurde nicht gefunden.');
  openModal(`
    <h2>KG-Preis bearbeiten</h2>
    <p><strong>${escapeHtml(materialTitle(material))}</strong><br><span class="muted">Nur sichtbar für Büro und Chef.</span></p>
    <form id="materialPriceForm" class="form-grid">
      <div><label>KG-Preis €/kg</label><input id="materialKgPrice" type="number" min="0" step="0.01" value="${material.kgPrice ?? ''}" placeholder="z. B. 2,35"></div>
      <div class="form-full"><div class="notice">Beim Liefergewicht wird daraus automatisch der Warenwert berechnet.</div></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Speichern</button></div>
    </form>
  `);
  $('#materialPriceForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api(`/api/materials/${encodeURIComponent(materialId)}/price`, { method: 'POST', body: JSON.stringify({ kgPrice: $('#materialKgPrice').value }) });
      closeModal();
      showToast('KG-Preis gespeichert', materialTitle(material));
      await loadState(true);
      renderCurrentPage();
    } catch (error) { showToast('Fehler', error.message); }
  });
};

function renderHistory() {
  const withdrawals = withdrawalActivityList();
  const filtered = filteredWithdrawalActivities(withdrawals);
  $('#history').innerHTML = `
    <div class="card">
      <h2>Entnahmen suchen</h2>
      <p class="muted">Hier werden nur Entnahmen angezeigt. Suche nach Material, Teilenr., Stärke, Format, Benutzer oder Datum.</p>
      <div class="searchbar inline-search"><strong>Entnahme</strong><input id="withdrawalHistorySearch" placeholder="z. B. 1.4571, AlMg3, Max, 08.07.2026 ..." value="${escapeHtml(withdrawalHistoryFilter.text)}"></div>
      <div class="filter-summary"><span id="withdrawalHistoryCount">${filtered.length} von ${withdrawals.length} Entnahme(n)</span><button class="ghost mini" onclick="resetWithdrawalHistorySearch()">Suche zurücksetzen</button></div>
      <div id="withdrawalHistoryResult">${filtered.length ? renderActivityList(filtered) : '<div class="empty">Keine Entnahme gefunden.</div>'}</div>
    </div>
    <div class="card"><h2>Gesamte Historie</h2>${renderActivityList(state.activities)}</div>
  `;
  const input = $('#withdrawalHistorySearch');
  if (input) input.addEventListener('input', (event) => {
    withdrawalHistoryFilter.text = event.target.value;
    drawWithdrawalHistoryList();
  });
}

function withdrawalActivityList() {
  return (state.activities || [])
    .filter(a => normalizeSearchText(`${a.type || ''} ${a.text || ''}`).includes('entnommen'))
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
}

function activityRelatedMaterialSearchText(activity) {
  if (!activity) return '';
  const ids = [activity.materialId, ...(Array.isArray(activity.materialIds) ? activity.materialIds : [])].filter(Boolean);
  if (!ids.length) return '';
  const allMaterials = [...(state.materials || []), ...(state.archivedMaterials || [])];
  return allMaterials
    .filter(m => ids.includes(m.id))
    .map(m => materialSearchText(m))
    .join(' ');
}

function withdrawalActivitySearchText(activity) {
  return [
    activity && activity.type,
    activity && activity.text,
    activity && activity.user,
    activityRelatedMaterialSearchText(activity),
    activity && activity.at ? fmtDate(activity.at) : '',
    activity && activity.at ? new Date(activity.at).toLocaleDateString('de-DE') : ''
  ].filter(Boolean).join(' ');
}

function filteredWithdrawalActivities(base = withdrawalActivityList()) {
  const query = String(withdrawalHistoryFilter.text || '');
  return base.filter(a => searchMatches(withdrawalActivitySearchText(a), query));
}

function drawWithdrawalHistoryList() {
  const withdrawals = withdrawalActivityList();
  const filtered = filteredWithdrawalActivities(withdrawals);
  const count = $('#withdrawalHistoryCount');
  if (count) count.textContent = `${filtered.length} von ${withdrawals.length} Entnahme(n)`;
  const box = $('#withdrawalHistoryResult');
  if (box) box.innerHTML = filtered.length ? renderActivityList(filtered) : '<div class="empty">Keine Entnahme gefunden.</div>';
}

window.resetWithdrawalHistorySearch = () => {
  withdrawalHistoryFilter.text = '';
  const input = $('#withdrawalHistorySearch');
  if (input) input.value = '';
  drawWithdrawalHistoryList();
};

function renderActivityList(items) {
  if (!items.length) return '<div class="empty">Keine Aktivitäten vorhanden.</div>';
  return `<table><thead><tr><th>Zeit</th><th>Typ</th><th>Meldung</th><th>Benutzer</th></tr></thead><tbody>${items.map(a => `
    <tr><td>${fmtDate(a.at)}</td><td><span class="badge gray">${escapeHtml(a.type)}</span></td><td>${escapeHtml(a.text)}</td><td>${escapeHtml(a.user || '-')}</td></tr>
  `).join('')}</tbody></table>`;
}




function adminMaterialEditSearchText(material) {
  return [
    materialTitle(material),
    material && material.name,
    material && material.thickness,
    material && material.format,
    material && material.articleNumber,
    material && material.shelf,
    material && storageLabel(material),
    material && quantityLabel(material),
    material && (material.rest ? 'Resttafel Restmaterial' : ''),
    material && (material.deliveryPending ? 'Geliefert Wareneingang' : '')
  ].filter(Boolean).join(' ');
}

function adminEditableMaterials() {
  const query = normalizeSearchText(adminMaterialEditFilter || '');
  return (state.materials || [])
    .filter(m => !m.archived)
    .filter(m => !query || normalizeSearchText(adminMaterialEditSearchText(m)).includes(query))
    .sort((a, b) => materialTitle(a).localeCompare(materialTitle(b), 'de', { numeric: true, sensitivity: 'base' }));
}

function adminMaterialEditTableHtml() {
  const materials = adminEditableMaterials();
  const total = (state.materials || []).filter(m => !m.archived).length;
  const visible = materials.slice(0, 120);
  if (!total) return '<div class="empty">Noch keine aktiven Materialien vorhanden.</div>';
  if (!visible.length) return '<div class="empty">Keine Materialien zur Suche gefunden.</div>';
  return `
    <div class="bulk-scroll admin-edit-scroll">
      <table class="admin-edit-table">
        <thead><tr><th>Material</th><th>Stärke</th><th>Format</th><th>Teilenr.</th><th>Bestand</th><th>Lagerplatz</th><th>Status</th><th>Aktion</th></tr></thead>
        <tbody>
          ${visible.map(m => `<tr>
            <td><strong>${escapeHtml(materialTitle(m))}</strong>${m.note ? `<br><small>${escapeHtml(m.note)}</small>` : ''}</td>
            <td>${escapeHtml(normalizeThicknessInput(m.thickness || '') || '-')}</td>
            <td><strong>${escapeHtml(formatDisplayValue(m.format || '-'))}</strong></td>
            <td>${escapeHtml(m.articleNumber || '-')}</td>
            <td>${quantityLabel(m)}</td>
            <td>${escapeHtml(materialLocationLabel(m))}</td>
            <td>${materialStatusBadge(m)}</td>
            <td><div class="row-actions"><button class="secondary mini" onclick="openSystemMaterialEditModal('${jsString(m.id)}')">Korrigieren</button><button class="ghost mini" onclick="openMaterialHistoryModal('${jsString(m.id)}')">Historie</button>${state.permissions.canDeleteNonOrderMaterial && materialCanDeleteWithoutOrderClient(m) ? `<button class="secondary danger mini" onclick="deleteNonOrderMaterial('${jsString(m.id)}')">Löschen</button>` : ''}</div></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="footer-note">${visible.length} von ${materials.length} Treffer(n) sichtbar${materials.length > visible.length ? ' · Suche genauer eingrenzen, um weitere Treffer zu sehen.' : ''}</div>
  `;
}

function renderSystemMaterialEditTable() {
  const target = $('#adminMaterialEditTable');
  if (target) target.innerHTML = adminMaterialEditTableHtml();
}

window.setSystemMaterialEditFilter = (value) => {
  adminMaterialEditFilter = value;
  renderSystemMaterialEditTable();
};

function adminBulkMaterialRowHtml(index) {
  return `
    <tr class="bulk-material-row" data-index="${index}">
      <td><input class="bulk-name" placeholder="z. B. Aluminium"></td>
      <td><input class="bulk-thickness" placeholder="2"></td>
      <td><select class="bulk-format">${formatOptions('3000x1500')}</select></td>
      <td><select class="bulk-shelf">${shelfOptions('Regal 1')}</select></td>
      <td><input class="bulk-sheets" type="number" min="0" step="1" placeholder="0"></td>
      <td><input class="bulk-min" type="number" min="0" step="1" value="2" readonly></td>
      <td class="center"><input class="bulk-rest" type="checkbox" title="Resttafel"></td>
    </tr>
  `;
}

function renderSystemMaterials() {
  const existingCount = (state.materials || []).length;
  const archivedCount = (state.archivedMaterials || []).length;
  const emptyCount = [...(state.materials || []), ...(state.archivedMaterials || [])].filter(isEmptyMaterialClient).length;
  $('#adminMaterials').innerHTML = `
    ${renderSystemSubnav('adminMaterials')}
    <div class="toolbar">
      <button class="primary" onclick="addBulkMaterialRows(5)">5 Zeilen hinzufügen</button>
      <button class="secondary" onclick="submitBulkMaterials()">Materialien anlegen</button>
      <button class="ghost" onclick="clearBulkMaterialRows()">Leeren</button>
      
    </div>
    <div class="card admin-material-card">
      <h2>Materialien mehrfach anlegen</h2>
      <p class="muted">Für die schnelle Erfassung: eine Zeile pro Material ausfüllen. Leere Zeilen werden übersprungen. Stärke wird automatisch mit <strong>mm</strong> gespeichert.</p>
      <div class="bulk-scroll">
        <table class="bulk-material-table">
          <thead><tr><th>Material</th><th>Stärke</th><th>Größe</th><th>Regal</th><th>Tafeln</th><th>Min.</th><th>Rest</th></tr></thead>
          <tbody id="bulkMaterialBody"></tbody>
        </table>
      </div>
      <div class="footer-note">Aktuell angelegte Materialien: ${existingCount}. Normale Tafeln im Hauptlager bekommen Mindestbestand 2. Pakete, Konsi und Reste sind ausgenommen.</div>
    </div>
    <div class="card admin-material-card admin-edit-card">
      <h2>Materialdaten bearbeiten</h2>
      <p class="muted">Für Korrekturen, wenn Material, Stärke, Format oder Lagerplatz falsch angelegt wurde. Der Bestand bleibt dabei unverändert.</p>
      <div class="admin-edit-search"><strong>Suche</strong><input id="adminMaterialEditSearch" value="${escapeHtml(adminMaterialEditFilter)}" placeholder="Material, Stärke, Format oder Regal suchen ..."><button class="ghost mini" onclick="adminMaterialEditFilter=''; renderSystemMaterials();">Leeren</button></div>
      <div id="adminMaterialEditTable">${adminMaterialEditTableHtml()}</div>
    </div>
    <div class="card danger-zone-card">
      <h2>Materialdatenbank leeren</h2>
      <p class="muted">Nur für den Aufbau der echten Datenbank: löscht alle aktiven und archivierten Materialien. Benutzer, Einstellungen und Backups bleiben erhalten. Vor dem Löschen wird automatisch eine Sicherung erstellt.</p>
      <div class="quick-list compact-system-list">
        <div class="quick-item">Aktive Materialien<small>${existingCount}</small></div>
        <div class="quick-item">Archivierte Materialien<small>${archivedCount}</small></div>
        <div class="quick-item">Leere Materialien<small>${emptyCount}</small></div>
      </div>
      <div class="toolbar"><button class="secondary" onclick="deleteEmptyMaterialsSystem()">Leere Materialien löschen</button><button class="secondary" onclick="deleteAllMaterialsSystem()">Alle Materialien löschen</button><span class="badge gray">Backup davor</span></div>
    </div>
  `;
  const body = $('#bulkMaterialBody');
  body.innerHTML = Array.from({ length: 8 }, (_, i) => adminBulkMaterialRowHtml(i)).join('');
  bindBulkMaterialRows();
  const adminSearch = $('#adminMaterialEditSearch');
  if (adminSearch) adminSearch.addEventListener('input', (event) => setSystemMaterialEditFilter(event.target.value));
}

function bindBulkMaterialRows() {
  $$('.bulk-thickness').forEach(input => {
    input.addEventListener('blur', () => { input.value = normalizeThicknessInput(input.value); });
  });
  $$('.bulk-rest').forEach(input => {
    input.addEventListener('change', () => {
      const row = input.closest('tr');
      row.querySelector('.bulk-min').value = input.checked ? 0 : DEFAULT_MATERIAL_MIN_STOCK;
    });
  });
}

window.addBulkMaterialRows = (count = 5) => {
  const body = $('#bulkMaterialBody');
  if (!body) return;
  const start = body.querySelectorAll('tr').length;
  body.insertAdjacentHTML('beforeend', Array.from({ length: count }, (_, i) => adminBulkMaterialRowHtml(start + i)).join(''));
  bindBulkMaterialRows();
};

window.clearBulkMaterialRows = () => {
  if (!confirm('Alle Eingaben in der Mehrfachanlage leeren?')) return;
  renderSystemMaterials();
};

function collectBulkMaterials() {
  return $$('.bulk-material-row').map((row, idx) => {
    const name = row.querySelector('.bulk-name').value.trim();
    const thickness = normalizeThicknessInput(row.querySelector('.bulk-thickness').value);
    const format = row.querySelector('.bulk-format').value;
    const shelf = row.querySelector('.bulk-shelf').value;
    const sheets = Number(row.querySelector('.bulk-sheets').value || 0);
    const rest = row.querySelector('.bulk-rest').checked;
    const minStock = rest ? 0 : DEFAULT_MATERIAL_MIN_STOCK;
    if (!name && !thickness && !sheets) return null;
    if (!name) throw new Error(`Zeile ${idx + 1}: Material fehlt.`);
    if (!Number.isFinite(sheets) || sheets < 0) throw new Error(`Zeile ${idx + 1}: Tafeln ist ungültig.`);
    if (!Number.isFinite(minStock) || minStock < 0) throw new Error(`Zeile ${idx + 1}: Mindestbestand ist ungültig.`);
    return {
      name,
      category: '',
      type: rest ? 'Resttafel' : 'Tafel',
      thickness,
      format,
      unit: 'Tafeln',
      stock: sheets,
      packageStock: 0,
      sheetStock: sheets,
      packageNumbers: [],
      minStock,
      storage: 'HAUPTLAGER',
      shelf,
      compartment: '',
      supplier: '',
      articleNumber: '',
      rest,
      note: ''
    };
  }).filter(Boolean);
}

window.submitBulkMaterials = async () => {
  let materials;
  try {
    materials = collectBulkMaterials();
  } catch (error) {
    return showToast('Fehler', error.message);
  }
  if (!materials.length) return showToast('Keine Eingabe', 'Bitte mindestens eine Material-Zeile ausfüllen.');
  if (!confirm(`${materials.length} Materialposition(en) anlegen?`)) return;
  const created = [];
  try {
    for (const material of materials) {
      await saveMaterialRequest('/api/materials', 'POST', material, false);
      created.push(material.name);
    }
    showToast('Materialien angelegt', `${created.length} Position(en) wurden gespeichert.`);
    await loadState(true);
    currentPage = 'adminMaterials';
    renderCurrentPage();
  } catch (error) {
    showToast('Fehler', error.message);
    await loadState(true);
  }
};

function renderUsers() {
  const users = state.users || [];
  $('#users').innerHTML = `
    ${renderSystemSubnav('users')}
    <div class="toolbar">
      <button class="primary" onclick="openUserModal()">Benutzer anlegen</button>
      <button class="secondary" onclick="loadState()">Aktualisieren</button>
      
    </div>
    <div class="card">
      <h2>Benutzerverwaltung</h2>
      <p class="muted">Hier werden die Zugänge für Laser, Büro und Chef angelegt. Deaktivierte Benutzer können sich nicht mehr anmelden.</p>
      ${renderUsersTable(users, true)}
    </div>
  `;
}

function renderUsersTable(users, withActions = true) {
  if (!users.length) return '<div class="empty">Keine Benutzer vorhanden.</div>';
  return `
    <table>
      <thead><tr><th>Status</th><th>Name</th><th>Benutzer</th><th>Rolle</th><th>Letzter Login</th><th>Passwort</th><th>Aktualisiert</th>${withActions ? '<th>Aktion</th>' : ''}</tr></thead>
      <tbody>${users.map(u => `
        <tr class="${u.active === false ? 'is-inactive' : ''}">
          <td><span class="badge ${u.active === false ? 'gray' : 'green'}">${u.active === false ? 'Deaktiviert' : 'Aktiv'}</span></td>
          <td><strong>${escapeHtml(u.name)}</strong></td>
          <td><code>${escapeHtml(u.username)}</code></td>
          <td>${escapeHtml(roleNames[u.role] || u.role)}</td>
          <td>${fmtDate(u.lastLogin)}</td>
          <td>${u.mustChangePassword ? '<span class="badge amber">Ändern</span>' : '<span class="badge green">OK</span>'}</td>
          <td>${fmtDate(u.updatedAt || u.createdAt)}</td>
          ${withActions ? `<td><div class="row-actions"><button class="ghost mini" onclick="openUserModal('${jsString(u.id)}')">Bearbeiten</button>${u.active === false ? `<button class="secondary mini" onclick="reactivateUser('${jsString(u.id)}')">Aktivieren</button>` : `<button class="secondary danger mini" onclick="deactivateUser('${jsString(u.id)}')">Deaktivieren</button>`}</div></td>` : ''}
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

function renderSystem() {
  if (currentUser.role === 'ADMIN') return renderSystemDashboard();
  const low = state.lowMaterials;
  const konsiCount = state.materials.filter(m => m.storage === 'KONSI').length;
  $('#admin').innerHTML = `
    <div class="split">
      <div class="card"><h2>Materialstatus</h2><div class="quick-list"><div class="quick-item">Materialien<small>${state.materials.length} aktive Einträge</small></div><div class="quick-item">Konsi-Lager<small>${konsiCount} Einträge</small></div><div class="quick-item">Warnungen<small>${low.length} unter Mindestbestand</small></div></div></div>
      <div class="card"><h2>Schnellzugriff</h2><div class="toolbar"><button class="primary" onclick="openMaterialModal()">Material anlegen</button><button class="secondary" onclick="goPage('inventory')">Inventur</button><button class="ghost" onclick="goPage('history')">Historie öffnen</button></div></div>
    </div>
  `;
}

function renderSystemStatus(status) {
  const s = status || {};
  return `<div class="quick-list compact-system-list">
    <div class="quick-item">Programm<small>${escapeHtml(s.appName || 'Eckl Eco Technics - Materialverwaltung')}</small></div>
    <div class="quick-item">Version<small>${escapeHtml(s.version || '-')}</small></div>
    <div class="quick-item">Aktive Benutzer<small>${Number(s.activeUsers || 0)} von ${Number(s.users || 0)}</small></div>
    <div class="quick-item">Datenbank<small>${escapeHtml(s.dbFile || '-')}</small></div>
    <div class="quick-item">Modus<small>${escapeHtml(s.serverMode || 'lokal')}</small></div>
    <div class="quick-item">Server-Adresse<small>${escapeHtml((s.networkUrls && s.networkUrls[0]) || s.localUrl || window.location.origin)}</small></div>
    <div class="quick-item">Serverzeit<small>${fmtDate(s.serverTime)}</small></div>
  </div>`;
}

function renderSystemSettings() {
  const settings = state.settings || {};
  const status = state.systemStatus || {};
  $('#adminSettings').innerHTML = `
    ${renderSystemSubnav('adminSettings')}
    <div class="split">
      <div class="card">
        <h2>Grundeinstellungen</h2>
        <div class="settings-list">
          <div><strong>Regale</strong><span>${(settings.shelves || defaultShelves).map(escapeHtml).join(' · ')}</span></div>
          <div><strong>Standard-Größen</strong><span>${(settings.formats || materialFormats).map(escapeHtml).join(' · ')}</span></div>
          <div><strong>Programmversion</strong><span>${escapeHtml(settings.version || status.version || '-')}</span></div>
          <div><strong>Letzte Inventur</strong><span>${fmtDateOnly((state.inventorySchedule || {}).lastDate)}</span></div>
          <div><strong>Nächste Inventur</strong><span>${fmtDateOnly((state.inventorySchedule || {}).nextDate)} · ${escapeHtml(inventoryTimerText(state.inventorySchedule))}</span></div>
        </div>
        <form id="adminSettingsForm" class="form-grid settings-form">
          <div><label>Letzte Inventur</label><input id="inventoryLastDate" type="date" value="${escapeHtml((state.inventorySchedule || {}).lastDate || settings.inventoryLastDate || '2027-06-30')}"></div>
          <div><label>Inventur-Rhythmus Monate</label><input id="inventoryIntervalMonths" type="number" min="1" max="24" step="1" value="${Number((state.inventorySchedule || {}).intervalMonths || settings.inventoryIntervalMonths || 3)}"></div>
          <div class="form-full"><label>Standard-Stärken</label><textarea id="standardStrengths" placeholder="eine Stärke pro Zeile">${escapeHtml((settings.standardStrengths || []).join('\n'))}</textarea></div>
          <div class="form-full checkline"><input id="autoBackupOnStart" type="checkbox" ${settings.autoBackupOnStart !== false ? 'checked' : ''}><label for="autoBackupOnStart">Automatische Sicherung vorbereitet lassen</label></div>
          <div class="modal-footer form-full"><button class="primary" type="submit">Einstellungen speichern</button></div>
        </form>
      </div>
      <div class="card"><h2>Systemstatus</h2>${renderSystemStatus(status)}</div>
    </div>
    <div class="card"><h2>Server-Verbindung</h2><p class="muted">Für den Probeserver: Server-PC startet mit <strong>1_SERVER_AUF_DIESEM_PC_STARTEN.bat</strong>. Client-PCs starten mit <strong>2_CLIENT_APP_STARTEN.bat</strong> und tragen die Server-IP ein.</p><div class="notice"><strong>Aktuelle Verbindung:</strong><br>${escapeHtml(window.location.origin)}<br><br><strong>Netzwerk-Adressen vom Server:</strong><br>${((status.networkUrls || []).map(escapeHtml).join('<br>')) || '-'}</div></div>
    <div class="card"><h2>Rollen & Rechte</h2>${renderRoleRights()}</div>
  `;
  $('#adminSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ standardStrengths: $('#standardStrengths').value, autoBackupOnStart: $('#autoBackupOnStart').checked, inventoryLastDate: $('#inventoryLastDate').value, inventoryIntervalMonths: Number($('#inventoryIntervalMonths').value || 3) }) });
      showToast('Einstellungen gespeichert', 'System-Einstellungen wurden aktualisiert.');
      await loadState(true);
    } catch (error) { showToast('Fehler', error.message); }
  });
}

function renderRoleRights() {
  const rows = [
    ['Laser', 'Material sehen, Entnahme buchen, Inventur zählen, Bestellung angeben'],
    ['Büro', 'Material pflegen, Bestand buchen, Bestellungen bearbeiten, Inventur prüfen/abschließen'],
    ['Chef', 'Gesamtübersicht, Material archivieren, Bestellungen und Inventur abschließen'],
    ['Verwaltung', 'Benutzer, Einstellungen, Backup, Import/Export, Archiv, Materialpflege ohne Bestellungen/Inventuren']
  ];
  return `<table><thead><tr><th>Rolle</th><th>Darf</th></tr></thead><tbody>${rows.map(r => `<tr><td><strong>${r[0]}</strong></td><td>${escapeHtml(r[1])}</td></tr>`).join('')}</tbody></table>`;
}

function renderSystemBackup() {
  const backups = state.backups || [];
  $('#adminBackup').innerHTML = `
    ${renderSystemSubnav('adminBackup')}
    <div class="toolbar"><button class="primary" onclick="createBackupNow()">Backup erstellen</button><button class="secondary" onclick="loadState()">Aktualisieren</button></div>
    <div class="card"><h2>Datensicherungen</h2><p class="muted">Vor Wiederherstellung wird automatisch nochmal eine Sicherung erstellt.</p>${renderBackupTable(backups)}</div>
  `;
}

function renderBackupTable(backups) {
  if (!backups.length) return '<div class="empty">Noch kein Backup vorhanden.</div>';
  return `<table><thead><tr><th>Backup</th><th>Datum</th><th>Größe</th><th>Aktion</th></tr></thead><tbody>${backups.map(b => `<tr><td><code>${escapeHtml(b.file)}</code></td><td>${fmtDate(b.createdAt)}</td><td>${Math.round((Number(b.size)||0)/1024)} KB</td><td><div class="row-actions"><button class="ghost mini" onclick="downloadBackup('${jsString(b.file)}')">Download</button><button class="secondary danger mini" onclick="restoreBackup('${jsString(b.file)}')">Wiederherstellen</button></div></td></tr>`).join('')}</tbody></table>`;
}

function renderSystemImportExport() {
  $('#adminImportExport').innerHTML = `
    ${renderSystemSubnav('adminImportExport')}
    <div class="split">
      <div class="card"><h2>Materialliste exportieren</h2><p class="muted">Exportiert alle aktiven und archivierten Materialien als CSV.</p><button class="primary" onclick="exportMaterialsCsv()">CSV exportieren</button></div>
      <div class="card"><h2>CSV / Google Sheets importieren</h2><p class="muted">Büro-Format: Regal; Material; t=; Format; Menge; Abmass X; Abmass Y. Wird automatisch in die Material-Anordnung übernommen. Google-Sheets-Kopien mit Tabulatoren werden erkannt.</p><textarea id="importCsv" placeholder="CSV oder aus Google Sheets kopierte Tabelle hier einfügen"></textarea><div class="modal-footer"><button class="primary" onclick="importMaterialsCsv()">Materialien importieren</button></div></div>
    </div>
    <div class="card"><h2>CSV Vorlage</h2><pre class="code-block">Material;Stärke;Größe;Regal;Tafeln;Pakete;Mindestbestand;Bereich;Resttafel;Paketnummern
Aluminium;2;3000x1500;Regal 1;12;0;5;HAUPTLAGER;nein;
Konsi Alu;2;3000x1500;Regal 6;0;2;1;KONSI;nein;KONSI-001,KONSI-002</pre></div>
  `;
}

function renderSystemArchive() {
  const archived = state.archivedMaterials || [];
  $('#adminArchive').innerHTML = `
    ${renderSystemSubnav('adminArchive')}
    <div class="toolbar"><button class="secondary" onclick="loadState()">Aktualisieren</button><span class="badge gray">Archivierte Materialien: ${archived.length}</span></div>
    <div class="card"><h2>Material-Archiv</h2>${archived.length ? renderArchiveTable(archived) : '<div class="empty">Keine archivierten Materialien vorhanden.</div>'}</div>
  `;
}

function renderArchiveTable(items) {
  return `<table><thead><tr><th>Material</th><th>Menge</th><th>Regal</th><th>Aktualisiert</th><th>Aktion</th></tr></thead><tbody>${items.map(m => `<tr><td><strong>${escapeHtml(materialTitle(m))}</strong><br><small>${escapeHtml(m.format || '')}</small></td><td>${quantityLabel(m)}</td><td>${escapeHtml(m.shelf || '-')}</td><td>${fmtDate(m.updatedAt)}</td><td><button class="secondary mini" onclick="restoreMaterial('${jsString(m.id)}')">Wiederherstellen</button></td></tr>`).join('')}</tbody></table>`;
}

function renderSystemLog() {
  $('#adminLog').innerHTML = `${renderSystemSubnav('adminLog')}<div class="toolbar"><button class="secondary" onclick="loadState()">Aktualisieren</button><span class="badge gray">Letzte ${state.activities.length} Einträge</span></div><div class="card"><h2>Systemprotokoll</h2>${renderActivityList(state.activities)}</div>`;
}



window.openUserModal = (userId = '') => {
  if (!state.permissions.canManageUsers) return showToast('Keine Berechtigung', 'Nur der Systemzugang darf Benutzer verwalten.');
  const u = userId ? (state.users || []).find(x => x.id === userId) : null;
  const isEdit = Boolean(u);
  const data = u || { username: '', name: '', role: 'LASER', active: true };
  openModal(`
    <h2>${isEdit ? 'Benutzer bearbeiten' : 'Benutzer anlegen'}</h2>
    <p class="muted">Hier wird festgelegt, mit welchem Benutzername, Passwort und welcher Rolle sich jemand anmelden darf.</p>
    <form id="userForm" class="form-grid">
      <div><label>Benutzername</label><input id="userUsername" value="${escapeHtml(data.username)}" required placeholder="z. B. laser2"></div>
      <div><label>Profilname</label><input id="userName" value="${escapeHtml(data.name)}" required placeholder="z. B. Laser Halle 2"></div>
      <div><label>Rolle</label><select id="userRole">${roleOptions(data.role)}</select></div>
      <div><label>${isEdit ? 'Neues Passwort' : 'Start-Passwort'}</label><input id="userPassword" type="text" ${isEdit ? '' : 'required'} placeholder="${isEdit ? 'leer lassen = unverändert' : 'z. B. start123'}"></div>
      <div class="form-full checkline"><input id="userActive" type="checkbox" ${data.active !== false ? 'checked' : ''}><label for="userActive">Benutzer ist aktiv</label></div>
      <div class="form-full checkline"><input id="userMustChange" type="checkbox" ${data.mustChangePassword ? 'checked' : ''}><label for="userMustChange">Passwort beim nächsten Login ändern lassen</label></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">${isEdit ? 'Speichern' : 'Anlegen'}</button></div>
    </form>
  `);
  $('#userForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      username: $('#userUsername').value,
      name: $('#userName').value,
      role: $('#userRole').value,
      password: $('#userPassword').value,
      active: $('#userActive').checked,
      mustChangePassword: $('#userMustChange').checked
    };
    try {
      await api(isEdit ? `/api/users/${userId}` : '/api/users', { method: isEdit ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      closeModal();
      showToast(isEdit ? 'Benutzer gespeichert' : 'Benutzer angelegt', payload.name);
      await loadState(true);
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.deactivateUser = async (userId) => {
  const u = (state.users || []).find(x => x.id === userId);
  if (!u) return;
  if (!confirm(`Benutzer deaktivieren?\n\n${u.name} (${u.username})`)) return;
  try {
    await api(`/api/users/${userId}`, { method: 'DELETE' });
    showToast('Benutzer deaktiviert', u.name);
    await loadState(true);
  } catch (error) { showToast('Fehler', error.message); }
};

window.reactivateUser = async (userId) => {
  const u = (state.users || []).find(x => x.id === userId);
  if (!u) return;
  try {
    await api(`/api/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ ...u, active: true, password: '' }) });
    showToast('Benutzer aktiviert', u.name);
    await loadState(true);
  } catch (error) { showToast('Fehler', error.message); }
};

window.goPage = (page) => { currentPage = page; renderCurrentPage(); };

async function saveMaterialRequest(path, method, payload, isEdit = false) {
  try {
    return await api(path, { method, body: JSON.stringify(payload) });
  } catch (error) {
    if (error.code === 'DUPLICATE' && error.duplicate) {
      const duplicateText = `${error.duplicate.title} · ${error.duplicate.quantity} · ${error.duplicate.shelf}`;
      if (!isEdit && confirm(`Dieses Material gibt es schon:

${duplicateText}

Menge zur bestehenden Position hinzufügen?`)) {
        return await api(path, { method, body: JSON.stringify({ ...payload, mergeDuplicate: true }) });
      }
      if (confirm(`Trotzdem als eigene Position speichern?

${duplicateText}`)) {
        return await api(path, { method, body: JSON.stringify({ ...payload, forceDuplicate: true }) });
      }
      throw new Error('Speichern abgebrochen.');
    }
    throw error;
  }
}

window.openMaterialHistoryModal = async (materialId) => {
  const material = (state.materials || []).find(m => m.id === materialId) || {};
  try {
    const data = await api(`/api/materials/${materialId}/history`);
    const entries = data.entries || [];
    const latestUndo = data.latestUndo;
    const canStockCorrect = state.permissions.canAdjustStock && !isKonsi(data.material || material);
    openModal(`
      <h2>Material-Historie</h2>
      <p><strong>${escapeHtml(materialTitle(data.material || material))}</strong><br><span class="muted">${quantityLabel(data.material || material)} · ${escapeHtml(materialLocationLabel(data.material || material))}</span></p>
      <div class="toolbar">
        ${canStockCorrect ? `<button class="primary" onclick="closeModal(); openStockModal('${jsString(materialId)}','SET')">Korrektur buchen</button>` : ''}
        ${latestUndo ? `<button class="secondary danger" onclick="undoMaterialChange('${jsString(materialId)}')">Letzte Buchung rückgängig</button>` : '<span class="badge gray">Keine Rückgängig-Buchung</span>'}
      </div>
      <div class="history-list">
        ${entries.length ? `<table><thead><tr><th>Zeit</th><th>Typ</th><th>Meldung</th><th>Benutzer</th></tr></thead><tbody>${entries.map(a => `<tr><td>${fmtDate(a.at)}</td><td><span class="badge gray">${escapeHtml(a.type)}</span>${a.canUndo ? '<br><span class="badge amber">rückgängig möglich</span>' : ''}</td><td>${escapeHtml(a.text)}</td><td>${escapeHtml(a.user || '-')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Noch keine Historie für dieses Material vorhanden.</div>'}
      </div>
      <div class="footer-note">Korrekturen werden nicht gelöscht, sondern als Korrektur im Verlauf gespeichert.</div>
    `);
  } catch (error) { showToast('Fehler', error.message); }
};

window.undoMaterialChange = async (materialId) => {
  const reason = prompt('Grund für Rückgängig / Korrektur:', 'Falsch gebucht');
  if (reason === null) return;
  if (!confirm('Letzte rückgängig machbare Buchung wirklich zurücksetzen?')) return;
  try {
    await api(`/api/materials/${materialId}/undo`, { method: 'POST', body: JSON.stringify({ note: reason }) });
    closeModal();
    showToast('Buchung rückgängig gemacht', 'Die Korrektur wurde in der Historie gespeichert.');
    await loadState(true);
  } catch (error) { showToast('Fehler', error.message); }
};


window.openSystemMaterialEditModal = (materialId) => {
  if (!currentUser || currentUser.role !== 'ADMIN') return showToast('Keine Berechtigung', 'Nur der Systemzugang darf Materialdaten korrigieren.');
  const data = (state.materials || []).find(m => m.id === materialId && !m.archived);
  if (!data) return showToast('Nicht gefunden', 'Material wurde nicht gefunden.');
  const stockText = `${quantityLabel(data)} · ${escapeHtml(materialLocationLabel(data))}`;
  openModal(`
    <div class="modal-titlebar material-input-titlebar">
      <div>
        <span class="modal-kicker">Korrektur</span>
        <h2>Materialdaten korrigieren</h2>
        <p>Bestand bleibt unverändert. Nur Stammdaten werden korrigiert.</p>
      </div>
      <span class="modal-version-pill">v1.3</span>
    </div>
    <div class="modal-subtitle-card"><strong>${escapeHtml(materialTitle(data))}</strong><br>${stockText}<br><span>Stärke, Sonderformat und Schreibweise werden automatisch vereinheitlicht, z. B. <b>AlMg3</b>, <b>2,50 mm</b> und <b>1000x1000</b>.</span></div>
    <form id="adminMaterialEditForm" class="form-grid material-input-form">
      <div class="form-panel form-full"><label>Material</label><input id="adminEditMatName" value="${escapeHtml(data.name || '')}" required placeholder="z. B. Aluminium"></div>
      <div class="form-panel"><label>Stärke</label><input id="adminEditMatThickness" value="${escapeHtml(data.thickness || '')}" placeholder="z. B. 2 oder 2,5" inputmode="decimal"><div id="adminEditMatThicknessPreview" class="thickness-preview"></div></div>
      <div class="form-panel"><label>Format</label><select id="adminEditMatFormat">${formatOptions(data.format, true)}</select><div class="format-hint">Standardformat oder Sonderformat auswählen.</div></div>
      <div id="adminEditMatCustomFormatRow" class="form-panel ${isStandardFormatValue(data.format) || !data.format ? 'hidden' : ''}"><label>Sonderformat</label><input id="adminEditMatCustomFormat" value="${isStandardFormatValue(data.format) ? '' : escapeHtml(formatDisplayValue(data.format || ''))}" placeholder="z. B. 1000 x 1000" inputmode="numeric"><div id="adminEditMatCustomFormatPreview" class="thickness-preview"></div></div>
      <div class="form-panel"><label>Teilenr.</label><input id="adminEditMatArticleNumber" value="${escapeHtml(data.articleNumber || '')}" placeholder="z. B. T-12345"></div>
      <div class="form-panel"><label>Lagerbereich</label><select id="adminEditMatStorage"><option value="HAUPTLAGER" ${data.storage !== 'KONSI' ? 'selected' : ''}>Hauptlager</option><option value="KONSI" ${data.storage === 'KONSI' ? 'selected' : ''}>Konsi-Lager</option></select></div>
      <div id="adminEditMatShelfRow" class="form-panel"><label>Regal / Lagerplatz</label><select id="adminEditMatShelf">${shelfOptions(data.shelf)}</select></div>
      <div id="adminEditMatKonsiInfo" class="notice hidden"><strong>Konsi-Lager:</strong> Standort Garage. Paketnummern und Paketmenge bleiben unverändert.</div>
      <div class="form-full checkline"><input id="adminEditMatRest" type="checkbox" ${data.rest ? 'checked' : ''}><label for="adminEditMatRest">Ist Resttafel / Restmaterial</label></div>
      <div class="form-panel form-full"><label>Grund / Hinweis zur Korrektur</label><textarea id="adminEditCorrectionNote" placeholder="z. B. Format war falsch angelegt"></textarea></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Korrektur speichern</button></div>
    </form>
  `);
  const updateSystemEditStorage = () => {
    const isKonsiForm = $('#adminEditMatStorage').value === 'KONSI';
    $('#adminEditMatShelfRow').classList.toggle('hidden', isKonsiForm);
    $('#adminEditMatKonsiInfo').classList.toggle('hidden', !isKonsiForm);
  };
  $('#adminEditMatStorage').addEventListener('change', updateSystemEditStorage);
  attachAutoCase('#adminEditMatName', normalizeMaterialCaseInput);
  attachAutoCase('#adminEditMatArticleNumber', normalizeArticleNumberInput);
  attachThicknessAutoFormat('#adminEditMatThickness', '#adminEditMatThicknessPreview');
  attachFormatControls('#adminEditMatFormat', '#adminEditMatCustomFormatRow', '#adminEditMatCustomFormat', '#adminEditMatCustomFormatPreview');
  updateSystemEditStorage();
  $('#adminMaterialEditForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const isKonsiForm = $('#adminEditMatStorage').value === 'KONSI';
    const existingPackageNumbers = Array.isArray(data.packageNumbers) ? [...data.packageNumbers] : [];
    const existingPackageStock = Number(data.packageStock) || 0;
    const existingSheetStock = Number(data.sheetStock ?? data.stock) || 0;
    const nextPackageStock = isKonsiForm ? 0 : existingPackageStock;
    const nextSheetStock = isKonsiForm ? 0 : existingSheetStock;
    const nextStock = isKonsiForm ? (existingPackageNumbers.length || Number(data.stock) || 0) : (nextPackageStock + nextSheetStock);
    const payload = {
      name: normalizeMaterialCaseInput($('#adminEditMatName').value),
      category: isKonsiForm ? 'Konsi-Lager' : (data.category || ''),
      type: $('#adminEditMatRest').checked ? 'Resttafel' : (data.type || 'Tafel'),
      thickness: normalizeThicknessInput($('#adminEditMatThickness').value),
      format: readFormatControls('#adminEditMatFormat', '#adminEditMatCustomFormat'),
      unit: isKonsiForm ? 'Pakete' : (data.unit || 'Tafeln'),
      stock: nextStock,
      packageStock: nextPackageStock,
      sheetStock: nextSheetStock,
      packageNumbers: isKonsiForm ? existingPackageNumbers : [],
      minStock: isKonsiForm || $('#adminEditMatRest').checked ? 0 : DEFAULT_MATERIAL_MIN_STOCK,
      storage: $('#adminEditMatStorage').value,
      shelf: isKonsiForm ? konsiLocation() : $('#adminEditMatShelf').value,
      compartment: data.compartment || '',
      supplier: data.supplier || '',
      articleNumber: normalizeArticleNumberInput($('#adminEditMatArticleNumber').value),
      rest: $('#adminEditMatRest').checked,
      note: data.note || '',
      correctionNote: $('#adminEditCorrectionNote').value
    };
    try {
      await saveMaterialRequest(`/api/materials/${materialId}`, 'PATCH', payload, true);
      closeModal();
      showToast('Materialdaten korrigiert', materialTitle({ ...data, ...payload }));
      await loadState(true);
      if (currentPage === 'adminMaterials') renderCurrentPage();
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.openMaterialModal = (materialId = '', presetStorage = '') => {
  const m = materialId ? state.materials.find(x => x.id === materialId) : null;
  const isEdit = Boolean(m);
  if (isEdit && !state.permissions.canEditMaterial) return showToast('Keine Berechtigung', 'Materialdaten dürfen nur über den Systemzugang bearbeitet werden.');
  if (!isEdit && !state.permissions.canCreateMaterial) return showToast('Keine Berechtigung', 'Material darf nur von Büro oder Chef angelegt werden.');
  const data = m || { name:'', category:'', type:'Tafel', thickness:'', format:'', unit: presetStorage === 'KONSI' ? 'Pakete' : 'Tafeln', stock:0, sheetStock:0, packageNumbers:[], minStock:DEFAULT_MATERIAL_MIN_STOCK, storage: presetStorage || 'HAUPTLAGER', shelf: presetStorage === 'KONSI' ? konsiLocation() : 'Regal 1', compartment:'', supplier:'', articleNumber:'', rest:false, note:'' };
  if (!data.storage) data.storage = 'HAUPTLAGER';
  if (!data.shelf) data.shelf = data.storage === 'KONSI' ? konsiLocation() : 'Regal 1';
  const mainStockValue = data.storage === 'KONSI' ? (Number(data.stock) || 0) : (Number(data.sheetStock ?? data.stock) || 0);
  openModal(`
    <div class="modal-titlebar material-input-titlebar">
      <div>
        <span class="modal-kicker">Material-Eingabe</span>
        <h2>${isEdit ? 'Material bearbeiten' : 'Material anlegen'}</h2>
        <p>${isEdit ? 'Daten sauber korrigieren, Bestand bleibt kontrolliert.' : 'Neues Material geordnet anlegen.'}</p>
      </div>
      <span class="modal-version-pill">v1.3</span>
    </div>
    <div class="modal-subtitle-card"><strong>Hinweis:</strong> Stärke, Sonderformat und Schreibweise werden automatisch einheitlich gespeichert, z. B. <b>AlMg3</b>, <b>2,50 mm</b> und <b>1000x1000</b>.</div>
    <form id="materialForm" class="form-grid material-input-form">
      <div class="form-panel form-full"><label>Material</label><input id="matName" value="${escapeHtml(data.name)}" required placeholder="z. B. Aluminium"></div>
      <div class="form-panel"><label>Stärke</label><input id="matThickness" value="${escapeHtml(data.thickness)}" placeholder="z. B. 2 oder 2,5" inputmode="decimal"><div id="matThicknessPreview" class="thickness-preview"></div></div>
      <div class="form-panel"><label>Format</label><select id="matFormat">${formatOptions(data.format, true)}</select><div class="format-hint">Standardformat oder Sonderformat auswählen.</div></div>
      <div id="matCustomFormatRow" class="form-panel ${isStandardFormatValue(data.format) || !data.format ? 'hidden' : ''}"><label>Sonderformat</label><input id="matCustomFormat" value="${isStandardFormatValue(data.format) ? '' : escapeHtml(formatDisplayValue(data.format || ''))}" placeholder="z. B. 1000 x 1000" inputmode="numeric"><div id="matCustomFormatPreview" class="thickness-preview"></div></div>
      <div class="form-panel"><label>Teilenr.</label><input id="matArticleNumber" value="${escapeHtml(data.articleNumber || '')}" placeholder="z. B. T-12345"></div>
      <div class="form-panel"><label>Lagerbereich</label><select id="matStorage"><option value="HAUPTLAGER" ${data.storage !== 'KONSI' ? 'selected' : ''}>Hauptlager</option><option value="KONSI" ${data.storage === 'KONSI' ? 'selected' : ''}>Konsi-Lager</option></select></div>
      <div class="form-panel"><label id="matStockLabel">Menge</label><input id="matStock" type="number" min="0" step="1" value="${mainStockValue}"></div>
      <div id="matPackageNumbersRow" class="form-panel form-full"><label>Konsi-Paketnummern</label><textarea id="matPackageNumbers" placeholder="Eine Nummer pro Zeile oder mit Komma getrennt ...">${escapeHtml((data.packageNumbers || []).join('\n'))}</textarea><div class="format-hint">Diese Nummern werden bei der Paket-Entnahme als Auswahl angezeigt. Wenn Nummern eingetragen sind, wird die Paketmenge automatisch daraus berechnet.</div></div>
      <div class="form-panel"><label>Mindestbestand</label><input id="matMinStock" type="number" min="0" step="1" value="${materialMinStock(data)}" readonly><div class="format-hint">Fester Wert: 2 Tafeln. Pakete, Konsi und Resttafeln sind ausgenommen.</div></div>
      <div id="matShelfRow" class="form-panel"><label>Regal / Lagerplatz</label><select id="matShelf">${shelfOptions(data.shelf)}</select></div><div id="matKonsiLocationRow" class="notice hidden"><strong>Konsi-Lager:</strong> Standort Garage. Es gibt dort keine Regale.</div>
      <div class="form-full checkline"><input id="matRest" type="checkbox" ${data.rest ? 'checked' : ''}><label for="matRest">Ist Resttafel / Restmaterial</label></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">${isEdit ? 'Speichern' : 'Anlegen'}</button></div>
    </form>
  `);
  const updateMaterialFormLabels = () => {
    const konsi = $('#matStorage').value === 'KONSI';
    $('#matStockLabel').textContent = konsi ? 'Pakete' : 'Menge / Tafeln';
    $('#matPackageNumbersRow').classList.toggle('hidden', !konsi);
    $('#matShelfRow').classList.toggle('hidden', konsi);
    $('#matKonsiLocationRow').classList.toggle('hidden', !konsi);
  };
  $('#matStorage').addEventListener('change', updateMaterialFormLabels);
  attachAutoCase('#matName', normalizeMaterialCaseInput);
  attachAutoCase('#matArticleNumber', normalizeArticleNumberInput);
  attachThicknessAutoFormat('#matThickness', '#matThicknessPreview');
  attachFormatControls('#matFormat', '#matCustomFormatRow', '#matCustomFormat', '#matCustomFormatPreview');
  const syncPackageCount = () => {
    if ($('#matStorage').value !== 'KONSI') return;
    const numbers = parsePackageNumbers($('#matPackageNumbers').value);
    if (numbers.length) $('#matStock').value = numbers.length;
  };
  $('#matPackageNumbers').addEventListener('input', syncPackageCount);
  updateMaterialFormLabels();
  $('#matRest').addEventListener('change', () => {
    $('#matMinStock').value = $('#matRest').checked ? 0 : DEFAULT_MATERIAL_MIN_STOCK;
  });
  $('#materialForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const isKonsiForm = $('#matStorage').value === 'KONSI';
    const payload = {
      name: normalizeMaterialCaseInput($('#matName').value),
      category: isKonsiForm ? 'Konsi-Lager' : '',
      type: $('#matRest').checked ? 'Resttafel' : 'Tafel',
      thickness: normalizeThicknessInput($('#matThickness').value),
      format: readFormatControls('#matFormat', '#matCustomFormat'),
      unit: isKonsiForm ? 'Pakete' : 'Tafeln',
      stock: isKonsiForm && parsePackageNumbers($('#matPackageNumbers').value).length ? parsePackageNumbers($('#matPackageNumbers').value).length : ((Number(data.packageStock) || 0) + Number($('#matStock').value)),
      packageStock: isKonsiForm ? 0 : (Number(data.packageStock) || 0),
      sheetStock: isKonsiForm ? 0 : Number($('#matStock').value),
      packageNumbers: isKonsiForm ? parsePackageNumbers($('#matPackageNumbers').value) : [],
      minStock: isKonsiForm || $('#matRest').checked ? 0 : DEFAULT_MATERIAL_MIN_STOCK,
      storage: $('#matStorage').value,
      shelf: isKonsiForm ? konsiLocation() : $('#matShelf').value,
      compartment: '',
      supplier: '',
      articleNumber: normalizeArticleNumberInput($('#matArticleNumber').value),
      rest: $('#matRest').checked,
      note: ''
    };
    try {
      await saveMaterialRequest(isEdit ? `/api/materials/${materialId}` : '/api/materials', isEdit ? 'PATCH' : 'POST', payload, isEdit);
      closeModal();
      showToast(isEdit ? 'Material gespeichert' : 'Material angelegt', payload.name);
      await loadState(true);
    } catch (error) { showToast('Fehler', error.message); }
  });
};

function normalizeImportHeaderKeyClient(value) {
  const key = String(value || '')
    .trim()
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
    paketnummern: 'paketnummern', paketnummer: 'paketnummern', paketnr: 'paketnummern', paketnummmer: 'paketnummern', nummern: 'paketnummern'
  };
  return map[key] || key;
}

function detectTableDelimiterClient(text) {
  const line = String(text || '').split(/\r?\n/).find(row => row.trim()) || '';
  const tabs = (line.match(/\t/g) || []).length;
  const semis = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  if (tabs >= semis && tabs >= commas && tabs > 0) return '\t';
  if (semis >= commas && semis > 0) return ';';
  if (commas > 0) return ',';
  return '\t';
}

function parsePastedTableRowsClient(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const delimiter = detectTableDelimiterClient(raw);
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
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
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

function parseNumberClient(value, fallback = 0) {
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

function isTruthyImportValueClient(value) {
  return ['ja', 'j', 'true', '1', 'x', 'yes'].includes(String(value || '').trim().toLowerCase());
}


function cleanDimensionPartClient(value) {
  const raw = String(value || '').trim();
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

function isShelfLikeImportValueClient(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^regal\s*\d+$/i.test(text) || ['carport','bodenhaltung','garage'].includes(text);
}

function looksLikeBueroImportRowClient(row) {
  if (!Array.isArray(row) || row.length < 7) return false;
  return isShelfLikeImportValueClient(row[0]) || (!!cleanDimensionPartClient(row[5]) && !!cleanDimensionPartClient(row[6]));
}

function normalizeFormatFromImportedValuesClient(formatValue, xValue, yValue) {
  const x = cleanDimensionPartClient(xValue);
  const y = cleanDimensionPartClient(yValue);
  if (x && y) return `${x}x${y}`;
  const formatRaw = String(formatValue || '').trim();
  const dimension = formatRaw.match(/(\d{3,5})\s*[x×*]\s*(\d{3,5})/i);
  if (dimension) return `${dimension[1]}x${dimension[2]}`;
  const known = ['4000x2000','3000x1500','2500x1250','2000x1000'];
  const normalized = formatRaw.toLowerCase().replace(/\s+/g, '').replace('×', 'x').replace('*', 'x');
  if (known.includes(normalized)) return normalized;
  return '3000x1500';
}

function previewMaterialsFromTableText(text, mode = '') {
  const rows = parsePastedTableRowsClient(text);
  if (!rows.length) return [];
  const canonical = ['material','materialid','staerke','groesse','regal','tafeln','pakete','mindestbestand','bereich','resttafel','paketnummern','abmassx','abmassy'];
  const headerKeys = rows[0].map(normalizeImportHeaderKeyClient);
  const hasHeader = headerKeys.some(key => canonical.includes(key));
  const headerMap = hasHeader ? headerKeys.reduce((acc, key, index) => { acc[key] = index; return acc; }, {}) : null;
  const bueroFallbackMap = { regal: 0, material: 1, staerke: 2, groesse: 3, tafeln: 4, abmassx: 5, abmassy: 6 };
  const konsiFallbackMap = { materialid: 0, paketnummern: 0, paketnummer: 0, nummern: 0, material: 1, groesse: 2, staerke: 3 };
  const defaultFallbackMap = { material: 0, staerke: 1, groesse: 2, regal: 3, tafeln: 4, pakete: 5, mindestbestand: 6, bereich: 7, resttafel: 8, paketnummern: 9, materialid: 9 };
  const forceKonsiSimple = String(mode || '').toUpperCase() === 'KONSI';
  const useBueroFallback = !forceKonsiSimple && !hasHeader && rows.some(looksLikeBueroImportRowClient);
  const get = (row, key, fallbackIndex = -1) => {
    const normalized = normalizeImportHeaderKeyClient(key);
    if (headerMap) return headerMap[normalized] !== undefined ? (row[headerMap[normalized]] || '') : '';
    const mappedIndex = forceKonsiSimple ? konsiFallbackMap[normalized] : (useBueroFallback ? bueroFallbackMap[normalized] : defaultFallbackMap[normalized]);
    // Büro-Format hat nur: Regal, Material, t=, Format, Menge, Abmass X, Abmass Y.
    // Konsi-Tabellen haben nur: Material ID, Material, Format, Stärke.
    // Nicht gemappte Werte dürfen hier nicht auf andere Spalten zurückfallen,
    // sonst entstehen z. B. aus 4000/2000 versehentlich Pakete.
    if ((useBueroFallback || forceKonsiSimple) && mappedIndex === undefined) return '';
    const index = mappedIndex !== undefined ? mappedIndex : fallbackIndex;
    return index >= 0 ? (row[index] || '') : '';
  };
  return (hasHeader ? rows.slice(1) : rows).map((row, index) => {
    if (forceKonsiSimple) {
      const materialId = String(get(row, 'materialid', 0) || '').trim();
      const name = get(row, 'material', 1).trim();
      const material = {
        row: index + 1,
        materialId,
        name,
        thickness: normalizeThicknessInput(get(row, 'staerke', 3)),
        format: normalizeFormatFromImportedValuesClient(get(row, 'groesse', 2), '', ''),
        shelf: konsiLocation(),
        sheets: 0,
        packages: materialId ? 1 : 0,
        minStock: 0,
        storage: 'KONSI',
        rest: false,
        packageNumbers: materialId ? [materialId] : []
      };
      material.error = !materialId ? 'Material ID fehlt' : (!name ? 'Material fehlt' : '');
      return material;
    }
    const name = get(row, 'material', 0).trim();
    const storageText = String(get(row, 'bereich', 7) || '').toUpperCase();
    const storage = storageText.includes('KONSI') ? 'KONSI' : 'HAUPTLAGER';
    const packageNumbers = parsePackageNumbers(get(row, 'paketnummern', 9));
    const packages = storage === 'KONSI' ? Math.max(0, parseNumberClient(get(row, 'pakete', 5), packageNumbers.length)) : 0;
    // Für normales Material zählt ausschließlich die Spalte „Menge“ als Tafeln.
    // Format/Abmass-Zahlen werden nur für die Größe benutzt und nie als Pakete.
    const sheets = storage === 'KONSI' ? 0 : Math.max(0, parseNumberClient(get(row, 'tafeln', 4), 0));
    const material = {
      row: index + 1,
      name,
      thickness: normalizeThicknessInput(get(row, 'staerke', 1)),
      format: normalizeFormatFromImportedValuesClient(get(row, 'groesse', 2), get(row, 'abmassx', 5), get(row, 'abmassy', 6)),
      shelf: storage === 'KONSI' ? konsiLocation() : (get(row, 'regal', 3) || 'Regal 1'),
      sheets,
      packages: storage === 'KONSI' ? (packageNumbers.length || packages) : packages,
      minStock: storage === 'KONSI' || isTruthyImportValueClient(get(row, 'resttafel', 8)) ? 0 : DEFAULT_MATERIAL_MIN_STOCK,
      storage,
      rest: isTruthyImportValueClient(get(row, 'resttafel', 8)),
      packageNumbers
    };
    material.error = name ? '' : 'Material fehlt';
    return material;
  }).filter(item => item.name || item.thickness || item.sheets || item.packages || item.packageNumbers.length || item.materialId);
}

window.previewPasteTable = () => {
  const text = ($('#pasteTableText') && $('#pasteTableText').value) || '';
  const mode = window.__pasteTableMode || '';
  const preview = previewMaterialsFromTableText(text, mode);
  const box = $('#pasteTablePreview');
  if (!box) return;
  if (!text.trim()) {
    box.innerHTML = '<div class="empty">Noch keine Tabelle eingefügt.</div>';
    return;
  }
  if (!preview.length) {
    box.innerHTML = '<div class="empty">Keine gültigen Zeilen erkannt. Bitte Spalten aus Google Sheets kopieren und einfügen.</div>';
    return;
  }
  if (mode === 'KONSI') {
    box.innerHTML = `
      <div class="footer-note">Vorschau: ${preview.length} Konsi-Paket(e) erkannt. Gleiche Material IDs werden als mehrere Pakete übernommen.</div>
      <table>
        <thead><tr><th>Zeile</th><th>Material ID</th><th>Material</th><th>Format</th><th>Stärke</th><th>Standort</th><th>Status</th></tr></thead>
        <tbody>${preview.map(item => `<tr>
          <td>${item.row}</td>
          <td><strong>${escapeHtml(item.materialId || (item.packageNumbers && item.packageNumbers[0]) || '-')}</strong></td>
          <td>${escapeHtml(item.name || '-')}</td>
          <td>${escapeHtml(item.format || '-')}</td>
          <td>${escapeHtml(item.thickness || '-')}</td>
          <td>${escapeHtml(item.shelf || '-')}</td>
          <td>${item.error ? `<span class="badge red">${escapeHtml(item.error)}</span>` : '<span class="badge green">OK</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>
    `;
    return;
  }
  box.innerHTML = `
    <div class="footer-note">Vorschau: ${preview.length} Zeile(n) erkannt. Dubletten werden beim Übernehmen automatisch zusammengeführt.</div>
    <table>
      <thead><tr><th>Zeile</th><th>Material</th><th>Stärke</th><th>Größe</th><th>Bereich</th><th>Lagerplatz</th><th>Menge</th><th>Status</th></tr></thead>
      <tbody>${preview.map(item => `<tr>
        <td>${item.row}</td>
        <td><strong>${escapeHtml(item.name || '-')}</strong>${item.rest ? '<div><span class="badge gray">Resttafel</span></div>' : ''}</td>
        <td>${escapeHtml(item.thickness || '-')}</td>
        <td>${escapeHtml(item.format || '-')}</td>
        <td>${escapeHtml(item.storage === 'KONSI' ? 'Konsi-Lager' : 'Hauptlager')}</td>
        <td>${escapeHtml(item.shelf || '-')}</td>
        <td>${item.storage === 'KONSI' ? `${item.packages} Paket(e)` : `${item.sheets} Tafel(n)`}</td>
        <td>${item.error ? `<span class="badge red">${escapeHtml(item.error)}</span>` : '<span class="badge green">OK</span>'}</td>
      </tr>`).join('')}</tbody>
    </table>
  `;
};

window.openPasteTableModal = () => {
  if (!currentUser || currentUser.role !== 'ADMIN') return showToast('Keine Berechtigung', 'Tabellenimport ist nur für den Systemzugang freigegeben.');
  const konsiMode = currentPage === 'konsi';
  window.__pasteTableMode = konsiMode ? 'KONSI' : '';
  const title = konsiMode ? 'Konsi-Tabelle einfügen' : 'Materialien aus Tabelle einfügen';
  const help = konsiMode
    ? '<p class="muted">Für das Konsi-Lager diese Spalten aus Excel/Google Sheets kopieren: Material ID · Material · Format · Stärke.</p><div class="notice form-full"><strong>Konsi-Format:</strong> Material ID · Material · Format · Stärke<br><strong>Wichtig:</strong> Material ID ist die Paket-/Materialnummer. Wenn dieselbe Material ID mehrmals vorkommt, wird sie mehrfach als eigenes Paket übernommen.</div>'
    : '<p class="muted">In Google Sheets die Zeilen markieren, kopieren und hier einfügen. Büro-Tabellen wie Regal · Material · t= · Format · Menge · Abmass X · Abmass Y werden automatisch erkannt und in deine Material-Ordnung übernommen.</p><div class="notice form-full"><strong>Büro-Format möglich:</strong> Regal · Material · t= · Format · Menge · Abmass X · Abmass Y<br><strong>Wichtig:</strong> Nur die Spalte Menge wird als Tafeln übernommen. Abmass X/Y wird nur für die Größe benutzt, nie als Pakete.<br><strong>Speicherung im Programm:</strong> Material · Stärke · Größe · Lagerplatz · Tafeln</div>';
  const placeholder = konsiMode
    ? 'Material ID\tMaterial\tFormat\tStärke\nK-100\tS235\t3000x1500\t3 mm\nK-100\tS235\t3000x1500\t3 mm'
    : 'Regal\tMaterial\tt=\tFormat\tMenge\tAbmass X\tAbmass Y\nRegal 1\tAluminium\t2\tTafel\t12\t3000\t1500';
  openModal(`
    <h2>${title}</h2>
    ${help}
    <textarea id="pasteTableText" style="min-height:190px" placeholder="${placeholder}"></textarea>
    <div id="pasteTablePreview" class="paste-preview"><div class="empty">Noch keine Tabelle eingefügt.</div></div>
    <div class="toolbar modal-toolbar modal-toolbar-sticky">
      <button class="ghost" onclick="closeModal()">Abbrechen</button>
      <button class="secondary" onclick="previewPasteTable()">Vorschau prüfen</button>
      <button class="primary" onclick="importMaterialsFromTable()">${konsiMode ? 'Konsi-Pakete übernehmen' : 'Materialien übernehmen'}</button>
    </div>
    <div class="footer-note">${konsiMode ? 'Konsi bleibt Standort Garage. Der Import bleibt nur für den Systemzugang freigegeben.' : 'Konsi separat im Konsi-Lager über Material ID · Material · Format · Stärke einfügen.'}</div>
  `);
  $('#pasteTableText').addEventListener('input', () => {
    clearTimeout(window.__pastePreviewTimer);
    window.__pastePreviewTimer = setTimeout(() => window.previewPasteTable(), 250);
  });
};

window.importMaterialsFromTable = async () => {
  if (!currentUser || currentUser.role !== 'ADMIN') return showToast('Keine Berechtigung', 'Tabellenimport ist nur für den Systemzugang freigegeben.');
  const table = ($('#pasteTableText') && $('#pasteTableText').value) || '';
  if (!table.trim()) return showToast('Keine Eingabe', 'Bitte die Tabelle aus Google Sheets einfügen.');
  const mode = window.__pasteTableMode || '';
  const preview = previewMaterialsFromTableText(table, mode);
  const errors = preview.filter(item => item.error).length;
  if (!preview.length) return showToast('Keine gültigen Zeilen', 'Es wurden keine Materialzeilen erkannt.');
  if (errors) return showToast('Fehler in Vorschau', 'Bitte zuerst die markierten Zeilen korrigieren.');
  if (!confirm(mode === 'KONSI' ? `${preview.length} Konsi-Paket(e) übernehmen?\n\nGleiche Material IDs werden als mehrere Pakete übernommen.` : `${preview.length} Materialposition(en) aus der Tabelle übernehmen?\n\nDubletten werden zusammengeführt.`)) return;
  try {
    const data = await api('/api/materials/import-table', { method: 'POST', body: JSON.stringify({ table, mode }) });
    closeModal();
    showToast('Tabelle übernommen', mode === 'KONSI' ? `${data.created} Konsi-Position(en) angelegt, ${data.merged || 0} Position(en) erweitert.` : `${data.created} Materialposition(en) angelegt, ${data.merged || 0} Dublette(n) zusammengeführt.`);
    materialFilter.text = '';
    materialFilter.status = 'all';
    materialFilter.storage = 'all';
    materialFilter.shelf = 'all';
    materialFilter.format = 'all';
    materialFilter.sort = 'size-desc';
    await loadState(true);
    currentPage = mode === 'KONSI' ? 'konsi' : 'materials';
    renderCurrentPage();
  } catch (error) {
    showToast('Fehler', error.message);
  }
};


window.deleteNonOrderMaterial = async (materialId) => {
  if (!state.permissions.canDeleteNonOrderMaterial) return showToast('Keine Berechtigung', 'Laser und Systemzugang dürfen einzelne Materialien mit Bestand 0 löschen.');
  const m = state.materials.find(x => x.id === materialId);
  if (!m) return;
  const blockReason = materialDeleteBlockReasonClient(m);
  if (blockReason) return showToast('Nicht löschbar', blockReason);
  const title = materialTitle(m);
  openModal(`
    <div class="modal-titlebar delete-modal-titlebar">
      <div>
        <span class="modal-kicker">Material löschen</span>
        <h2>Eintrag entfernen</h2>
        <p>Nur möglich bei Bestand 0 und ohne offene Bestellung.</p>
      </div>
      <span class="modal-version-pill">v1.3</span>
    </div>
    <div class="modal-subtitle-card delete-warning-card">
      <strong>${escapeHtml(title)}</strong><br>
      <span>Dieser Eintrag wird aus der aktiven Materialliste entfernt. Die Historie bleibt nachvollziehbar und die Verwaltung sieht den Vorgang im Archiv.</span>
    </div>
    <div class="delete-summary-grid">
      <div class="delete-fact"><small>Bestand</small><strong>${escapeHtml(quantityLabel(m))}</strong></div>
      <div class="delete-fact"><small>Lagerplatz</small><strong>${escapeHtml(materialLocationLabel(m))}</strong></div>
      <div class="delete-fact"><small>Format</small><strong>${escapeHtml(formatDisplayValue(m.format || '-'))}</strong></div>
      <div class="delete-fact"><small>Stärke</small><strong>${escapeHtml(m.thickness || '-')}</strong></div>
    </div>
    <form id="deleteMaterialForm" class="delete-material-form form-grid">
      <div class="form-panel form-full">
        <label>Grund / Hinweis</label>
        <textarea id="deleteMaterialNote" placeholder="z. B. Bestand 0 / falsches Format / nicht mehr benötigt">Bestand 0 / nicht mehr benötigt</textarea>
        <div class="format-hint">Der Hinweis wird in der Historie gespeichert.</div>
      </div>
      <label class="delete-confirm-line form-full">
        <input id="deleteMaterialConfirm" type="checkbox" required>
        <span>Ich bestätige, dass dieser Materialeintrag mit Bestand 0 aus der aktiven Liste entfernt werden soll.</span>
      </label>
      <div class="modal-footer form-full">
        <button type="button" class="ghost" onclick="closeModal()">Abbrechen</button>
        <button class="danger" type="submit">Material löschen</button>
      </div>
    </form>
  `);
  $('#deleteMaterialForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!$('#deleteMaterialConfirm').checked) return showToast('Bestätigung fehlt', 'Bitte die Löschung bestätigen.');
    const note = $('#deleteMaterialNote').value;
    try {
      await api(`/api/materials/${materialId}/delete-non-order`, { method: 'POST', body: JSON.stringify({ note }) });
      closeModal();
      showToast('Material gelöscht', title);
      await loadState(true);
      if (currentPage === 'adminMaterials') renderCurrentPage();
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.archiveMaterial = async (materialId) => {
  const m = state.materials.find(x => x.id === materialId);
  if (!m) return;
  const ok = confirm(`Material wirklich archivieren?\n\n${m.name}\n\nEs wird ausgeblendet, bestehende Historie bleibt erhalten.`);
  if (!ok) return;
  try {
    await api(`/api/materials/${materialId}`, { method: 'DELETE' });
    showToast('Material archiviert', m.name);
    await loadState(true);
  } catch (error) { showToast('Fehler', error.message); }
};


window.openMoveMaterialModal = (materialId) => {
  const m = state.materials.find(x => x.id === materialId);
  if (!m) return;
  const available = Number(m.sheetStock ?? m.stock) || 0;
  const shelves = Array.from(new Set([...(state && state.shelfOptions && state.shelfOptions.length ? state.shelfOptions : defaultShelves), 'Carport', 'Bodenhaltung']));
  const overflowShelves = shelves.filter(shelf => ['Carport', 'Bodenhaltung'].includes(shelf));
  const regalShelves = shelves.filter(shelf => /^Regal\s[1-6]$/.test(shelf));
  const optionHtml = (items) => items
    .filter(shelf => shelf !== m.shelf)
    .map(shelf => `<option value="${escapeHtml(shelf)}">${escapeHtml(shelf)}</option>`)
    .join('');
  const targetOptions = `
    <optgroup label="Zwischenlager / bleibt im Verräumen">${optionHtml(overflowShelves)}</optgroup>
    <optgroup label="Endgültiges Regal">${optionHtml(regalShelves)}</optgroup>
  `;
  const packageInfo = m.deliveryPending && Number(m.deliveredPackageCount) > 0
    ? ` · Wareneingang: ${Number(m.deliveredPackageCount)} Pakete = ${available} Tafeln`
    : '';
  openModal(`
    <h2>Tafeln verräumen</h2>
    <p><strong>${escapeHtml(materialTitle(m))}</strong><br><span class="muted">Von ${escapeHtml(m.shelf || '-')} · verfügbar: ${available} Tafeln${packageInfo}</span></p>
    <form id="moveMaterialForm" class="form-grid">
      <div><label>Tafeln verschieben</label><input id="moveQty" type="number" min="1" max="${available}" step="1" value="${available}" required></div>
      <div><label>Ziel-Lagerplatz</label><select id="moveTargetShelf" required>${targetOptions}</select></div>
      <div class="form-full"><label>Notiz</label><textarea id="moveNote" placeholder="optional, z. B. erst in Bodenhaltung gelegt ..."></textarea></div>
      <div class="notice form-full"><strong>Hinweis:</strong> Wenn Carport oder Bodenhaltung gewählt wird, bleibt die Position im Bereich Verräumen sichtbar. Erst bei Regal 1–6 ist sie endgültig verräumt.</div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Verräumen</button></div>
    </form>
  `);
  $('#moveMaterialForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const qty = Number($('#moveQty').value);
      const targetShelf = $('#moveTargetShelf').value;
      const note = $('#moveNote').value;
      await api(`/api/materials/${materialId}/move`, {
        method: 'POST',
        body: JSON.stringify({ qty, targetShelf, note })
      });
      closeModal();
      const stillOpen = ['Carport', 'Bodenhaltung'].includes(targetShelf);
      showToast(stillOpen ? 'Zwischengelagert' : 'Tafeln verräumt', `${materialTitle(m)} → ${targetShelf}`);
      await loadState(true);
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.openStockModal = (materialId, action = 'REMOVE') => {
  const m = state.materials.find(x => x.id === materialId);
  if (!m) return;
  const laserOnly = currentUser.role === 'LASER';
  const konsi = isKonsi(m);

  if (konsi && action === 'REMOVE') {
    const numbers = Array.isArray(m.packageNumbers) ? m.packageNumbers : [];
    const counts = numbers.reduce((acc, n) => ((acc[n] = (acc[n] || 0) + 1), acc), {});
    const seen = {};
    const options = numbers.map(n => {
      seen[n] = (seen[n] || 0) + 1;
      const label = counts[n] > 1 ? `${n} (${seen[n]}/${counts[n]})` : n;
      return `<option value="${escapeHtml(n)}">${escapeHtml(label)}</option>`;
    }).join('');
    openModal(`
      <h2>Paket Entnahme</h2>
      <p><strong>${escapeHtml(m.name)}</strong><br><span class="muted">Aktuelle Menge: ${quantityLabel(m)} · Standort ${escapeHtml(materialLocationLabel(m))}</span></p>
      <form id="stockForm" class="form-grid">
        <input id="stockAction" type="hidden" value="REMOVE">
        <input id="stockQty" type="hidden" value="1">
        <div class="form-full"><label>Paketnummer</label><select id="packageNumber" required>${options || '<option value="">Keine Paketnummer hinterlegt</option>'}</select><div class="format-hint">Die Nummern werden beim Konsi-Material hinterlegt und hier nur ausgewählt.</div></div>
        <div><label>Ziel-Lagerplatz nach Entnahme</label><select id="targetShelf">${shelfOptions('Regal 1')}</select></div>
        <div class="form-full"><label>Notiz</label><textarea id="stockNote" placeholder="optional, z. B. Auftrag, Umlagerung ..."></textarea></div>
        <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Paket entnehmen</button></div>
      </form>
    `);
    $('#stockForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const packageNumber = $('#packageNumber').value;
      if (!packageNumber) return showToast('Paketnummer fehlt', 'Bitte beim Konsi-Material erst Paketnummern hinterlegen.');
      try {
        await api(`/api/materials/${materialId}/stock`, {
          method: 'POST',
          body: JSON.stringify({ action: 'REMOVE', qty: 1, sheets: 0, packageNumber, targetShelf: $('#targetShelf').value, note: $('#stockNote').value })
        });
        closeModal();
        showToast('Paket entnommen', `${m.name} · Nummer ${packageNumber}`);
        await loadState(true);
      } catch (error) { showToast('Fehler', error.message); }
    });
    return;
  }

  const correctionMode = action === 'SET';
  const actionOptions = laserOnly
    ? (correctionMode ? '<option value="SET" selected>Bestand korrigieren</option>' : '<option value="REMOVE">Entnahme</option>')
    : `<option value="REMOVE" ${action === 'REMOVE' ? 'selected' : ''}>Entnahme</option><option value="ADD" ${action === 'ADD' ? 'selected' : ''}>Zubuchen</option><option value="SET" ${action === 'SET' ? 'selected' : ''}>Bestand korrigieren</option>`;
  const value = action === 'SET' ? (Number(m.sheetStock ?? m.stock) || 0) : 1;
  openModal(`
    <h2>${action === 'SET' ? 'Korrektur buchen' : 'Bestand buchen'}</h2>
    <p><strong>${escapeHtml(m.name)}</strong><br><span class="muted">Aktuelle Menge: ${quantityLabel(m)} · Standort ${escapeHtml(materialLocationLabel(m))}</span></p>
    <form id="stockForm" class="form-grid">
      <div><label>Aktion</label><select id="stockAction">${actionOptions}</select></div>
      <div><label id="stockQtyLabel">${action === 'SET' ? 'Korrigierter Bestand' : 'Menge / Tafeln'}</label><input id="stockQty" type="number" min="0" step="1" value="${value}"></div>
      <div class="form-full"><label>Notiz</label><textarea id="stockNote" placeholder="optional, z. B. Auftrag ..."></textarea></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Buchen</button></div>
    </form>
  `);
  const updateStockForm = () => {
    const act = $('#stockAction').value;
    $('#stockQtyLabel').textContent = act === 'SET' ? 'Korrigierter Bestand' : 'Menge / Tafeln';
  };
  $('#stockAction').addEventListener('change', () => {
    if ($('#stockAction').value === 'SET') $('#stockQty').value = m.stock;
    else if (Number($('#stockQty').value) === Number(m.stock)) $('#stockQty').value = 1;
    updateStockForm();
  });
  updateStockForm();
  $('#stockForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/api/materials/${materialId}/stock`, {
        method: 'POST',
        body: JSON.stringify({ action: $('#stockAction').value, qty: Number($('#stockQty').value), sheets: 0, targetShelf: '', note: $('#stockNote').value })
      });
      closeModal();
      showToast('Bestand aktualisiert', m.name);
      await loadState(true);
    } catch (error) { showToast('Fehler', error.message); }
  });
};


window.openRemoveModal = (materialId) => window.openStockModal(materialId, 'REMOVE');

window.openDirectWriteOffModal = (materialId) => {
  if (!state.permissions.canDirectWriteOff) return showToast('Keine Berechtigung', 'Komplett ausbuchen ist nur für Büro, Chef und Admin sichtbar.');
  const m = state.materials.find(x => x.id === materialId);
  if (!m) return showToast('Material fehlt', 'Material wurde nicht gefunden.');
  openModal(`
    <h2>Material komplett ausbuchen</h2>
    <p><strong>${escapeHtml(materialTitle(m))}</strong><br><span class="muted">Aktuelle Menge: ${quantityLabel(m)} · ${escapeHtml(materialLocationLabel(m))}</span></p>
    <div class="notice form-full"><strong>Hinweis:</strong> Diese Funktion ist für Material gedacht, das direkt weitergeht. Der Bestand wird komplett auf 0 gesetzt und bleibt in der Historie rückverfolgbar.</div>
    <form id="directWriteOffForm" class="form-grid">
      <div class="form-full"><label>Bemerkung</label><textarea id="directWriteOffNote" placeholder="z. B. ging direkt an Auftrag / wurde sofort weitergegeben"></textarea></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="secondary danger" type="submit">Komplett ausbuchen</button></div>
    </form>
  `);
  $('#directWriteOffForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/api/materials/${encodeURIComponent(materialId)}/write-off`, { method: 'POST', body: JSON.stringify({ note: $('#directWriteOffNote').value }) });
      closeModal();
      showToast('Material ausgebucht', materialTitle(m));
      await loadState(true);
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.openUndoDeliveryModal = (orderId) => {
  if (!state.permissions.canCorrectIncoming) return showToast('Keine Berechtigung', 'Lieferungen rückgängig machen dürfen nur Büro, Chef oder Admin.');
  const order = (state.orders || []).find(o => o.id === orderId);
  if (!order) return showToast('Bestellung fehlt', 'Die Bestellung wurde nicht gefunden.');
  openModal(`
    <h2>Geliefert rückgängig machen</h2>
    <p><strong>${escapeHtml(orderMaterialTitle(order))}</strong><br><span class="muted">${escapeHtml(orderQuantityLabel(order, 'received'))} · Lieferant: ${escapeHtml(orderCustomerName(order))}</span></p>
    <div class="notice form-full"><strong>Hinweis:</strong> Der gebuchte Wareneingang wird aus dem Bestand zurückgerechnet. Die Bestellung bleibt in der Bestellübersicht stehen und springt wieder auf <strong>Bestellt</strong>.</div>
    <form id="undoDeliveryForm" class="form-grid">
      <div class="form-full"><label>Bemerkung</label><textarea id="undoDeliveryNote" placeholder="optional, z. B. falsch gebucht / falsche Lieferung"></textarea></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="secondary danger" type="submit">Geliefert rückgängig</button></div>
    </form>
  `);
  $('#undoDeliveryForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/api/orders/${encodeURIComponent(orderId)}/undo-delivery`, { method: 'POST', body: JSON.stringify({ note: $('#undoDeliveryNote').value }) });
      closeModal();
      showToast('Lieferung rückgängig', orderMaterialTitle(order));
      await loadState(true);
      currentPage = 'orders';
      render();
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.openOrderModal = (materialId = '', initialMode = '') => {
  const canRequest = Boolean(state.permissions.canRequestOrder);
  const canDirectIncoming = Boolean(state.permissions.canReceiveDelivery);
  if (!canRequest && !canDirectIncoming) return showToast('Keine Berechtigung', 'Diese Rolle darf keine Bestell- oder Wareneingänge erfassen.');

  const availableModes = [];
  if (canRequest) availableModes.push(['REQUEST', 'Bestellanforderung']);
  if (canRequest) availableModes.push(['KONSI_REQUEST', 'Konsi-Bestellung']);
  if (canDirectIncoming) availableModes.push(['DIRECT_INCOMING', 'Wareneingang ohne Bestellung']);
  let mode = initialMode && availableModes.some(([value]) => value === initialMode) ? initialMode : (availableModes[0] ? availableModes[0][0] : 'REQUEST');
  const modeOptions = availableModes.map(([value, label]) => `<option value="${value}" ${value === mode ? 'selected' : ''}>${label}</option>`).join('');

  const orderMaterials = (state.materials || []).filter(m => !m.archived && !m.rest);
  const orderOptions = orderMaterials.filter(m => !isKonsi(m)).map(m => `<option value="${escapeHtml(m.id)}" ${m.id === materialId ? 'selected' : ''}>${escapeHtml(materialTitle(m))} · ${escapeHtml(storageLabel(m))} · ${quantityLabel(m)}</option>`).join('');
  const konsiOrderOptions = orderMaterials.filter(isKonsi).map(m => `<option value="${escapeHtml(m.id)}" ${m.id === materialId ? 'selected' : ''}>${escapeHtml(materialTitle(m))} · Konsi · ${quantityLabel(m)}</option>`).join('');
  const directOptions = (state.materials || [])
    .filter(m => !m.archived && !m.rest && !isKonsi(m))
    .map(m => `<option value="${escapeHtml(m.id)}" ${m.id === materialId ? 'selected' : ''}>${escapeHtml(materialTitle(m))} · ${escapeHtml(formatDisplayValue(m.format || '-'))} · ${escapeHtml(materialLocationLabel(m))}</option>`)
    .join('');

  openModal(`
    <h2>Bestellung / Wareneingang erfassen</h2>
    <p class="muted" id="orderCaptureHint">Wähle, ob du eine Bestellanforderung oder einen Wareneingang ohne Bestellung erfassen möchtest.</p>
    <form id="orderForm" class="form-grid">
      <div class="form-full"><label>Art des Vorgangs</label><select id="orderCaptureMode">${modeOptions}</select></div>

      <div class="form-full capture-section" id="orderRequestSection">
        <div class="notice"><strong id="orderRequestTitle">Bestellanforderung</strong><br><span id="orderRequestNotice">Jede Rolle kann hier eine Anfrage erfassen. Das Material kann aus der Liste gewählt oder frei eingetippt werden.</span></div>
      </div>
      <div class="form-full capture-section" id="orderCustomerSection"><label>Lieferant</label><input id="orderCustomer" placeholder="z. B. Lieferant / leer = Ohne Lieferant"><div class="format-hint">Danach werden Bestellungen und PDFs pro Lieferant gruppiert.</div></div>
      <div class="capture-section" id="orderInputModeSection"><label>Materialangabe</label><select id="orderInputMode"><option value="EXISTING">Material aus Liste</option><option value="MANUAL">Material frei eingeben</option></select></div>
      <div class="form-full capture-section" id="orderMaterialSection"><label id="orderMaterialLabel">Material aus Liste</label><select id="orderMaterial" data-normal-options="${escapeHtml(orderOptions)}" data-konsi-options="${escapeHtml(konsiOrderOptions)}">${orderOptions}</select></div>
      <div class="capture-section hidden" id="orderManualNameSection"><label>Material</label><input id="orderManualName" placeholder="z. B. 1.4571 oder AlMg3"></div>
      <div class="capture-section hidden" id="orderManualThicknessSection"><label>Stärke</label><input id="orderManualThickness" placeholder="z. B. 2,5 oder 2,50 mm"><div class="format-hint">Wird automatisch z. B. zu 2,50 mm.</div></div>
      <div class="capture-section" id="orderAmountSection"><label id="orderAmountLabel">Menge</label><input id="orderAmount" type="number" min="1" step="1" value="1"></div>
      <div class="capture-section" id="orderUnitSection"><label>Einheit</label><select id="orderUnit"><option value="PAKET">Paket(e)</option><option value="TAFEL">Tafel(n)</option></select></div>
      ${canSeePrices() ? `<div class="capture-section" id="orderKgPriceSection"><label>KG-Preis €/kg</label><input id="orderKgPrice" type="number" min="0" step="0.01" placeholder="z. B. 2,35"><div class="format-hint">Nur Büro/Chef.</div></div>` : ''}
      <div class="form-full capture-section" id="orderCertificateSection"><label>Werkszeugnis PDF optional</label><input id="orderCertificate" type="file" accept="application/pdf,.pdf"><div class="format-hint">Wird direkt beim Material abgelegt. Bei freier Materialanfrage wird es beim späteren Wareneingang mit übernommen.</div></div>
      <div class="form-full capture-section" id="orderNoteSection"><label id="orderNoteLabel">Hinweis</label><textarea id="orderNote" placeholder="z. B. Lieferant, dringend, Rückfrage ..."></textarea></div>

      <div class="form-full capture-section hidden" id="directIncomingSection">
        <div class="notice"><strong>Wareneingang ohne Bestellung</strong><br>Für Lieferungen, die nicht vorher in der Bestellliste standen. Der Eingang wird als Wareneingang in Material und Historie markiert.</div>
      </div>
      <div class="form-full capture-section hidden" id="directIncomingMaterialSection"><label>Material aus Bestand wählen oder neues Material erfassen</label><select id="directIncomingMaterial"><option value="">Neues / nicht gelistetes Material</option>${directOptions}</select></div>
      <div class="capture-section hidden" id="directIncomingNameSection"><label>Material</label><input id="directIncomingName" placeholder="z. B. S235"></div>
      <div class="capture-section hidden" id="directIncomingThicknessSection"><label>Stärke</label><input id="directIncomingThickness" placeholder="z. B. 3 oder 3 mm"><div class="format-hint">Pflichtfeld: Wareneingang kann erst mit Stärke gebucht werden.</div></div>
      <div class="capture-section hidden" id="directIncomingFormatSection"><label>Format</label><select id="directIncomingFormat">${formatOptions('3000x1500')}</select></div>
      <div class="capture-section hidden" id="directIncomingShelfSection"><label>Ablageort</label><select id="directIncomingShelf">${shelfOptions('Carport')}</select></div>
      <div class="capture-section hidden" id="directIncomingPackagesSection"><label>Gelieferte Pakete</label><input id="directIncomingPackages" type="number" min="0" step="1" value="1"></div>
      <div class="capture-section hidden" id="directIncomingWeightSection"><label>Gewicht pro Paket kg</label><input id="directIncomingWeight" type="number" min="0" step="0.1" placeholder="z. B. 850"><div class="format-hint">Optional. Daraus kann die Tafeln-Menge berechnet werden.</div></div>
      ${canSeePrices() ? `<div class="capture-section hidden" id="directIncomingKgPriceSection"><label>KG-Preis €/kg</label><input id="directIncomingKgPrice" type="number" min="0" step="0.01" placeholder="z. B. 2,35"><div class="format-hint">Nur Büro/Chef.</div></div>` : ''}
      <div class="form-full weight-calc-box capture-section hidden" id="directIncomingCalcSection"><div><strong>Berechnung</strong><br><span id="directIncomingWeightHint">Bei neuem Material Stärke und Format eintragen, dann wird die Berechnung genauer.</span></div><div class="format-hint" id="directIncomingCalcHint">Pakete und Gewicht pro Paket eintragen, dann wird eine Tafeln-Menge vorgeschlagen.</div></div>
      <div class="capture-section hidden" id="directIncomingSheetsSection"><label>Berechnete / gelieferte Tafeln</label><input id="directIncomingSheets" type="number" min="0" step="1" value="0"></div>
      <div class="form-full capture-section hidden" id="directIncomingCertificateSection"><label>Werkszeugnis PDF optional</label><input id="directIncomingCertificate" type="file" accept="application/pdf,.pdf"><div class="format-hint">Wird direkt beim gelieferten Material abgelegt und später auf der Materialkarte abrufbar.</div></div>
      <div class="form-full capture-section hidden" id="directIncomingNoteSection"><label>Bemerkung</label><textarea id="directIncomingNote" placeholder="z. B. Lieferschein, Lieferant, ohne Bestellung gekommen ..."></textarea></div>

      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" id="orderSubmitButton" type="submit">Speichern</button></div>
    </form>
  `);

  const orderSectionIds = ['orderRequestSection','orderCustomerSection','orderInputModeSection','orderMaterialSection','orderManualNameSection','orderManualThicknessSection','orderAmountSection','orderUnitSection','orderKgPriceSection','orderCertificateSection','orderNoteSection'];
  const incomingSectionIds = ['directIncomingSection','directIncomingMaterialSection','directIncomingNameSection','directIncomingThicknessSection','directIncomingFormatSection','directIncomingShelfSection','directIncomingPackagesSection','directIncomingWeightSection','directIncomingKgPriceSection','directIncomingCalcSection','directIncomingSheetsSection','directIncomingCertificateSection','directIncomingNoteSection'];
  const showIds = (ids, show) => ids.forEach(id => { const el = $('#'+id); if (el) el.classList.toggle('hidden', !show); });

  const selectedOrderMaterial = () => (state.materials || []).find(m => m.id === $('#orderMaterial').value) || null;
  const selectedIncomingMaterial = () => (state.materials || []).find(m => m.id === $('#directIncomingMaterial').value) || null;
  const currentIncomingMaterialData = () => selectedIncomingMaterial() || {
    name: $('#directIncomingName').value,
    thickness: $('#directIncomingThickness').value,
    format: $('#directIncomingFormat').value
  };

  const updateOrderEntryMode = () => {
    const captureMode = $('#orderCaptureMode').value;
    const konsiMode = captureMode === 'KONSI_REQUEST';
    const manual = $('#orderInputMode').value === 'MANUAL';
    const select = $('#orderMaterial');
    const expectedMode = konsiMode ? 'KONSI' : 'NORMAL';
    if (select.dataset.mode !== expectedMode) {
      select.innerHTML = konsiMode ? (select.dataset.konsiOptions || '<option value="">Kein Konsi-Material angelegt</option>') : (select.dataset.normalOptions || '');
      if (materialId && Array.from(select.options).some(opt => opt.value === materialId)) select.value = materialId;
      select.dataset.mode = expectedMode;
    }
    const selected = selectedOrderMaterial();
    const konsi = konsiMode || (!manual && isKonsi(selected));
    $('#orderMaterialLabel').textContent = konsiMode ? 'Konsi-Material aus Liste' : 'Material aus Liste';
    $('#orderMaterialSection').classList.toggle('hidden', manual);
    $('#orderManualNameSection').classList.toggle('hidden', !manual);
    $('#orderManualThicknessSection').classList.toggle('hidden', !manual);
    $('#orderUnit').value = konsi ? 'PAKET' : $('#orderUnit').value;
    $('#orderUnit option[value="TAFEL"]').disabled = konsi;
    $('#orderAmountLabel').textContent = konsi ? 'Menge / Pakete' : 'Menge';
  };

  function updateDirectIncomingCalculation() {
    const material = currentIncomingMaterialData();
    const packages = Number($('#directIncomingPackages').value || 0);
    const weight = Number($('#directIncomingWeight').value || 0);
    const sheets = estimatedSheetsFromWeight(material, weight, packages);
    const oneSheet = sheetWeightKg(material);
    $('#directIncomingWeightHint').textContent = weightInfoText(material);
    if (sheets > 0) {
      $('#directIncomingSheets').value = sheets;
      const price = canSeePrices() && $('#directIncomingKgPrice') ? Number($('#directIncomingKgPrice').value || 0) : 0;
      const priceText = price && packages && weight ? ` · Wert: ${formatMoney(packages * weight * price)} bei ${formatKgPrice(price)}` : '';
      $('#directIncomingCalcHint').textContent = `${packages} Paket(e) × ${String(weight).replace('.', ',')} kg → ca. ${sheets} Tafeln${oneSheet ? ` (${oneSheet.toFixed(1).replace('.', ',')} kg/Tafel)` : ''}${priceText}.`;
    } else {
      $('#directIncomingCalcHint').textContent = 'Pakete und Gewicht pro Paket eintragen, dann wird eine Tafeln-Menge vorgeschlagen.';
    }
  }

  const fillIncomingFromSelected = () => {
    const material = selectedIncomingMaterial();
    const isExisting = Boolean(material);
    $('#directIncomingName').disabled = isExisting;
    $('#directIncomingThickness').disabled = isExisting;
    $('#directIncomingFormat').disabled = isExisting;
    if (material) {
      $('#directIncomingName').value = material.name || '';
      $('#directIncomingThickness').value = material.thickness || '';
      setFormatSelectValue('#directIncomingFormat', material.format || '3000x1500');
    }
    updateDirectIncomingCalculation();
  };

  const updateCaptureMode = () => {
    const current = $('#orderCaptureMode').value;
    const isIncoming = current === 'DIRECT_INCOMING';
    const isKonsiOrder = current === 'KONSI_REQUEST';
    showIds(orderSectionIds, !isIncoming);
    showIds(incomingSectionIds, isIncoming);
    $('#orderSubmitButton').textContent = isIncoming ? 'Wareneingang buchen' : 'Anfrage senden';
    $('#orderRequestTitle').textContent = isKonsiOrder ? 'Konsi-Bestellung' : 'Bestellanforderung';
    $('#orderRequestNotice').textContent = isKonsiOrder
      ? 'Konsi wird als eigene Anfrage geführt und bleibt in der Bestellübersicht getrennt von normalen Bestellungen.'
      : 'Jede Rolle kann hier eine Anfrage erfassen. Das Material kann aus der Liste gewählt oder frei eingetippt werden.';
    $('#orderCaptureHint').textContent = isIncoming
      ? 'Wareneingang ohne Bestellung wird sofort als gelieferter Eingang gebucht.'
      : (isKonsiOrder ? 'Konsi-Bestellung wird als separate offene Anfrage gespeichert.' : 'Bestellanforderung wird als offene Anfrage für Büro/Chef gespeichert.');
    if (isIncoming) fillIncomingFromSelected();
    else updateOrderEntryMode();
  };

  $('#orderCaptureMode').addEventListener('change', updateCaptureMode);
  $('#orderInputMode').addEventListener('change', updateOrderEntryMode);
  $('#orderMaterial').addEventListener('change', updateOrderEntryMode);
  $('#orderManualName').addEventListener('blur', () => { $('#orderManualName').value = normalizeMaterialCaseInput($('#orderManualName').value); });
  $('#orderManualThickness').addEventListener('blur', () => { $('#orderManualThickness').value = normalizeThicknessInput($('#orderManualThickness').value); });
  $('#directIncomingMaterial').addEventListener('change', fillIncomingFromSelected);
  ['directIncomingName','directIncomingThickness','directIncomingFormat','directIncomingPackages','directIncomingWeight','directIncomingKgPrice'].forEach(id => {
    const el = $('#'+id);
    if (el) el.addEventListener('input', updateDirectIncomingCalculation);
    if (el && el.tagName === 'SELECT') el.addEventListener('change', updateDirectIncomingCalculation);
  });
  updateCaptureMode();

  $('#orderForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = $('#orderCaptureMode').value;
    try {
      if (current === 'DIRECT_INCOMING') {
        const requiredThickness = normalizeThicknessInput($('#directIncomingThickness').value).trim();
        if (!requiredThickness) {
          showToast('Stärke fehlt', 'Bitte zuerst die Stärke eintragen.');
          $('#directIncomingThickness').focus();
          return;
        }
        const payload = {
          materialId: $('#directIncomingMaterial').value,
          name: $('#directIncomingName').value,
          thickness: requiredThickness,
          format: $('#directIncomingFormat').value,
          receivedAmount: Number($('#directIncomingPackages').value || 0),
          receivedSheets: Number($('#directIncomingSheets').value || 0),
          packageWeightKg: Number($('#directIncomingWeight').value || 0),
          kgPrice: canSeePrices() && $('#directIncomingKgPrice') ? $('#directIncomingKgPrice').value : '',
          targetShelf: $('#directIncomingShelf').value,
          note: $('#directIncomingNote').value,
          ...(await certificatePayloadFromInput('directIncomingCertificate'))
        };
        await api('/api/orders/direct-receive', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Wareneingang gebucht', `Material wurde als Wareneingang nach ${payload.targetShelf || 'Carport'} gebucht.`);
        orderFilter.status = 'delivered';
      } else {
        const manual = $('#orderInputMode').value === 'MANUAL';
        const konsiMode = current === 'KONSI_REQUEST';
        const unit = konsiMode ? 'PAKET' : ($('#orderUnit').value === 'TAFEL' ? 'TAFEL' : 'PAKET');
        const qty = Number($('#orderAmount').value || 0);
        if (!Number.isFinite(qty) || qty <= 0) return showToast('Menge fehlt', 'Bitte eine gültige Menge eintragen.');
        if (manual && !normalizeMaterialCaseInput($('#orderManualName').value).trim()) return showToast('Material fehlt', 'Bitte Material eintragen.');
        if (manual && !normalizeThicknessInput($('#orderManualThickness').value).trim()) return showToast('Stärke fehlt', 'Bitte Stärke eintragen.');
        const payload = {
          materialId: manual ? '' : $('#orderMaterial').value,
          customerName: $('#orderCustomer').value,
          name: manual ? $('#orderManualName').value : '',
          thickness: manual ? normalizeThicknessInput($('#orderManualThickness').value) : '',
          amount: unit === 'PAKET' ? qty : 0,
          sheets: unit === 'TAFEL' ? qty : 0,
          unit,
          storage: konsiMode ? 'KONSI' : '',
          konsiOrder: konsiMode,
          kgPrice: canSeePrices() && $('#orderKgPrice') ? $('#orderKgPrice').value : '',
          note: $('#orderNote').value,
          ...(await certificatePayloadFromInput('orderCertificate'))
        };
        await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Bestellung gesendet', konsiMode ? 'Die Konsi-Anfrage wurde separat gespeichert.' : (manual ? 'Die freie Materialanfrage wurde an Büro/Chef übertragen.' : 'Die Meldung wurde an Büro/Chef übertragen.'));
        orderFilter.status = 'requested';
      }
      closeModal();
      await loadState(true);
      currentPage = 'orders';
      renderCurrentPage();
    } catch (error) { showToast('Fehler', error.message); }
  });
};



window.openOrderSupplierModal = (orderId) => {
  const o = state.orders.find(x => x.id === orderId);
  if (!o) return showToast('Bestellung fehlt', 'Der Vorgang wurde nicht gefunden.');
  openModal(`
    <h2>Lieferant ändern</h2>
    <p><strong class="order-material-title">${escapeHtml(orderMaterialTitle(o))}</strong><span class="muted">Aktuell: ${escapeHtml(orderCustomerName(o))}</span></p>
    <form id="supplierChangeForm" class="form-grid">
      <div class="form-full"><label>Lieferant</label><input id="supplierChangeName" value="${escapeHtml(orderCustomerName(o))}" placeholder="z. B. Lieferant / leer = Ohne Lieferant"><div class="format-hint">Die Bestellung wird danach automatisch in die passende Lieferantengruppe verschoben.</div></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Speichern</button></div>
    </form>
  `);
  $('#supplierChangeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await updateOrder(orderId, 'SUPPLIER', null, o.note || '', o.orderedSheets || 0, '', $('#supplierChangeName').value);
    closeModal();
  });
};

window.openOrderedModal = (orderId) => {
  const o = state.orders.find(x => x.id === orderId);
  const material = (state.materials || []).find(m => m.id === (o && o.materialId));
  openModal(`
    <h2>Als bestellt markieren</h2>
    <p><strong class="order-material-title">${escapeHtml(orderMaterialTitle(o))}</strong><span class="muted">Anfrage: ${orderQuantityLabel(o, 'request')}</span></p>
    <form id="orderedForm" class="form-grid">
      <div class="form-full"><label>Lieferant</label><input id="orderedCustomer" value="${escapeHtml(orderCustomerName(o))}" placeholder="z. B. Lieferant"><div class="format-hint">Änderung sortiert die Bestellung in die passende Lieferantengruppe.</div></div>
      <div><label>Bestellte Pakete</label><input id="orderedAmount" type="number" min="${o.storage === 'KONSI' ? '1' : '0'}" step="1" value="${Number(o.requestedAmount || 0)}"></div>${o.storage !== 'KONSI' ? `<div><label>Bestellte Tafeln</label><input id="orderedSheets" type="number" min="0" step="1" value="${Number(o.requestedSheets || 0)}"></div>` : ''}
      ${canSeePrices() && o.storage !== 'KONSI' ? `<div><label>KG-Preis €/kg</label><input id="orderedKgPrice" type="number" min="0" step="0.01" value="${o.kgPrice ?? material?.kgPrice ?? ''}" placeholder="z. B. 2,35"><div class="format-hint">Nur sichtbar für Büro/Chef.</div></div>` : ''}
      <div class="form-full"><label>Hinweis vom Büro</label><textarea id="orderedNote" placeholder="z. B. Liefertermin, Lieferant oder Rückfrage ...">${escapeHtml(o.note || '')}</textarea></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Bestellt melden</button></div>
    </form>
  `);
  $('#orderedForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await updateOrder(orderId, 'ORDERED', $('#orderedAmount').value, $('#orderedNote').value, o.storage !== 'KONSI' ? $('#orderedSheets').value : 0, canSeePrices() && $('#orderedKgPrice') ? $('#orderedKgPrice').value : '', $('#orderedCustomer').value);
    closeModal();
  });
};


window.openReceiveModal = (orderId) => {
  const o = state.orders.find(x => x.id === orderId);
  if (!o) return;
  const isK = o.storage === 'KONSI';
  const material = (state.materials || []).find(m => m.id === o.materialId) || { name: o.materialName, thickness: o.materialThickness, format: o.materialFormat || '3000x1500' };
  const orderedP = Number(o.orderedAmount ?? o.requestedAmount ?? 0) || 0;
  const orderedS = Number(o.orderedSheets ?? o.requestedSheets ?? 0) || 0;
  const receivedP = Number(o.receivedAmount || 0);
  const openP = Math.max(0, orderedP - receivedP) || (orderedS > 0 ? 0 : 1);
  const defaultWeight = Number(o.lastPackageWeightKg || material.lastPackageWeightKg || 0) || '';
  const defaultKgPrice = o.kgPrice ?? material.kgPrice ?? '';
  openModal(`
    <h2>${isK ? 'Konsi-Lieferung annehmen' : 'Lieferung annehmen'}</h2>
    <p><strong class="order-material-title">${escapeHtml(orderMaterialTitle(o))}</strong><span class="muted">Bestellt: ${orderQuantityLabel(o, 'ordered')} · Bereits geliefert: ${orderQuantityLabel(o, 'received')}</span></p>
    <form id="receiveForm" class="form-grid">
      <div><label>Gelieferte Pakete</label><input id="receivedAmount" type="number" min="0" step="1" value="${openP}"><div class="format-hint">Nur bei Lieferung: Pakete werden über Gewicht in Tafeln umgerechnet.</div></div>
      ${isK ? '' : `<div><label>Gewicht pro Paket kg</label><input id="packageWeightKg" type="number" min="0" step="0.1" value="${defaultWeight}" placeholder="z. B. 850"><div class="format-hint">Beispiel: 2 Pakete à 850 kg = 1700 kg.</div></div>
      ${canSeePrices() ? `<div><label>KG-Preis €/kg</label><input id="receiveKgPrice" type="number" min="0" step="0.01" value="${defaultKgPrice}" placeholder="z. B. 2,35"><div class="format-hint">Nur Büro/Chef.</div></div>` : ''}
      <div class="form-full weight-calc-box"><div><strong>Berechnung</strong><br><span id="sheetWeightHint">${escapeHtml(weightInfoText(material))}</span></div><div class="format-hint" id="weightCalcHint">Pakete und Gewicht pro Paket eintragen, dann werden die Tafeln automatisch vorgeschlagen.</div></div>
      <div><label>Berechnete Tafeln</label><input id="receivedSheets" type="number" min="0" step="1" value="${Math.max(0, orderedS - Number(o.receivedSheets || 0))}"><div class="format-hint">Wird aus Pakete × Gewicht berechnet, kann aber überschrieben werden.</div></div>`}
      ${isK ? `<div class="form-full"><label>Konsi-Paketnummern</label><textarea id="receivedPackageNumbers" placeholder="eine Paketnummer pro Zeile"></textarea><div class="format-hint">Beim Konsi muss für jedes gelieferte Paket eine Nummer eingetragen werden.</div></div>` : `<div class="form-full"><label>Ablageort</label><select id="deliveryShelf">${shelfOptions('Carport')}</select><div class="format-hint">Standard ist Carport, weil Lieferungen meistens dort gelagert werden. Ausnahmen können direkt auf Bodenhaltung oder Regal 1–6 gebucht werden.</div></div>`}
      <div class="form-full"><label>${isK ? 'Konsi Lieferschein PDF optional' : 'Lieferschein PDF optional'}</label><input id="receiveDeliveryNote" type="file" accept="application/pdf,.pdf"><div class="format-hint">Wird beim Datum und Lieferanten der Bestellung abgelegt und bleibt abrufbar.</div></div>
      <div class="form-full"><label>Werkszeugnis PDF optional</label><input id="receiveCertificate" type="file" accept="application/pdf,.pdf"><div class="format-hint">Wird direkt beim gelieferten Material abgelegt und später auf der Materialkarte abrufbar.</div></div>
      <div class="form-full"><label>Bemerkung</label><textarea id="receiveNote" placeholder="z. B. Lieferschein, Schaden, Besonderheit ...">${escapeHtml(o.note || '')}</textarea></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Lieferung annehmen</button></div>
    </form>
  `);
  function updateWeightCalculation() {
    if (isK) return;
    const packages = Number($('#receivedAmount').value || 0);
    const weight = Number($('#packageWeightKg').value || 0);
    const sheets = estimatedSheetsFromWeight(material, weight, packages);
    const oneSheet = sheetWeightKg(material);
    const totalWeight = packages * weight;
    const price = canSeePrices() && $('#receiveKgPrice') ? Number($('#receiveKgPrice').value || 0) : 0;
    const priceText = price && totalWeight ? ` · Wert: ${formatMoney(totalWeight * price)} bei ${formatKgPrice(price)}` : '';
    $('#weightCalcHint').textContent = sheets > 0
      ? `Vorschlag: ${packages} Paket(e) × ${String(weight).replace('.', ',')} kg = ${String(totalWeight).replace('.', ',')} kg → ca. ${sheets} Tafeln${oneSheet ? ` (${oneSheet.toFixed(1).replace('.', ',')} kg/Tafel)` : ''}${priceText}.`
      : 'Pakete und Gewicht pro Paket eintragen, dann werden die Tafeln automatisch vorgeschlagen.';
    if (sheets > 0) $('#receivedSheets').value = sheets;
  }
  if (!isK) {
    $('#receivedAmount').addEventListener('input', updateWeightCalculation);
    $('#packageWeightKg').addEventListener('input', updateWeightCalculation);
    if ($('#receiveKgPrice')) $('#receiveKgPrice').addEventListener('input', updateWeightCalculation);
    updateWeightCalculation();
  }
  $('#receiveForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      receivedAmount: Number($('#receivedAmount').value || 0),
      receivedSheets: isK ? 0 : Number($('#receivedSheets').value || 0),
      packageWeightKg: isK ? 0 : Number($('#packageWeightKg').value || 0),
      kgPrice: (!isK && canSeePrices() && $('#receiveKgPrice')) ? $('#receiveKgPrice').value : '',
      targetShelf: isK ? '' : $('#deliveryShelf').value,
      packageNumbers: isK ? $('#receivedPackageNumbers').value : '',
      note: $('#receiveNote').value,
      ...(await certificatePayloadFromInput('receiveCertificate'))
    };
    try {
      await api(`/api/orders/${orderId}/receive`, { method: 'POST', body: JSON.stringify(payload) });
      const noteFile = $('#receiveDeliveryNote') && $('#receiveDeliveryNote').files ? $('#receiveDeliveryNote').files[0] : null;
      if (noteFile) await uploadPdfFileToOrderCustomer(orderDayKey(o), orderCustomerKey(o), isK ? 'konsi-delivery-note' : 'delivery-note', noteFile);
      closeModal();
      showToast('Lieferung angenommen', isK ? 'Konsi-Pakete wurden in der Garage übernommen.' : `Material wurde als geliefert nach ${payload.targetShelf || 'Carport'} gebucht.`);
      await loadState(true);
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.openDirectIncomingModal = () => {
  if (!state.permissions.canReceiveDelivery) return showToast('Keine Berechtigung', 'Wareneingang darf diese Rolle nicht buchen.');
  const materialOptions = (state.materials || [])
    .filter(m => !m.archived && !m.rest && !isKonsi(m))
    .map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(materialTitle(m))} · ${escapeHtml(formatDisplayValue(m.format || '-'))} · ${escapeHtml(materialLocationLabel(m))}</option>`)
    .join('');
  openModal(`
    <h2>Wareneingang ohne Bestellung</h2>
    <p class="muted">Für Lieferungen, die nicht vorher in der Bestellliste standen. Der Eingang wird wie eine angenommene Lieferung als <strong>Wareneingang</strong> in Material und Historie markiert.</p>
    <form id="directIncomingForm" class="form-grid">
      <div class="form-full"><label>Material aus Bestand wählen oder neues Material erfassen</label><select id="directIncomingMaterial"><option value="">Neues / nicht gelistetes Material</option>${materialOptions}</select></div>
      <div><label>Material</label><input id="directIncomingName" placeholder="z. B. S235"></div>
      <div><label>Stärke</label><input id="directIncomingThickness" required placeholder="z. B. 3 oder 3 mm"><div class="format-hint">Pflichtfeld: Wareneingang kann erst mit Stärke gebucht werden.</div></div>
      <div><label>Format</label><select id="directIncomingFormat">${formatOptions('3000x1500')}</select></div>
      <div><label>Ablageort</label><select id="directIncomingShelf">${shelfOptions('Carport')}</select></div>
      <div><label>Gelieferte Pakete</label><input id="directIncomingPackages" type="number" min="0" step="1" value="1"></div>
      <div><label>Gewicht pro Paket kg</label><input id="directIncomingWeight" type="number" min="0" step="0.1" placeholder="z. B. 850"><div class="format-hint">Optional. Daraus kann die Tafeln-Menge berechnet werden.</div></div>
      ${canSeePrices() ? `<div><label>KG-Preis €/kg</label><input id="directIncomingKgPrice" type="number" min="0" step="0.01" placeholder="z. B. 2,35"><div class="format-hint">Nur Büro/Chef.</div></div>` : ''}
      <div class="form-full weight-calc-box"><div><strong>Berechnung</strong><br><span id="directIncomingWeightHint">Bei neuem Material Stärke und Format eintragen, dann wird die Berechnung genauer.</span></div><div class="format-hint" id="directIncomingCalcHint">Pakete und Gewicht pro Paket eintragen, dann wird eine Tafeln-Menge vorgeschlagen.</div></div>
      <div><label>Berechnete / gelieferte Tafeln</label><input id="directIncomingSheets" type="number" min="0" step="1" value="0"></div>
      <div class="form-full"><label>Bemerkung</label><textarea id="directIncomingNote" placeholder="z. B. Lieferschein, Lieferant, ohne Bestellung gekommen ..."></textarea></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Wareneingang buchen</button></div>
    </form>
  `);
  const selectedMaterial = () => (state.materials || []).find(m => m.id === $('#directIncomingMaterial').value) || null;
  const currentIncomingMaterialData = () => selectedMaterial() || {
    name: $('#directIncomingName').value,
    thickness: $('#directIncomingThickness').value,
    format: $('#directIncomingFormat').value
  };
  const fillFromSelected = () => {
    const material = selectedMaterial();
    const isExisting = Boolean(material);
    $('#directIncomingName').disabled = isExisting;
    $('#directIncomingThickness').disabled = isExisting;
    $('#directIncomingFormat').disabled = isExisting;
    if (material) {
      $('#directIncomingName').value = material.name || '';
      $('#directIncomingThickness').value = material.thickness || '';
      setFormatSelectValue('#directIncomingFormat', material.format || '3000x1500');
    }
    updateDirectIncomingCalculation();
  };
  function updateDirectIncomingCalculation() {
    const material = currentIncomingMaterialData();
    const packages = Number($('#directIncomingPackages').value || 0);
    const weight = Number($('#directIncomingWeight').value || 0);
    const sheets = estimatedSheetsFromWeight(material, weight, packages);
    const oneSheet = sheetWeightKg(material);
    $('#directIncomingWeightHint').textContent = weightInfoText(material);
    if (sheets > 0) {
      $('#directIncomingSheets').value = sheets;
      const price = canSeePrices() && $('#directIncomingKgPrice') ? Number($('#directIncomingKgPrice').value || 0) : 0;
      const priceText = price && packages && weight ? ` · Wert: ${formatMoney(packages * weight * price)} bei ${formatKgPrice(price)}` : '';
      $('#directIncomingCalcHint').textContent = `${packages} Paket(e) × ${String(weight).replace('.', ',')} kg → ca. ${sheets} Tafeln${oneSheet ? ` (${oneSheet.toFixed(1).replace('.', ',')} kg/Tafel)` : ''}${priceText}.`;
    } else {
      $('#directIncomingCalcHint').textContent = 'Pakete und Gewicht pro Paket eintragen, dann wird eine Tafeln-Menge vorgeschlagen.';
    }
  }
  $('#directIncomingMaterial').addEventListener('change', fillFromSelected);
  ['directIncomingName','directIncomingThickness','directIncomingFormat','directIncomingPackages','directIncomingWeight','directIncomingKgPrice'].forEach(id => {
    const el = $('#'+id);
    if (el) el.addEventListener('input', updateDirectIncomingCalculation);
    if (el && el.tagName === 'SELECT') el.addEventListener('change', updateDirectIncomingCalculation);
  });
  fillFromSelected();
  $('#directIncomingForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const requiredThickness = normalizeThicknessInput($('#directIncomingThickness').value).trim();
    if (!requiredThickness) {
      showToast('Stärke fehlt', 'Bitte zuerst die Stärke eintragen.');
      $('#directIncomingThickness').focus();
      return;
    }
    const payload = {
      materialId: $('#directIncomingMaterial').value,
      name: $('#directIncomingName').value,
      thickness: requiredThickness,
      format: $('#directIncomingFormat').value,
      receivedAmount: Number($('#directIncomingPackages').value || 0),
      receivedSheets: Number($('#directIncomingSheets').value || 0),
      packageWeightKg: Number($('#directIncomingWeight').value || 0),
      kgPrice: canSeePrices() && $('#directIncomingKgPrice') ? $('#directIncomingKgPrice').value : '',
      targetShelf: $('#directIncomingShelf').value,
      note: $('#directIncomingNote').value
    };
    try {
      await api('/api/orders/direct-receive', { method: 'POST', body: JSON.stringify(payload) });
      closeModal();
      showToast('Wareneingang gebucht', `Material wurde als Wareneingang nach ${payload.targetShelf || 'Carport'} gebucht.`);
      orderFilter.status = 'delivered';
      await loadState(true);
      currentPage = 'orders';
      renderCurrentPage();
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.openEditDirectIncomingModal = (orderId) => {
  if (!state.permissions.canCorrectIncoming) return showToast('Keine Berechtigung', 'Wareneingänge dürfen nur Büro, Chef oder Admin nachträglich ändern.');
  const order = (state.orders || []).find(o => o.id === orderId);
  if (!order || !['ERLEDIGT','TEILGELIEFERT'].includes(order.status)) return showToast('Nicht gefunden', 'Dieser Wareneingang kann nicht geändert werden.');
  const isK = order.storage === 'KONSI';
  const material = (state.materials || []).find(m => m.id === order.materialId) || {};
  const packages = Number(order.receivedAmount || 0);
  const sheets = Number(order.receivedSheets || 0);
  const deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];
  const lastDelivery = deliveries[0] || {};
  const packageNumbers = deliveries.flatMap(d => Array.isArray(d.packageNumbers) ? d.packageNumbers : []).join('\n');
  if (isK) {
    openModal(`
      <h2>Konsi-Wareneingang ändern</h2>
      <p class="muted">Hier kannst du eine falsch gebuchte Konsi-Lieferung korrigieren. Die Änderung bleibt in der Historie nachvollziehbar.</p>
      <form id="editDirectIncomingForm" class="form-grid">
        <div><label>Gelieferte Pakete</label><input id="editIncomingPackages" type="number" min="0" step="1" value="${packages}"></div>
        <div class="form-full"><label>Konsi-Paketnummern</label><textarea id="editIncomingPackageNumbers" placeholder="eine Paketnummer pro Zeile">${escapeHtml(packageNumbers)}</textarea><div class="format-hint">Anzahl Paketnummern muss zur Paketmenge passen.</div></div>
        <div class="form-full"><label>Bemerkung</label><textarea id="editIncomingNote" placeholder="Warum wurde korrigiert?">${escapeHtml(order.note || '')}</textarea></div>
        <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Änderung speichern</button></div>
      </form>
    `);
    $('#editDirectIncomingForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        receivedAmount: Number($('#editIncomingPackages').value || 0),
        packageNumbers: $('#editIncomingPackageNumbers').value,
        note: $('#editIncomingNote').value
      };
      try {
        await api(`/api/orders/${orderId}/direct-receive`, { method: 'PUT', body: JSON.stringify(payload) });
        closeModal();
        showToast('Wareneingang geändert', 'Die Konsi-Korrektur wurde gespeichert.');
        await loadState(true);
        currentPage = 'orders';
        renderCurrentPage();
      } catch (error) { showToast('Fehler', error.message); }
    });
    return;
  }

  const name = order.materialName || material.name || '';
  const thickness = order.materialThickness || material.thickness || '';
  const format = normalizeFormatValue(order.materialFormat || material.format || '3000x1500');
  const shelf = order.deliveredToShelf || material.shelf || 'Carport';
  const weight = Number(order.lastPackageWeightKg || lastDelivery.packageWeightKg || 0);
  const kgPrice = order.kgPrice ?? material.kgPrice ?? '';
  openModal(`
    <h2>Wareneingang ändern</h2>
    <p class="muted">Korrigiert einen falsch erfassten Wareneingang. Der Bestand wird automatisch zurückgerechnet und neu gebucht. Die Korrektur bleibt in der Historie sichtbar.</p>
    <form id="editDirectIncomingForm" class="form-grid">
      <div><label>Material</label><input id="editIncomingName" value="${escapeHtml(name)}" placeholder="z. B. S235"></div>
      <div><label>Stärke</label><input id="editIncomingThickness" required value="${escapeHtml(thickness)}" placeholder="z. B. 3 oder 3 mm"><div class="format-hint">Pflichtfeld</div></div>
      <div><label>Format</label><select id="editIncomingFormat">${formatOptions(format)}</select></div>
      <div><label>Ablageort</label><select id="editIncomingShelf">${shelfOptions(shelf)}</select></div>
      <div><label>Gelieferte Pakete</label><input id="editIncomingPackages" type="number" min="0" step="1" value="${packages}"></div>
      <div><label>Gewicht pro Paket kg</label><input id="editIncomingWeight" type="number" min="0" step="0.1" value="${weight || ''}" placeholder="z. B. 850"></div>
      ${canSeePrices() ? `<div><label>KG-Preis €/kg</label><input id="editIncomingKgPrice" type="number" min="0" step="0.01" value="${kgPrice === null ? '' : escapeHtml(kgPrice)}" placeholder="z. B. 2,35"><div class="format-hint">Nur Büro/Chef.</div></div>` : ''}
      <div class="form-full weight-calc-box"><div><strong>Berechnung</strong><br><span id="editIncomingWeightHint">Stärke und Format prüfen, dann wird die Berechnung genauer.</span></div><div class="format-hint" id="editIncomingCalcHint">Optional: Pakete und Gewicht pro Paket eintragen.</div></div>
      <div><label>Gelieferte Tafeln</label><input id="editIncomingSheets" type="number" min="0" step="1" value="${sheets}"></div>
      <div class="form-full"><label>Bemerkung</label><textarea id="editIncomingNote" placeholder="Warum wurde korrigiert?">${escapeHtml(order.note || '')}</textarea></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Änderung speichern</button></div>
    </form>
  `);
  const currentMaterialData = () => ({
    name: $('#editIncomingName').value,
    thickness: $('#editIncomingThickness').value,
    format: $('#editIncomingFormat').value
  });
  function updateEditIncomingCalculation() {
    const materialData = currentMaterialData();
    const packagesNow = Number($('#editIncomingPackages').value || 0);
    const weightNow = Number($('#editIncomingWeight').value || 0);
    const suggestedSheets = estimatedSheetsFromWeight(materialData, weightNow, packagesNow);
    const oneSheet = sheetWeightKg(materialData);
    $('#editIncomingWeightHint').textContent = weightInfoText(materialData);
    if (suggestedSheets > 0) {
      $('#editIncomingCalcHint').textContent = `${packagesNow} Paket(e) × ${String(weightNow).replace('.', ',')} kg → ca. ${suggestedSheets} Tafeln${oneSheet ? ` (${oneSheet.toFixed(1).replace('.', ',')} kg/Tafel)` : ''}.`;
    } else {
      $('#editIncomingCalcHint').textContent = 'Optional: Pakete und Gewicht pro Paket eintragen.';
    }
  }
  ['editIncomingName','editIncomingThickness','editIncomingFormat','editIncomingPackages','editIncomingWeight'].forEach(id => {
    const el = $('#'+id);
    if (el) el.addEventListener('input', updateEditIncomingCalculation);
    if (el && el.tagName === 'SELECT') el.addEventListener('change', updateEditIncomingCalculation);
  });
  updateEditIncomingCalculation();
  $('#editDirectIncomingForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const requiredThickness = normalizeThicknessInput($('#editIncomingThickness').value).trim();
    if (!requiredThickness) {
      showToast('Stärke fehlt', 'Bitte zuerst die Stärke eintragen.');
      $('#editIncomingThickness').focus();
      return;
    }
    const payload = {
      name: $('#editIncomingName').value,
      thickness: requiredThickness,
      format: $('#editIncomingFormat').value,
      receivedAmount: Number($('#editIncomingPackages').value || 0),
      receivedSheets: Number($('#editIncomingSheets').value || 0),
      packageWeightKg: Number($('#editIncomingWeight').value || 0),
      kgPrice: canSeePrices() && $('#editIncomingKgPrice') ? $('#editIncomingKgPrice').value : '',
      targetShelf: $('#editIncomingShelf').value,
      note: $('#editIncomingNote').value
    };
    try {
      await api(`/api/orders/${orderId}/direct-receive`, { method: 'PUT', body: JSON.stringify(payload) });
      closeModal();
      showToast('Wareneingang geändert', 'Die Korrektur wurde gespeichert.');
      await loadState(true);
      currentPage = 'orders';
      renderCurrentPage();
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.updateOrder = async (orderId, action, orderedAmount = null, note = '', orderedSheets = 0, kgPrice = '', customerName = undefined) => {
  try {
    const payload = { action, orderedAmount, orderedSheets, note, kgPrice };
    if (customerName !== undefined) { payload.customerName = customerName; payload.supplierName = customerName; }
    await api(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    showToast('Bestellung aktualisiert', 'Der neue Status wurde an alle Arbeitsplätze übertragen.');
    await loadState(true);
  } catch (error) { showToast('Fehler', error.message); }
};


window.createBackupNow = async () => {
  try {
    const data = await api('/api/admin/backups', { method: 'POST', body: JSON.stringify({ label: `Manuelle Sicherung ${new Date().toLocaleString('de-DE')}` }) });
    showToast('Backup erstellt', data.backup.file);
    await loadState(true);
    currentPage = 'adminBackup';
    renderCurrentPage();
  } catch (error) { showToast('Fehler', error.message); }
};

window.downloadBackup = (file) => {
  window.open(`/api/admin/backups/${encodeURIComponent(file)}/download?token=${encodeURIComponent(token)}`, '_blank');
};

window.restoreBackup = async (file) => {
  if (!confirm(`Backup wirklich wiederherstellen?\n\n${file}\n\nVorher wird automatisch eine neue Sicherung erstellt.`)) return;
  try {
    await api(`/api/admin/backups/${encodeURIComponent(file)}/restore`, { method: 'POST' });
    showToast('Backup wiederhergestellt', 'Daten wurden aus der Sicherung übernommen.');
    await loadState(true);
  } catch (error) { showToast('Fehler', error.message); }
};

window.exportMaterialsCsv = () => {
  window.open(`/api/admin/export/materials?token=${encodeURIComponent(token)}`, '_blank');
};

window.exportVisibleMaterialsCsv = () => {
  if (!state.permissions.canExportMaterials) return showToast('Keine Berechtigung', 'CSV-Download ist für Büro und Chef freigegeben.');
  window.open(`/api/materials/export-csv?token=${encodeURIComponent(token)}`, '_blank');
};

window.importMaterialsCsv = async () => {
  const csv = ($('#importCsv') && $('#importCsv').value) || '';
  if (!csv.trim()) return showToast('Keine Eingabe', 'Bitte CSV-Daten einfügen.');
  if (!confirm('Materialien aus CSV importieren?')) return;
  try {
    const data = await api('/api/admin/import/materials', { method: 'POST', body: JSON.stringify({ csv }) });
    showToast('Import erledigt', `${data.created} Materialposition(en) angelegt, ${data.merged || 0} Dublette(n) zusammengeführt.`);
    await loadState(true);
    currentPage = 'adminImportExport';
    renderCurrentPage();
  } catch (error) { showToast('Fehler', error.message); }
};

function normalizeDeleteConfirmText(value) {
  return String(value || '')
    .trim()
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

window.deleteEmptyMaterialsSystem = async () => {
  if (!state.permissions.canManageSystem) return showToast('Keine Berechtigung', 'Nur der Systemzugang darf leere Materialien löschen.');
  const emptyCount = [...(state.materials || []), ...(state.archivedMaterials || [])].filter(isEmptyMaterialClient).length;
  if (!emptyCount) return showToast('Keine leeren Materialien', 'Es gibt aktuell keine Materialpositionen mit Menge 0.');
  if (!confirm(`${emptyCount} leere Materialposition(en) wirklich löschen?\n\nVorher wird automatisch ein Backup erstellt.`)) return;
  try {
    const data = await api('/api/admin/materials/delete-empty', { method: 'POST', body: JSON.stringify({}) });
    showToast('Leere Materialien gelöscht', `${data.deletedMaterials || 0} Position(en) gelöscht. Backup: ${data.backup && data.backup.file ? data.backup.file : 'erstellt'}`);
    await loadState(true);
    currentPage = 'adminMaterials';
    renderCurrentPage();
  } catch (error) { showToast('Fehler', error.message); }
};

window.deleteAllMaterialsSystem = async () => {
  if (!state.permissions.canManageSystem) return showToast('Keine Berechtigung', 'Nur der Systemzugang darf die Materialdatenbank leeren.');
  const activeCount = (state.materials || []).length;
  const archivedCount = (state.archivedMaterials || []).length;
  if (!activeCount && !archivedCount) return showToast('Keine Materialien', 'Die Materialdatenbank ist bereits leer.');
  if (!confirm(`Alle Materialien wirklich löschen?

Aktive Materialien: ${activeCount}
Archivierte Materialien: ${archivedCount}

Vorher wird automatisch ein Backup erstellt.`)) return;
  const confirmText = prompt(`Zum Bestätigen bitte eingeben:\n\nMATERIALIEN LÖSCHEN`);
  if (!isDeleteConfirmTextValid(confirmText)) return showToast('Abgebrochen', 'Bestätigung war nicht korrekt. Es wurde nichts gelöscht.');
  try {
    const data = await api('/api/admin/materials/delete-all', { method: 'POST', body: JSON.stringify({ confirmText }) });
    materialFilter = { text: '', status: 'all', shelf: 'all', format: 'all', storage: 'all', sort: 'none' };
    state.materials = [];
    state.archivedMaterials = [];
    state.orders = [];
    state.inventories = [];
    showToast('Materialdatenbank geleert', `Version ${data.version || state.version || '-'} · ${data.deletedMaterials} Materialposition(en), ${data.deletedOrders || 0} Bestellung(en), ${data.deletedInventories || 0} Inventurdatensätze und ${data.removedMaterialActivities || 0} alte Material-Historien gelöscht. Backup: ${data.backup && data.backup.file ? data.backup.file : 'erstellt'}`);
    await loadState(true);
    const restActive = (state.materials || []).length;
    const restArchived = (state.archivedMaterials || []).length;
    if (restActive || restArchived) showToast('Prüfung', `Achtung: Es sind noch ${restActive + restArchived} Materialposition(en) sichtbar. Bitte alte App schließen oder Port 4170 freigeben.`);
    else showToast('Prüfung', 'Materialdatenbank ist jetzt leer.');
    materialFilter = { text: '', status: 'all', shelf: 'all', format: 'all', storage: 'all', sort: 'none' };
    orderFilter = { text: '', status: 'all' };
    inventoryHistoryFilter = { text: '', date: '' };
    currentPage = 'adminMaterials';
    renderCurrentPage();
  } catch (error) { showToast('Fehler', error.message); }
};

window.restoreMaterial = async (materialId) => {
  const material = (state.archivedMaterials || []).find(m => m.id === materialId);
  if (!material) return;
  if (!confirm(`Material wiederherstellen?\n\n${materialTitle(material)}`)) return;
  try {
    await api(`/api/materials/${materialId}/restore`, { method: 'POST' });
    showToast('Material wiederhergestellt', materialTitle(material));
    await loadState(true);
    currentPage = 'adminArchive';
    renderCurrentPage();
  } catch (error) { showToast('Fehler', error.message); }
};

window.openChangePasswordModal = (force = false) => {
  openModal(`
    <h2>Passwort ändern</h2>
    <p class="muted">${force ? 'Der Systemzugang hat festgelegt, dass du dein Passwort ändern sollst.' : 'Neues Passwort speichern.'}</p>
    <form id="changePasswordForm" class="form-grid">
      <div class="form-full"><label>Altes Passwort</label><input id="oldPassword" type="password" required></div>
      <div><label>Neues Passwort</label><input id="newPassword" type="password" required minlength="4"></div>
      <div><label>Neues Passwort wiederholen</label><input id="newPasswordRepeat" type="password" required minlength="4"></div>
      <div class="modal-footer form-full">${force ? '' : '<button type="button" class="ghost" onclick="closeModal()">Abbrechen</button>'}<button class="primary" type="submit">Passwort speichern</button></div>
    </form>
  `);
  $('#changePasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('#newPassword').value !== $('#newPasswordRepeat').value) return showToast('Fehler', 'Die neuen Passwörter stimmen nicht überein.');
    try {
      const data = await api('/api/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: $('#oldPassword').value, newPassword: $('#newPassword').value }) });
      currentUser = data.user;
      closeModal();
      showToast('Passwort geändert', 'Das neue Passwort wurde gespeichert.');
      await loadState(true);
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.closeModal = closeModal;

function connectSocket() {
  if (!token) return;
  if (socket) socket.disconnect();
  socket = io({ auth: { token } });
  socket.on('connected', () => setConnection(true, 'Verbunden'));
  socket.on('connect_error', () => setConnection(false, 'Keine Verbindung'));
  socket.on('disconnect', () => setConnection(false, 'Getrennt'));
  socket.on('state:changed', () => safeLiveRefresh());
  const handle = (payload) => {
    if (!currentUser) return;
    if (payload.targetRoles && !payload.targetRoles.includes(currentUser.role)) return;
    showToast('Live-Meldung', payload.message || 'Neue Änderung');
    safeLiveRefresh();
  };
  socket.on('order:new', handle);
  socket.on('order:updated', handle);
  socket.on('material:created', handle);
  socket.on('material:updated', handle);
  socket.on('material:deleted', handle);
  socket.on('material:restored', handle);
  socket.on('material:changed', handle);
  socket.on('stock:low', handle);
  socket.on('users:changed', handle);
  socket.on('inventory:changed', handle);
}

function logoutLocal() {
  token = null;
  currentUser = null;
  state = null;
  localStorage.removeItem('eckl_token');
  if (socket) socket.disconnect();
  $('#app').classList.add('hidden');
  $('#loginScreen').classList.remove('hidden');
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#loginError').textContent = '';
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) });
    token = data.token;
    localStorage.setItem('eckl_token', token);
    currentUser = data.user;
    state = data.state;
    renderApp();
    connectSocket();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    showToast('Angemeldet', `Willkommen, ${currentUser.name}`);
  } catch (error) {
    $('#loginError').textContent = error.message;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try { if (token) await api('/api/logout', { method: 'POST' }); } catch (_) {}
  logoutLocal();
});

$('#refreshBtn').addEventListener('click', () => loadState());

(async function boot() {
  if (token) {
    try {
      await loadState(true);
      connectSocket();
    } catch (_) { logoutLocal(); }
  }
})();
