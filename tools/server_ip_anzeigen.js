const os = require('os');
const nets = os.networkInterfaces();
const ips = [];
for (const name of Object.keys(nets)) {
  for (const item of nets[name] || []) {
    if (item.family === 'IPv4' && !item.internal) ips.push({ name, address: item.address });
  }
}
console.log('Gefundene Netzwerk-Adressen:');
if (!ips.length) {
  console.log('  Keine IPv4-Adresse gefunden. WLAN/LAN pruefen.');
} else {
  for (const item of ips) {
    console.log(`  ${item.name}: http://${item.address}:4170`);
  }
}
console.log('');
console.log('Diese Adresse auf den Client-PCs eintragen.');
