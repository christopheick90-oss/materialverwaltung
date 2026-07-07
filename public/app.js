const CLIENT_VERSION = '0.7.2';
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
let orderFilter = { text: '', status: 'all' };
let inventoryHistoryFilter = { text: '', date: '' };
let lastTypingAt = 0;

const roleNames = { LASER: 'Laser', BUERO: 'Büro', CHEF: 'Chef', ADMIN: 'Admin' };
const statusNames = { ANGEFORDERT: 'Angefordert', FREIGEGEBEN: 'Freigegeben', BESTELLT: 'Bestellt', TEILGELIEFERT: 'Bestellt', ABGELEHNT: 'Abgelehnt', ERLEDIGT: 'Geliefert' };
const storageNames = { HAUPTLAGER: 'Hauptlager', KONSI: 'Konsi-Lager' };
const defaultShelves = ['Regal 1', 'Regal 2', 'Regal 3', 'Regal 4', 'Regal 5', 'Regal 6', 'Carport', 'Bodenhaltung'];
const defaultKonsiLocation = 'Garage';
const inventoryRequiredAreas = [...defaultShelves, 'KONSI'];
const materialFormats = ['4000x2000', '3000x1500', '2500x1250', '2000x1000'];

const pages = [
  { id: 'dashboard', label: 'Dashboard', roles: ['LASER','BUERO','CHEF','ADMIN'] },
  { id: 'materials', label: 'Material', roles: ['LASER','BUERO','CHEF','ADMIN'] },
  { id: 'konsi', label: 'Konsi-Lager', roles: ['LASER','BUERO','CHEF','ADMIN'] },
  { id: 'inventory', label: 'Inventur', roles: ['LASER','BUERO','CHEF'] },
  { id: 'orders', label: 'Bestellungen', roles: ['LASER','BUERO','CHEF'] },
  { id: 'history', label: 'Historie', roles: ['LASER','BUERO','CHEF','ADMIN'] },
  { id: 'admin', label: 'Admin', roles: ['ADMIN'] },
  { id: 'admin', label: 'Chef-Übersicht', roles: ['CHEF'] },
  { id: 'adminMaterials', label: 'Materialien', roles: ['ADMIN'] },
  { id: 'users', label: 'Benutzer', roles: ['ADMIN'] },
  { id: 'adminSettings', label: 'Einstellungen', roles: ['ADMIN'] },
  { id: 'adminBackup', label: 'Backup', roles: ['ADMIN'] },
  { id: 'adminImportExport', label: 'Import/Export', roles: ['ADMIN'] },
  { id: 'adminArchive', label: 'Archiv', roles: ['ADMIN'] },
  { id: 'adminLog', label: 'Systemprotokoll', roles: ['ADMIN'] }
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
  return Array.from(new Set(String(value || '')
    .split(/[\n,;]+/)
    .map(v => v.trim())
    .filter(Boolean)));
}

function normalizeThicknessInput(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/mm$/i.test(text)) return text.replace(/\s*mm$/i, ' mm');
  if (/^[0-9]+([,.][0-9]+)?$/.test(text)) return `${text} mm`;
  return text;
}

function normalizeFormatValue(value) {
  const text = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  const match = text.match(/(4000|3000|2500|2000)[x×](2000|1500|1250|1000)/);
  return match ? `${match[1]}x${match[2]}` : '3000x1500';
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

function densityFactorForMaterial(material) {
  const text = `${material?.name || ''} ${material?.category || ''} ${material?.type || ''}`.toLowerCase();
  if (text.includes('alu') || text.includes('aluminium')) return 2.7;
  if (text.includes('edelstahl') || text.includes('v2a') || text.includes('v4a') || /va/.test(text)) return 8.0;
  if (text.includes('kupfer')) return 8.96;
  if (text.includes('messing')) return 8.5;
  return 7.85;
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
  return `ca. ${oneSheet.toFixed(1).replace('.', ',')} kg pro Tafel · Dichte wird aus dem Materialnamen geschätzt`;
}

function formatOptions(selected = '') {
  const active = normalizeFormatValue(selected);
  return materialFormats.map(format => `<option value="${escapeHtml(format)}" ${format === active ? 'selected' : ''}>${escapeHtml(format)}</option>`).join('');
}

function statusBadge(status) {
  const map = { ANGEFORDERT:'red', FREIGEGEBEN:'amber', BESTELLT:'green', TEILGELIEFERT:'green', ABGELEHNT:'gray', ERLEDIGT:'green' };
  return `<span class="badge ${map[status] || 'gray'}">${statusNames[status] || status}</span>`;
}

function materialStatus(material) {
  if (material.deliveryPending) return { key: 'delivered', label: 'Geliefert', cls: 'green' };
  if (material.rest) return { key: 'rest', label: 'Resttafel', cls: 'gray' };
  if (Number(material.stock) <= 0) return { key: 'empty', label: 'Leer', cls: 'red' };
  if (Number(material.stock) <= Number(material.minStock)) return { key: 'low', label: 'Warnung', cls: 'amber' };
  return { key: 'ok', label: 'OK', cls: 'green' };
}

function materialStatusBadge(material) {
  const s = materialStatus(material);
  return `<span class="badge ${s.cls}">${s.label}</span>`;
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
  if (material?.deliveryPending && deliveredPackages > 0 && sheets > 0) return `${deliveredPackages} Pakete = ca. ${sheets} Tafeln`;
  if (packages > 0) return `${packages} Pakete${sheets ? ` + ${sheets} Tafeln` : ''}`;
  return `${sheets} ${escapeHtml(material.unit || 'Tafeln')}`;
}

function orderQuantityLabel(order, type = 'request') {
  const amount = type === 'ordered' ? order.orderedAmount : (type === 'received' ? order.receivedAmount : order.requestedAmount);
  const sheets = type === 'ordered' ? order.orderedSheets : (type === 'received' ? order.receivedSheets : order.requestedSheets);
  if (order.storage === 'KONSI') return `${amount || 0} Pakete`;
  if (type === 'received' && Number(amount) > 0 && Number(sheets) > 0) return `${amount || 0} Pakete = ca. ${Number(sheets)} Tafeln`;
  return `${amount || 0} Pakete${Number(sheets) ? ` + ${Number(sheets)} Tafeln` : ''}`;
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
  $('#roleBadge').textContent = roleNames[currentUser.role] || currentUser.role;
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
  $('#nav').innerHTML = pages
    .filter(p => p.roles.includes(currentUser.role))
    .map(p => {
      const count = p.id === 'orders'
        ? (currentUser.role === 'LASER' ? myOpen : pendingForOffice)
        : (p.id === 'materials' ? warnings
          : (p.id === 'konsi' ? state.materials.filter(m => m.storage === 'KONSI').length
          : (p.id === 'adminMaterials' ? state.materials.length
          : (p.id === 'users' ? (state.users || []).filter(u => u.active !== false).length
          : (p.id === 'adminArchive' ? (state.archivedMaterials || []).length
          : (p.id === 'adminBackup' ? (state.backups || []).length : 0))))));
      return `<button data-page="${p.id}" class="${currentPage === p.id ? 'active' : ''}">${p.label}${count ? `<span class="count">${count}</span>` : ''}</button>`;
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
  const page = pages.find(p => p.id === currentPage);
  $('#pageTitle').textContent = page ? page.label : 'Dashboard';
  $('#pageSubtitle').textContent = subtitleForPage(currentPage);
  if (currentPage === 'dashboard') renderDashboard();
  if (currentPage === 'materials') renderMaterials();
  if (currentPage === 'konsi') renderKonsi();
  if (currentPage === 'inventory') renderInventory();
  if (currentPage === 'orders') renderOrders();
  if (currentPage === 'history') renderHistory();
  if (currentPage === 'admin') renderAdmin();
  if (currentPage === 'adminMaterials') renderAdminMaterials();
  if (currentPage === 'users') renderUsers();
  if (currentPage === 'adminSettings') renderAdminSettings();
  if (currentPage === 'adminBackup') renderAdminBackup();
  if (currentPage === 'adminImportExport') renderAdminImportExport();
  if (currentPage === 'adminArchive') renderAdminArchive();
  if (currentPage === 'adminLog') renderAdminLog();
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
    history: 'Letzte Aktivitäten aller Arbeitsplätze',
    admin: currentUser.role === 'ADMIN' ? 'Admin-Übersicht ohne Bestellungen und Inventur' : 'Gesamtübersicht für Chef',
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


function renderAdminDashboard() {
  const users = state.users || [];
  const active = users.filter(u => u.active !== false).length;
  const inactive = users.length - active;
  const status = state.systemStatus || {};
  const archived = (state.archivedMaterials || []).length;
  const target = currentPage === 'admin' ? '#admin' : '#dashboard';
  $(target).innerHTML = `
    <div class="dashboard-compact">
      <div class="grid dashboard-stats">
        <div class="stat"><span>Aktive Benutzer</span><strong>${active}</strong></div>
        <div class="stat"><span>Deaktiviert</span><strong>${inactive}</strong></div>
        <div class="stat"><span>Materialien</span><strong>${state.materials.length}</strong></div>
        <div class="stat"><span>Archiv</span><strong>${archived}</strong></div>
        <div class="stat"><span>Backups</span><strong>${(state.backups || []).length}</strong></div>
      </div>
      <div class="admin-tile-grid">
        <button class="admin-tile" onclick="goPage('users')"><strong>Benutzer</strong><span>Zugänge, Rollen, Passwörter</span></button>
        <button class="admin-tile" onclick="goPage('adminMaterials')"><strong>Materialien</strong><span>Mehrfachanlage und Stammdaten</span></button>
        <button class="admin-tile" onclick="goPage('adminSettings')"><strong>Einstellungen</strong><span>Regale, Größen, Stärken, Rechte</span></button>
        <button class="admin-tile" onclick="goPage('adminBackup')"><strong>Backup</strong><span>Sichern und wiederherstellen</span></button>
        <button class="admin-tile" onclick="goPage('adminImportExport')"><strong>Import/Export</strong><span>CSV Materiallisten</span></button>
        <button class="admin-tile" onclick="goPage('adminArchive')"><strong>Archiv</strong><span>Material wieder aktivieren</span></button>
        <button class="admin-tile" onclick="goPage('adminLog')"><strong>Systemprotokoll</strong><span>Änderungen und Logins</span></button>
        <button class="admin-tile" onclick="goPage('materials')"><strong>Material</strong><span>Bestand prüfen und korrigieren</span></button>
      </div>
      ${renderInventoryTimerCard(true)}
      <div class="split">
        <div class="card compact-activity-card"><h2>Systemstatus</h2>${renderSystemStatus(status)}</div>
        <div class="card compact-activity-card"><h2>Letzte Aktivitäten</h2>${renderActivityList(state.activities.slice(0, 6))}</div>
      </div>
    </div>
  `;
}

function roleOptions(selected = 'LASER') {
  const roles = ['LASER','BUERO','CHEF','ADMIN'];
  return roles.map(role => `<option value="${role}" ${role === selected ? 'selected' : ''}>${escapeHtml(roleNames[role] || role)}</option>`).join('');
}

function renderDashboard() {
  if (currentUser.role === 'ADMIN') return renderAdminDashboard();
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
          ${lowPreview.length ? `<div class="quick-list compact-warnings">${lowPreview.map(m => `<div class="quick-item warning-mini"><strong>${escapeHtml(materialTitle(m))}</strong><small>${quantityLabel(m)} · ${escapeHtml(materialLocationLabel(m))}</small>${state.permissions.canRequestOrder ? `<button class="ghost mini" onclick="openOrderModal('${jsString(m.id)}')">Bestellung</button>` : ''}</div>`).join('')}</div>${low.length > 5 ? `<div class="footer-note">${low.length - 5} weitere Warnung(en) in Material anzeigen.</div>` : ''}` : '<div class="empty">Keine kritischen Materialien.</div>'}
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
  const text = String(materialFilter.text || '').toLowerCase();
  const materials = state.materials
    .filter(m => !m.archived)
    .filter(m => `${m.name} ${m.thickness} ${m.format || ''} ${quantityLabel(m)} ${m.stock} ${m.sheetStock || 0} ${m.shelf} ${m.storage} ${storageLabel(m)} ${materialStatus(m).label}`.toLowerCase().includes(text))
    .filter(m => {
      if (materialFilter.storage !== 'all' && (m.storage || 'HAUPTLAGER') !== materialFilter.storage) return false;
      if (materialFilter.shelf !== 'all' && String(m.shelf || '') !== materialFilter.shelf) return false;
      if (materialFilter.format !== 'all' && normalizeFormatValue(m.format || '') !== materialFilter.format) return false;
      if (materialFilter.status === 'all') return true;
      if (materialFilter.status === 'rest') return !!m.rest;
      if (materialFilter.status === 'low') return !m.rest && !m.deliveryPending && Number(m.stock) <= Number(m.minStock);
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
  const fill = m.rest ? 100 : Math.max(0, Math.min(100, Math.round((Number(m.stock) / Math.max(Number(m.minStock) || 1, 1)) * 100)));
  return `
    <div class="material-card ${m.deliveryPending ? 'delivered' : (m.rest ? 'rest' : (m.storage === 'KONSI' ? 'konsi' : (status.key === 'low' || status.key === 'empty' ? 'low' : '')))}">
      <div class="material-head"><h3>${escapeHtml(materialTitle(m))}</h3>${materialStatusBadge(m)}</div>
      <div class="meta compact-material">
        <div><span>Menge</span><strong>${quantityLabel(m)}</strong></div>
        <div><span>Lagerplatz</span><strong>${escapeHtml(materialLocationLabel(m))}</strong></div>
      </div>
      <div class="stock-fill"><span style="width:${fill}%"></span></div>
      <div class="actions">
        <button class="ghost mini" onclick="openStockModal('${jsString(m.id)}','REMOVE')">Entnahme</button>
        <button class="ghost mini" onclick="openMaterialHistoryModal('${jsString(m.id)}')">Historie</button>
        ${canMoveMaterial(m) ? `<button class="secondary mini" onclick="openMoveMaterialModal('${jsString(m.id)}')">Verräumen</button>` : ''}
        ${state.permissions.canAdjustStock && !isKonsi(m) ? `<button class="secondary mini" onclick="openStockModal('${jsString(m.id)}','SET')">Bestand buchen</button>` : ''}
        ${!m.rest && state.permissions.canRequestOrder ? `<button class="primary mini" onclick="openOrderModal('${jsString(m.id)}')">Bestellung</button>` : (m.rest ? `<span class="badge gray">Resttafel</span>` : '')}
        ${state.permissions.canEditMaterial ? `<button class="ghost mini" onclick="openMaterialModal('${jsString(m.id)}')">Bearbeiten</button>` : ''}
        ${state.permissions.canDeleteMaterial ? `<button class="secondary danger mini" onclick="archiveMaterial('${jsString(m.id)}')">Archivieren</button>` : ''}
      </div>
    </div>
  `;
}

function renderDeliveredMaterials() {
  const container = $('#deliveredMaterials');
  if (!container) return;
  const delivered = (state.materials || []).filter(m => m.deliveryPending && !m.archived).slice(0, 8);
  if (!delivered.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="card delivered-panel">
      <div class="panel-head"><h2>Geliefert</h2><span class="badge green">Wareneingang</span></div>
      <div class="quick-list delivered-list">
        ${delivered.map(m => `<div class="quick-item delivered-mini"><strong>${escapeHtml(materialTitle(m))}</strong><small>${quantityLabel(m)} · ${escapeHtml(materialLocationLabel(m))}</small><div class="row-actions">${canMoveMaterial(m) ? `<button class="secondary mini" onclick="openMoveMaterialModal('${jsString(m.id)}')">Verräumen</button>` : ''}<button class="ghost mini" onclick="openStockModal('${jsString(m.id)}','REMOVE')">Entnahme</button><button class="ghost mini" onclick="openMaterialHistoryModal('${jsString(m.id)}')">Historie</button></div></div>`).join('')}
      </div>
      ${delivered.length >= 8 ? '<div class="footer-note">Weitere gelieferte Positionen sind unten in der Materialliste sichtbar.</div>' : ''}
    </div>`;
}

function drawMaterialCards() {
  const active = materialFilterIsActive();
  if (active) renderDeliveredMaterials();
  else {
    const deliveredContainer = $('#deliveredMaterials');
    if (deliveredContainer) deliveredContainer.innerHTML = '';
  }
  const materials = filteredMaterials();
  const count = $('#materialFilterCount');
  if (count) count.textContent = active ? `${materials.length} von ${(state.materials || []).filter(m => !m.archived).length} Positionen` : 'Bitte Filter oder Suche auswählen';
  $('#materialGrid').innerHTML = active
    ? (materials.map(materialCardHtml).join('') || '<div class="empty">Keine Materialien gefunden.</div>')
    : '<div class="empty">Bitte erst eine Suche oder einen Filter auswählen. Danach werden die passenden Materialien angezeigt.</div>';
}

function konsiMaterialsFiltered() {
  const text = String(materialFilter.text || '').toLowerCase();
  return state.materials
    .filter(m => m.storage === 'KONSI')
    .filter(m => `${m.name} ${m.thickness} ${m.format || ''} ${m.stock} ${m.sheetStock || 0} ${materialLocationLabel(m)}`.toLowerCase().includes(text));
}

function drawKonsiCards() {
  const grid = $('#konsiGrid');
  if (!grid) return;
  const konsiMaterials = konsiMaterialsFiltered();
  grid.innerHTML = konsiMaterials.map(materialCardHtml).join('') || '<div class="empty">Noch kein Material im Konsi-Lager.</div>';
}

function renderKonsi() {
  const canCreate = state.permissions.canCreateMaterial;
  $('#konsi').innerHTML = `
    <div class="searchbar"><strong>Konsi</strong><input id="konsiSearch" placeholder="Konsi-Material suchen ..." value="${escapeHtml(materialFilter.text)}"></div>
    <div class="toolbar">
      ${canCreate ? '<button class="primary" onclick="openMaterialModal(\'\', \'KONSI\')">Konsi-Material anlegen</button>' : ''}
      <button class="secondary" onclick="loadState()">Aktualisieren</button>
      <span class="badge gray">Konsi rechnet nur in Paketen</span><span class="badge red">Standort: Garage</span>
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
      <thead><tr><th>Material</th><th>Größe</th><th>Soll</th><th>Gezählt</th><th>Differenz</th><th>Bemerkung</th></tr></thead>
      <tbody>${session.items.map(item => `
        <tr data-item-id="${escapeHtml(item.id)}">
          <td><strong>${escapeHtml(item.title || item.materialName)}</strong>${item.extraMaterial ? '<div><span class="badge green">Zusatzmaterial</span></div>' : ''}<div class="small muted">${escapeHtml(item.shelf || session.area)}</div></td>
          <td>${escapeHtml(item.format || '-')}</td>
          <td><strong>${Number(item.expectedPackages) || 0} Pakete</strong><br><strong>${Number(item.expectedSheets) || 0} Tafeln</strong></td>
          <td><div class="inventory-count-grid"><label>Pakete<input class="inv-packages" type="number" min="0" step="1" value="${item.countedPackages ?? ''}" placeholder="0"></label><label>Tafeln<input class="inv-sheets" type="number" min="0" step="1" value="${item.countedSheets ?? ''}" placeholder="0"></label></div></td>
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
      <thead><tr><th>Paketnummer</th><th>Material</th><th>Status</th><th>Bemerkung</th></tr></thead>
      <tbody>${session.items.map(item => `
        <tr data-item-id="${escapeHtml(item.id)}">
          <td><strong>${escapeHtml(item.packageNumber || '-')}</strong></td>
          <td>${escapeHtml(item.title || item.materialName)}<div class="small muted">${escapeHtml(item.shelf || '-')}</div></td>
          <td><select class="inv-present"><option value="" ${item.present === null || item.present === undefined ? 'selected' : ''}>Noch offen</option><option value="true" ${item.present === true ? 'selected' : ''}>Vorhanden</option><option value="false" ${item.present === false ? 'selected' : ''}>Fehlt</option></select></td>
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
    card.querySelectorAll('.inv-packages, .inv-sheets, .inv-present').forEach(input => {
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
      return { id, present: value === '' ? null : value === 'true', note: row.querySelector('.inv-note').value };
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
      <label class="checkline form-full"><input id="extraInvRest" type="checkbox"> <span>Resttafel / Restmaterial</span></label>
      <div class="form-full"><label>Bemerkung</label><input id="extraInvNote" placeholder="optional"></div>
      <div class="notice form-full">Wichtig: Diese Position wird im Fortschritt mitgezählt. Beim Abschließen wird daraus automatisch eine Materialposition in ${escapeHtml(session.area)}.</div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Hinzufügen</button></div>
    </form>
  `);
  $('#inventoryExtraItemForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api(`/api/inventories/${sessionId}/items`, { method: 'POST', body: JSON.stringify({
        name: $('#extraInvName').value,
        thickness: normalizeThicknessInput($('#extraInvThickness').value),
        format: $('#extraInvFormat').value,
        countedPackages: Number($('#extraInvPackages').value || 0),
        countedSheets: Number($('#extraInvSheets').value || 0),
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

function orderSearchText(order) {
  return [
    order.materialName, order.note, order.requestedBy, order.requestedByRole,
    order.deliveredToShelf, order.status, statusNames[order.status],
    order.createdAt ? fmtDate(order.createdAt) : '',
    order.lastUpdate ? fmtDate(order.lastUpdate) : '',
    order.orderedAt ? fmtDate(order.orderedAt) : '',
    order.receivedAt ? fmtDate(order.receivedAt) : '',
    order.id
  ].join(' ').toLowerCase();
}

function filteredOrdersList(baseOrders) {
  const text = String(orderFilter.text || '').toLowerCase();
  return baseOrders
    .filter(o => !text || orderSearchText(o).includes(text))
    .filter(o => {
      if (orderFilter.status === 'all') return true;
      if (orderFilter.status === 'open') return ['ANGEFORDERT','BESTELLT','TEILGELIEFERT'].includes(o.status);
      if (orderFilter.status === 'requested') return o.status === 'ANGEFORDERT';
      if (orderFilter.status === 'ordered') return o.status === 'BESTELLT' || o.status === 'TEILGELIEFERT';
      if (orderFilter.status === 'delivered') return o.status === 'ERLEDIGT';
      if (orderFilter.status === 'rejected') return o.status === 'ABGELEHNT';
      return true;
    })
    .sort((a, b) => new Date(b.lastUpdate || b.createdAt || 0) - new Date(a.lastUpdate || a.createdAt || 0));
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
  return currentUser.role === 'LASER'
    ? state.orders.filter(o => o.requestedByRole === 'LASER' || o.requestedBy === currentUser.name)
    : state.orders;
}

function drawOrdersList() {
  const incoming = currentOrderBaseList();
  const filtered = filteredOrdersList(incoming);
  const count = $('#orderFilterCount');
  if (count) count.textContent = `${filtered.length} von ${incoming.length} Vorgängen`;
  const box = $('#ordersResult');
  if (box) box.innerHTML = filtered.length ? renderOrdersTable(filtered, true) : '<div class="empty">Keine Bestellung oder Lieferung gefunden.</div>';
}

function renderOrders() {
  const incoming = currentOrderBaseList();
  const filtered = filteredOrdersList(incoming);
  $('#orders').innerHTML = `
    <div class="toolbar">
      <button class="primary" onclick="openOrderModal()">Neue Bestellanforderung</button>
      <button class="secondary" onclick="loadState()">Aktualisieren</button>
    </div>
    ${orderFilterPanel(incoming, filtered)}
    <div class="card">
      <h2>${currentUser.role === 'LASER' ? 'Bestellstatus vom Laser' : 'Bestellungen & Lieferungen suchen'}</h2>
      <div id="ordersResult">${filtered.length ? renderOrdersTable(filtered, true) : '<div class="empty">Keine Bestellung oder Lieferung gefunden.</div>'}</div>
    </div>
  `;
  $('#orderSearch').addEventListener('input', (event) => {
    orderFilter.text = event.target.value;
    drawOrdersList();
  });
}

function renderOrdersTable(orders, withActions) {
  return `
    <table>
      <thead><tr><th>Status</th><th>Material</th><th>Menge</th><th>Info</th><th>Verlauf</th>${withActions ? '<th>Aktion</th>' : ''}</tr></thead>
      <tbody>
        ${orders.map(o => `
          <tr>
            <td>${statusBadge(o.status)}</td>
            <td><strong>${escapeHtml(o.materialName)}</strong><div class="small muted">Angefragt von ${escapeHtml(o.requestedBy)} · ${fmtDate(o.createdAt)}</div></td>
            <td>Anfrage: <strong>${orderQuantityLabel(o, 'request')}</strong>${o.orderedAmount ? `<br>Bestellt: <strong>${orderQuantityLabel(o, 'ordered')}</strong>` : ''}${(Number(o.receivedAmount)||Number(o.receivedSheets)) ? `<br>Geliefert: <strong>${orderQuantityLabel(o, 'received')}</strong>${o.deliveredToShelf ? `<br><span class="small muted">Ablage: ${escapeHtml(o.deliveredToShelf)}</span>` : ''}` : ''}</td>
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
  if (state.permissions.canMarkOrdered && order.status === 'ANGEFORDERT') {
    actions.push(`<button class="primary mini" onclick="openOrderedModal('${jsString(order.id)}')">Bestellt</button>`);
    actions.push(`<button class="secondary danger mini" onclick="updateOrder('${jsString(order.id)}','REJECT')">Ablehnen</button>`);
  }
  if (state.permissions.canMarkOrdered && order.status === 'FREIGEGEBEN') actions.push(`<button class="primary mini" onclick="openOrderedModal('${jsString(order.id)}')">Bestellt</button>`);
  if (state.permissions.canReceiveDelivery && (order.status === 'BESTELLT' || order.status === 'TEILGELIEFERT')) actions.push(`<button class="primary mini" onclick="openReceiveModal('${jsString(order.id)}')">Lieferung annehmen</button>`);
  return `<div class="row-actions">${actions.join('') || '<span class="small muted">Keine Aktion</span>'}</div>`;
}

function renderHistory() {
  $('#history').innerHTML = `<div class="card"><h2>Historie</h2>${renderActivityList(state.activities)}</div>`;
}

function renderActivityList(items) {
  if (!items.length) return '<div class="empty">Keine Aktivitäten vorhanden.</div>';
  return `<table><thead><tr><th>Zeit</th><th>Typ</th><th>Meldung</th><th>Benutzer</th></tr></thead><tbody>${items.map(a => `
    <tr><td>${fmtDate(a.at)}</td><td><span class="badge gray">${escapeHtml(a.type)}</span></td><td>${escapeHtml(a.text)}</td><td>${escapeHtml(a.user || '-')}</td></tr>
  `).join('')}</tbody></table>`;
}



function adminBulkMaterialRowHtml(index) {
  return `
    <tr class="bulk-material-row" data-index="${index}">
      <td><input class="bulk-name" placeholder="z. B. Aluminium"></td>
      <td><input class="bulk-thickness" placeholder="2"></td>
      <td><select class="bulk-format">${formatOptions('3000x1500')}</select></td>
      <td><select class="bulk-shelf">${shelfOptions('Regal 1')}</select></td>
      <td><input class="bulk-sheets" type="number" min="0" step="1" placeholder="0"></td>
      <td><input class="bulk-min" type="number" min="0" step="1" value="1"></td>
      <td class="center"><input class="bulk-rest" type="checkbox" title="Resttafel"></td>
    </tr>
  `;
}

function renderAdminMaterials() {
  const existingCount = (state.materials || []).length;
  const archivedCount = (state.archivedMaterials || []).length;
  const emptyCount = [...(state.materials || []), ...(state.archivedMaterials || [])].filter(isEmptyMaterialClient).length;
  $('#adminMaterials').innerHTML = `
    <div class="toolbar">
      <button class="primary" onclick="addBulkMaterialRows(5)">5 Zeilen hinzufügen</button>
      <button class="secondary" onclick="submitBulkMaterials()">Materialien anlegen</button>
      <button class="ghost" onclick="clearBulkMaterialRows()">Leeren</button>
      <span class="badge gray">Nur Admin</span>
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
      <div class="footer-note">Aktuell angelegte Materialien: ${existingCount}. Normale Materialien werden im Hauptlager angelegt. Konsi-Pakete bleiben weiter über Konsi-Material anlegen.</div>
    </div>
    <div class="card danger-zone-card">
      <h2>Materialdatenbank leeren</h2>
      <p class="muted">Nur für den Aufbau der echten Datenbank: löscht alle aktiven und archivierten Materialien. Benutzer, Einstellungen und Backups bleiben erhalten. Vor dem Löschen wird automatisch eine Sicherung erstellt.</p>
      <div class="quick-list compact-system-list">
        <div class="quick-item">Aktive Materialien<small>${existingCount}</small></div>
        <div class="quick-item">Archivierte Materialien<small>${archivedCount}</small></div>
        <div class="quick-item">Leere Materialien<small>${emptyCount}</small></div>
      </div>
      <div class="toolbar"><button class="secondary" onclick="deleteEmptyMaterialsAdmin()">Leere Materialien löschen</button><button class="secondary" onclick="deleteAllMaterialsAdmin()">Alle Materialien löschen</button><span class="badge gray">Backup davor</span></div>
    </div>
  `;
  const body = $('#bulkMaterialBody');
  body.innerHTML = Array.from({ length: 8 }, (_, i) => adminBulkMaterialRowHtml(i)).join('');
  bindBulkMaterialRows();
}

function bindBulkMaterialRows() {
  $$('.bulk-thickness').forEach(input => {
    input.addEventListener('blur', () => { input.value = normalizeThicknessInput(input.value); });
  });
  $$('.bulk-rest').forEach(input => {
    input.addEventListener('change', () => {
      const row = input.closest('tr');
      if (input.checked) row.querySelector('.bulk-min').value = 0;
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
  renderAdminMaterials();
};

function collectBulkMaterials() {
  return $$('.bulk-material-row').map((row, idx) => {
    const name = row.querySelector('.bulk-name').value.trim();
    const thickness = normalizeThicknessInput(row.querySelector('.bulk-thickness').value);
    const format = row.querySelector('.bulk-format').value;
    const shelf = row.querySelector('.bulk-shelf').value;
    const sheets = Number(row.querySelector('.bulk-sheets').value || 0);
    const rest = row.querySelector('.bulk-rest').checked;
    const minStock = rest ? 0 : Number(row.querySelector('.bulk-min').value || 0);
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
    <div class="toolbar">
      <button class="primary" onclick="openUserModal()">Benutzer anlegen</button>
      <button class="secondary" onclick="loadState()">Aktualisieren</button>
      <span class="badge gray">Nur Admin</span>
    </div>
    <div class="card">
      <h2>Benutzerverwaltung</h2>
      <p class="muted">Hier werden die Zugänge für Laser, Büro, Chef und Admin angelegt. Deaktivierte Benutzer können sich nicht mehr anmelden.</p>
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

function renderAdmin() {
  if (currentUser.role === 'ADMIN') return renderAdminDashboard();
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

function renderAdminSettings() {
  const settings = state.settings || {};
  const status = state.systemStatus || {};
  $('#adminSettings').innerHTML = `
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
      showToast('Einstellungen gespeichert', 'Admin-Einstellungen wurden aktualisiert.');
      await loadState(true);
    } catch (error) { showToast('Fehler', error.message); }
  });
}

function renderRoleRights() {
  const rows = [
    ['Laser', 'Material sehen, Entnahme buchen, Inventur zählen, Bestellung angeben'],
    ['Büro', 'Material pflegen, Bestand buchen, Bestellungen bearbeiten, Inventur prüfen/abschließen'],
    ['Chef', 'Gesamtübersicht, Material archivieren, Bestellungen und Inventur abschließen'],
    ['Admin', 'Benutzer, Einstellungen, Backup, Import/Export, Archiv, Materialpflege ohne Bestellungen/Inventuren']
  ];
  return `<table><thead><tr><th>Rolle</th><th>Darf</th></tr></thead><tbody>${rows.map(r => `<tr><td><strong>${r[0]}</strong></td><td>${escapeHtml(r[1])}</td></tr>`).join('')}</tbody></table>`;
}

function renderAdminBackup() {
  const backups = state.backups || [];
  $('#adminBackup').innerHTML = `
    <div class="toolbar"><button class="primary" onclick="createBackupNow()">Backup erstellen</button><button class="secondary" onclick="loadState()">Aktualisieren</button><span class="badge gray">Nur Admin</span></div>
    <div class="card"><h2>Datensicherungen</h2><p class="muted">Vor Wiederherstellung wird automatisch nochmal eine Sicherung erstellt.</p>${renderBackupTable(backups)}</div>
  `;
}

function renderBackupTable(backups) {
  if (!backups.length) return '<div class="empty">Noch kein Backup vorhanden.</div>';
  return `<table><thead><tr><th>Backup</th><th>Datum</th><th>Größe</th><th>Aktion</th></tr></thead><tbody>${backups.map(b => `<tr><td><code>${escapeHtml(b.file)}</code></td><td>${fmtDate(b.createdAt)}</td><td>${Math.round((Number(b.size)||0)/1024)} KB</td><td><div class="row-actions"><button class="ghost mini" onclick="downloadBackup('${jsString(b.file)}')">Download</button><button class="secondary danger mini" onclick="restoreBackup('${jsString(b.file)}')">Wiederherstellen</button></div></td></tr>`).join('')}</tbody></table>`;
}

function renderAdminImportExport() {
  $('#adminImportExport').innerHTML = `
    <div class="split">
      <div class="card"><h2>Materialliste exportieren</h2><p class="muted">Exportiert alle aktiven und archivierten Materialien als CSV.</p><button class="primary" onclick="exportMaterialsCsv()">CSV exportieren</button></div>
      <div class="card"><h2>CSV / Google Sheets importieren</h2><p class="muted">Büro-Format: Regal; Material; t=; Format; Menge; Abmass X; Abmass Y. Wird automatisch in die Material-Anordnung übernommen. Google-Sheets-Kopien mit Tabulatoren werden erkannt.</p><textarea id="importCsv" placeholder="CSV oder aus Google Sheets kopierte Tabelle hier einfügen"></textarea><div class="modal-footer"><button class="primary" onclick="importMaterialsCsv()">Materialien importieren</button></div></div>
    </div>
    <div class="card"><h2>CSV Vorlage</h2><pre class="code-block">Material;Stärke;Größe;Regal;Tafeln;Pakete;Mindestbestand;Bereich;Resttafel;Paketnummern
Aluminium;2;3000x1500;Regal 1;12;0;5;HAUPTLAGER;nein;
Konsi Alu;2;3000x1500;Regal 6;0;2;1;KONSI;nein;KONSI-001,KONSI-002</pre></div>
  `;
}

function renderAdminArchive() {
  const archived = state.archivedMaterials || [];
  $('#adminArchive').innerHTML = `
    <div class="toolbar"><button class="secondary" onclick="loadState()">Aktualisieren</button><span class="badge gray">Archivierte Materialien: ${archived.length}</span></div>
    <div class="card"><h2>Material-Archiv</h2>${archived.length ? renderArchiveTable(archived) : '<div class="empty">Keine archivierten Materialien vorhanden.</div>'}</div>
  `;
}

function renderArchiveTable(items) {
  return `<table><thead><tr><th>Material</th><th>Menge</th><th>Regal</th><th>Aktualisiert</th><th>Aktion</th></tr></thead><tbody>${items.map(m => `<tr><td><strong>${escapeHtml(materialTitle(m))}</strong><br><small>${escapeHtml(m.format || '')}</small></td><td>${quantityLabel(m)}</td><td>${escapeHtml(m.shelf || '-')}</td><td>${fmtDate(m.updatedAt)}</td><td><button class="secondary mini" onclick="restoreMaterial('${jsString(m.id)}')">Wiederherstellen</button></td></tr>`).join('')}</tbody></table>`;
}

function renderAdminLog() {
  $('#adminLog').innerHTML = `<div class="toolbar"><button class="secondary" onclick="loadState()">Aktualisieren</button><span class="badge gray">Letzte ${state.activities.length} Einträge</span></div><div class="card"><h2>Systemprotokoll</h2>${renderActivityList(state.activities)}</div>`;
}



window.openUserModal = (userId = '') => {
  if (!state.permissions.canManageUsers) return showToast('Keine Berechtigung', 'Nur Admin darf Benutzer verwalten.');
  const u = userId ? (state.users || []).find(x => x.id === userId) : null;
  const isEdit = Boolean(u);
  const data = u || { username: '', name: '', role: 'LASER', active: true };
  openModal(`
    <h2>${isEdit ? 'Benutzer bearbeiten' : 'Benutzer anlegen'}</h2>
    <p class="muted">Der Admin legt hier fest, mit welchem Benutzername, Passwort und welcher Rolle sich jemand anmelden darf.</p>
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

window.openMaterialModal = (materialId = '', presetStorage = '') => {
  if (!state.permissions.canCreateMaterial && !state.permissions.canEditMaterial) return showToast('Keine Berechtigung', 'Material darf nur von Büro oder Chef verwaltet werden.');
  const m = materialId ? state.materials.find(x => x.id === materialId) : null;
  const isEdit = Boolean(m);
  const data = m || { name:'', category:'', type:'Tafel', thickness:'', format:'', unit: presetStorage === 'KONSI' ? 'Pakete' : 'Tafeln', stock:0, sheetStock:0, packageNumbers:[], minStock:1, storage: presetStorage || 'HAUPTLAGER', shelf: presetStorage === 'KONSI' ? konsiLocation() : 'Regal 1', compartment:'', supplier:'', articleNumber:'', rest:false, note:'' };
  if (!data.storage) data.storage = 'HAUPTLAGER';
  if (!data.shelf) data.shelf = data.storage === 'KONSI' ? konsiLocation() : 'Regal 1';
  const mainStockValue = data.storage === 'KONSI' ? (Number(data.stock) || 0) : (Number(data.sheetStock ?? data.stock) || 0);
  openModal(`
    <h2>${isEdit ? 'Material bearbeiten' : 'Material anlegen'}</h2>
    <p class="muted">Kurzansicht: Material und Stärke stehen oben in der Überschrift. Darunter nur Menge und Lagerplatz.</p>
    <form id="materialForm" class="form-grid">
      <div class="form-full"><label>Material</label><input id="matName" value="${escapeHtml(data.name)}" required placeholder="z. B. Aluminium"></div>
      <div><label>Stärke</label><input id="matThickness" value="${escapeHtml(data.thickness)}" placeholder="z. B. 2,0"></div>
      <div><label>Größe</label><select id="matFormat">${formatOptions(data.format)}</select></div>
      <div><label>Lagerbereich</label><select id="matStorage"><option value="HAUPTLAGER" ${data.storage !== 'KONSI' ? 'selected' : ''}>Hauptlager</option><option value="KONSI" ${data.storage === 'KONSI' ? 'selected' : ''}>Konsi-Lager</option></select></div>
      <div><label id="matStockLabel">Menge</label><input id="matStock" type="number" min="0" step="1" value="${mainStockValue}"></div>
      <div id="matPackageNumbersRow" class="form-full"><label>Konsi-Paketnummern</label><textarea id="matPackageNumbers" placeholder="Eine Nummer pro Zeile oder mit Komma getrennt ...">${escapeHtml((data.packageNumbers || []).join('\n'))}</textarea><div class="format-hint">Diese Nummern werden bei der Paket-Entnahme als Auswahl angezeigt. Wenn Nummern eingetragen sind, wird die Paketmenge automatisch daraus berechnet.</div></div>
      <div><label>Mindestbestand</label><input id="matMinStock" type="number" min="0" step="1" value="${Number(data.minStock) || 0}"></div>
      <div id="matShelfRow"><label>Regal / Lagerplatz</label><select id="matShelf">${shelfOptions(data.shelf)}</select></div><div id="matKonsiLocationRow" class="notice hidden"><strong>Konsi-Lager:</strong> Standort Garage. Es gibt dort keine Regale.</div>
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
  $('#matThickness').addEventListener('blur', () => { $('#matThickness').value = normalizeThicknessInput($('#matThickness').value); });
  const syncPackageCount = () => {
    if ($('#matStorage').value !== 'KONSI') return;
    const numbers = parsePackageNumbers($('#matPackageNumbers').value);
    if (numbers.length) $('#matStock').value = numbers.length;
  };
  $('#matPackageNumbers').addEventListener('input', syncPackageCount);
  updateMaterialFormLabels();
  $('#matRest').addEventListener('change', () => {
    if ($('#matRest').checked) $('#matMinStock').value = 0;
  });
  $('#materialForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const isKonsiForm = $('#matStorage').value === 'KONSI';
    const payload = {
      name: $('#matName').value,
      category: isKonsiForm ? 'Konsi-Lager' : '',
      type: $('#matRest').checked ? 'Resttafel' : 'Tafel',
      thickness: normalizeThicknessInput($('#matThickness').value),
      format: $('#matFormat').value,
      unit: isKonsiForm ? 'Pakete' : 'Tafeln',
      stock: isKonsiForm && parsePackageNumbers($('#matPackageNumbers').value).length ? parsePackageNumbers($('#matPackageNumbers').value).length : ((Number(data.packageStock) || 0) + Number($('#matStock').value)),
      packageStock: isKonsiForm ? 0 : (Number(data.packageStock) || 0),
      sheetStock: isKonsiForm ? 0 : Number($('#matStock').value),
      packageNumbers: isKonsiForm ? parsePackageNumbers($('#matPackageNumbers').value) : [],
      minStock: Number($('#matMinStock').value),
      storage: $('#matStorage').value,
      shelf: isKonsiForm ? konsiLocation() : $('#matShelf').value,
      compartment: '',
      supplier: '',
      articleNumber: '',
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

function previewMaterialsFromTableText(text) {
  const rows = parsePastedTableRowsClient(text);
  if (!rows.length) return [];
  const canonical = ['material','staerke','groesse','regal','tafeln','pakete','mindestbestand','bereich','resttafel','paketnummern','abmassx','abmassy'];
  const headerKeys = rows[0].map(normalizeImportHeaderKeyClient);
  const hasHeader = headerKeys.some(key => canonical.includes(key));
  const headerMap = hasHeader ? headerKeys.reduce((acc, key, index) => { acc[key] = index; return acc; }, {}) : null;
  const bueroFallbackMap = { regal: 0, material: 1, staerke: 2, groesse: 3, tafeln: 4, abmassx: 5, abmassy: 6 };
  const defaultFallbackMap = { material: 0, staerke: 1, groesse: 2, regal: 3, tafeln: 4, pakete: 5, mindestbestand: 6, bereich: 7, resttafel: 8, paketnummern: 9 };
  const useBueroFallback = !hasHeader && rows.some(looksLikeBueroImportRowClient);
  const get = (row, key, fallbackIndex = -1) => {
    const normalized = normalizeImportHeaderKeyClient(key);
    if (headerMap) return headerMap[normalized] !== undefined ? (row[headerMap[normalized]] || '') : '';
    const mappedIndex = useBueroFallback ? bueroFallbackMap[normalized] : defaultFallbackMap[normalized];
    // Büro-Format hat nur: Regal, Material, t=, Format, Menge, Abmass X, Abmass Y.
    // Nicht gemappte Werte dürfen hier nicht auf Abmass-Spalten zurückfallen,
    // sonst entstehen z. B. aus 4000/2000 versehentlich Pakete.
    if (useBueroFallback && mappedIndex === undefined) return '';
    const index = mappedIndex !== undefined ? mappedIndex : fallbackIndex;
    return index >= 0 ? (row[index] || '') : '';
  };
  return (hasHeader ? rows.slice(1) : rows).map((row, index) => {
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
      minStock: Math.max(0, parseNumberClient(get(row, 'mindestbestand', 6), 0)),
      storage,
      rest: isTruthyImportValueClient(get(row, 'resttafel', 8)),
      packageNumbers
    };
    material.error = name ? '' : 'Material fehlt';
    return material;
  }).filter(item => item.name || item.thickness || item.sheets || item.packages || item.packageNumbers.length);
}

window.previewPasteTable = () => {
  const text = ($('#pasteTableText') && $('#pasteTableText').value) || '';
  const preview = previewMaterialsFromTableText(text);
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
  if (!currentUser || currentUser.role !== 'ADMIN') return showToast('Keine Berechtigung', 'Tabellenimport ist nur für Admin freigegeben.');
  openModal(`
    <h2>Materialien aus Tabelle einfügen</h2>
    <p class="muted">In Google Sheets die Zeilen markieren, kopieren und hier einfügen. Büro-Tabellen wie Regal · Material · t= · Format · Menge · Abmass X · Abmass Y werden automatisch erkannt und in deine Material-Ordnung übernommen.</p>
    <div class="notice form-full"><strong>Büro-Format möglich:</strong> Regal · Material · t= · Format · Menge · Abmass X · Abmass Y<br><strong>Wichtig:</strong> Nur die Spalte Menge wird als Tafeln übernommen. Abmass X/Y wird nur für die Größe benutzt, nie als Pakete.<br><strong>Speicherung im Programm:</strong> Material · Stärke · Größe · Lagerplatz · Tafeln</div>
    <textarea id="pasteTableText" style="min-height:190px" placeholder="Regal\tMaterial\tt=\tFormat\tMenge\tAbmass X\tAbmass Y\nRegal 1\tAluminium\t2\tTafel\t12\t3000\t1500"></textarea>
    <div id="pasteTablePreview" class="paste-preview"><div class="empty">Noch keine Tabelle eingefügt.</div></div>
    <div class="toolbar modal-toolbar modal-toolbar-sticky">
      <button class="ghost" onclick="closeModal()">Abbrechen</button>
      <button class="secondary" onclick="previewPasteTable()">Vorschau prüfen</button>
      <button class="primary" onclick="importMaterialsFromTable()">Materialien übernehmen</button>
    </div>
    <div class="footer-note">Konsi geht auch: Bereich = KONSI, Pakete/Paketnummern eintragen. Konsi bleibt Standort Garage.</div>
  `);
  $('#pasteTableText').addEventListener('input', () => {
    clearTimeout(window.__pastePreviewTimer);
    window.__pastePreviewTimer = setTimeout(() => window.previewPasteTable(), 250);
  });
};

window.importMaterialsFromTable = async () => {
  if (!currentUser || currentUser.role !== 'ADMIN') return showToast('Keine Berechtigung', 'Tabellenimport ist nur für Admin freigegeben.');
  const table = ($('#pasteTableText') && $('#pasteTableText').value) || '';
  if (!table.trim()) return showToast('Keine Eingabe', 'Bitte die Tabelle aus Google Sheets einfügen.');
  const preview = previewMaterialsFromTableText(table);
  const errors = preview.filter(item => item.error).length;
  if (!preview.length) return showToast('Keine gültigen Zeilen', 'Es wurden keine Materialzeilen erkannt.');
  if (errors) return showToast('Fehler in Vorschau', 'Bitte zuerst die markierten Zeilen korrigieren.');
  if (!confirm(`${preview.length} Materialposition(en) aus der Tabelle übernehmen?\n\nDubletten werden zusammengeführt.`)) return;
  try {
    const data = await api('/api/materials/import-table', { method: 'POST', body: JSON.stringify({ table }) });
    closeModal();
    showToast('Tabelle übernommen', `${data.created} Materialposition(en) angelegt, ${data.merged || 0} Dublette(n) zusammengeführt.`);
    materialFilter.text = '';
    materialFilter.status = 'all';
    materialFilter.storage = 'all';
    materialFilter.shelf = 'all';
    materialFilter.format = 'all';
    materialFilter.sort = 'size-desc';
    await loadState(true);
    currentPage = 'materials';
    renderCurrentPage();
  } catch (error) {
    showToast('Fehler', error.message);
  }
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
  const targetOptions = defaultShelves
    .filter(shelf => /^Regal\s[1-6]$/.test(shelf))
    .map(shelf => `<option value="${escapeHtml(shelf)}">${escapeHtml(shelf)}</option>`)
    .join('');
  openModal(`
    <h2>Tafeln verräumen</h2>
    <p><strong>${escapeHtml(materialTitle(m))}</strong><br><span class="muted">Von ${escapeHtml(m.shelf || '-')} · verfügbar: ${available} Tafeln</span></p>
    <form id="moveMaterialForm" class="form-grid">
      <div><label>Tafeln verschieben</label><input id="moveQty" type="number" min="1" max="${available}" step="1" value="1" required></div>
      <div><label>Ziel-Regal</label><select id="moveTargetShelf" required>${targetOptions}</select></div>
      <div class="form-full"><label>Notiz</label><textarea id="moveNote" placeholder="optional, z. B. verräumt nach Zuschnitt ..."></textarea></div>
      <div class="notice form-full">Die Tafeln werden bei ${escapeHtml(m.shelf || 'Carport/Bodenhaltung')} automatisch abgezogen. Wenn dort nichts mehr übrig ist, verschwindet die Position.</div>
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
      showToast('Tafeln verräumt', `${materialTitle(m)} → ${targetShelf}`);
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
    const options = numbers.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
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

window.openOrderModal = (materialId = '') => {
  if (!state.permissions.canRequestOrder) return showToast('Keine Berechtigung', 'Diese Rolle nutzt keine Bestellungen.');
  const materials = state.materials.filter(m => !m.rest);
  const options = materials.map(m => `<option value="${escapeHtml(m.id)}" ${m.id === materialId ? 'selected' : ''}>${escapeHtml(m.name)} · ${escapeHtml(storageLabel(m))} · ${quantityLabel(m)}</option>`).join('');
  openModal(`
    <h2>Bestellung angeben</h2>
    <p class="muted">Normale Bestellungen: Pakete + Tafeln. Konsi-Lager: nur Pakete.</p>
    <form id="orderForm" class="form-grid">
      <div class="form-full"><label>Material</label><select id="orderMaterial">${options}</select></div>
      <div><label id="orderAmountLabel">Menge</label><input id="orderAmount" type="number" min="1" step="1" value="1"></div>
      <div id="orderSheetsRow"><label>Tafeln</label><input id="orderSheets" type="number" min="0" step="1" value="0"></div>
      <div class="form-full"><label>Hinweis</label><textarea id="orderNote" placeholder="z. B. Mindestbestand erreicht, wird am Laser benötigt ..."></textarea></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Meldung senden</button></div>
    </form>
  `);
  const updateOrderLabels = () => {
    const selected = state.materials.find(m => m.id === $('#orderMaterial').value);
    const konsi = isKonsi(selected);
    $('#orderAmountLabel').textContent = 'Pakete';
    $('#orderSheetsRow').classList.toggle('hidden', konsi);
  };
  $('#orderMaterial').addEventListener('change', updateOrderLabels);
  updateOrderLabels();
  $('#orderForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const selected = state.materials.find(m => m.id === $('#orderMaterial').value);
    const konsi = isKonsi(selected);
    try {
      await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ materialId: $('#orderMaterial').value, amount: Number($('#orderAmount').value), sheets: konsi ? 0 : Number($('#orderSheets').value), note: $('#orderNote').value })
      });
      closeModal();
      showToast('Bestellung gesendet', 'Die Meldung wurde an Büro/Chef übertragen.');
      await loadState(true);
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.openOrderedModal = (orderId) => {
  const o = state.orders.find(x => x.id === orderId);
  openModal(`
    <h2>Als bestellt markieren</h2>
    <p><strong>${escapeHtml(o.materialName)}</strong><br><span class="muted">Anfrage vom Laser: ${orderQuantityLabel(o, 'request')}</span></p>
    <form id="orderedForm" class="form-grid">
      <div><label>Bestellte Pakete</label><input id="orderedAmount" type="number" min="1" step="1" value="${o.requestedAmount}"></div>${o.storage !== 'KONSI' ? `<div><label>Bestellte Tafeln</label><input id="orderedSheets" type="number" min="0" step="1" value="${Number(o.requestedSheets || 0)}"></div>` : ''}
      <div class="form-full"><label>Hinweis vom Büro</label><textarea id="orderedNote" placeholder="z. B. Liefertermin, Lieferant oder Rückfrage ...">${escapeHtml(o.note || '')}</textarea></div>
      <div class="modal-footer form-full"><button type="button" class="ghost" onclick="closeModal()">Abbrechen</button><button class="primary" type="submit">Bestellt melden</button></div>
    </form>
  `);
  $('#orderedForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await updateOrder(orderId, 'ORDERED', $('#orderedAmount').value, $('#orderedNote').value, o.storage !== 'KONSI' ? $('#orderedSheets').value : 0);
    closeModal();
  });
};


window.openReceiveModal = (orderId) => {
  const o = state.orders.find(x => x.id === orderId);
  if (!o) return;
  const isK = o.storage === 'KONSI';
  const material = (state.materials || []).find(m => m.id === o.materialId) || {};
  const orderedP = Number(o.orderedAmount || o.requestedAmount || 0);
  const receivedP = Number(o.receivedAmount || 0);
  const openP = Math.max(0, orderedP - receivedP) || 1;
  const defaultWeight = Number(o.lastPackageWeightKg || material.lastPackageWeightKg || 0) || '';
  openModal(`
    <h2>${isK ? 'Konsi-Lieferung annehmen' : 'Lieferung annehmen'}</h2>
    <p><strong>${escapeHtml(o.materialName)}</strong><br><span class="muted">Bestellt: ${orderQuantityLabel(o, 'ordered')} · Bereits geliefert: ${orderQuantityLabel(o, 'received')}</span></p>
    <form id="receiveForm" class="form-grid">
      <div><label>Gelieferte Pakete</label><input id="receivedAmount" type="number" min="0" step="1" value="${openP}"><div class="format-hint">Nur bei Lieferung: Pakete werden über Gewicht in Tafeln umgerechnet.</div></div>
      ${isK ? '' : `<div><label>Gewicht pro Paket kg</label><input id="packageWeightKg" type="number" min="0" step="0.1" value="${defaultWeight}" placeholder="z. B. 850"><div class="format-hint">Beispiel: 2 Pakete à 850 kg = 1700 kg.</div></div>
      <div class="form-full weight-calc-box"><div><strong>Berechnung</strong><br><span id="sheetWeightHint">${escapeHtml(weightInfoText(material))}</span></div><div class="format-hint" id="weightCalcHint">Pakete und Gewicht pro Paket eintragen, dann werden die Tafeln automatisch vorgeschlagen.</div></div>
      <div><label>Berechnete Tafeln</label><input id="receivedSheets" type="number" min="0" step="1" value="0"><div class="format-hint">Wird aus Pakete × Gewicht berechnet, kann aber überschrieben werden.</div></div>`}
      ${isK ? `<div class="form-full"><label>Konsi-Paketnummern</label><textarea id="receivedPackageNumbers" placeholder="eine Paketnummer pro Zeile"></textarea><div class="format-hint">Beim Konsi muss für jedes gelieferte Paket eine Nummer eingetragen werden.</div></div>` : `<div class="form-full"><label>Ablageort</label><select id="deliveryShelf">${shelfOptions('Carport')}</select><div class="format-hint">Standard ist Carport, weil Lieferungen meistens dort gelagert werden. Ausnahmen können direkt auf Bodenhaltung oder Regal 1–6 gebucht werden.</div></div>`}
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
    $('#weightCalcHint').textContent = sheets > 0
      ? `Vorschlag: ${packages} Paket(e) × ${String(weight).replace('.', ',')} kg = ${String(totalWeight).replace('.', ',')} kg → ca. ${sheets} Tafeln${oneSheet ? ` (${oneSheet.toFixed(1).replace('.', ',')} kg/Tafel)` : ''}.`
      : 'Pakete und Gewicht pro Paket eintragen, dann werden die Tafeln automatisch vorgeschlagen.';
    if (sheets > 0) $('#receivedSheets').value = sheets;
  }
  if (!isK) {
    $('#receivedAmount').addEventListener('input', updateWeightCalculation);
    $('#packageWeightKg').addEventListener('input', updateWeightCalculation);
    updateWeightCalculation();
  }
  $('#receiveForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      receivedAmount: Number($('#receivedAmount').value || 0),
      receivedSheets: isK ? 0 : Number($('#receivedSheets').value || 0),
      packageWeightKg: isK ? 0 : Number($('#packageWeightKg').value || 0),
      targetShelf: isK ? '' : $('#deliveryShelf').value,
      packageNumbers: isK ? $('#receivedPackageNumbers').value : '',
      note: $('#receiveNote').value
    };
    try {
      await api(`/api/orders/${orderId}/receive`, { method: 'POST', body: JSON.stringify(payload) });
      closeModal();
      showToast('Lieferung angenommen', isK ? 'Konsi-Pakete wurden in der Garage übernommen.' : `Material wurde als geliefert nach ${payload.targetShelf || 'Carport'} gebucht.`);
      await loadState(true);
    } catch (error) { showToast('Fehler', error.message); }
  });
};

window.updateOrder = async (orderId, action, orderedAmount = null, note = '', orderedSheets = 0) => {
  try {
    await api(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ action, orderedAmount, orderedSheets, note }) });
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
  if (!state.permissions.canExportMaterials) return showToast('Keine Berechtigung', 'CSV-Download ist für Büro, Chef und Admin freigegeben.');
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

window.deleteEmptyMaterialsAdmin = async () => {
  if (!state.permissions.canManageSystem) return showToast('Keine Berechtigung', 'Nur Admin darf leere Materialien löschen.');
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

window.deleteAllMaterialsAdmin = async () => {
  if (!state.permissions.canManageSystem) return showToast('Keine Berechtigung', 'Nur Admin darf die Materialdatenbank leeren.');
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
    <p class="muted">${force ? 'Der Admin hat festgelegt, dass du dein Passwort ändern sollst.' : 'Neues Passwort speichern.'}</p>
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
