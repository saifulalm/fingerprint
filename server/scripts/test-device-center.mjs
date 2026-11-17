// Uji service Device Center terhadap perangkat nyata (READ-ONLY dulu).
import {
  getOverview, getDeviceUsers, detectConflicts, getDeviceByKey,
} from '../src/services/hikvisionAdmin.js';

console.log('═══ 1. OVERVIEW (kapabilitas + status) ═══');
const ov = await getOverview();
for (const d of ov.devices) {
  console.log(`\n[${d.key}] ${d.label} (${d.ip})`);
  console.log('  deviceInfo :', d.deviceInfo ? `${d.deviceInfo.model} / fw ${d.deviceInfo.firmwareVersion}` : 'GAGAL');
  console.log('  sysCaps    :', d.systemCapabilities.length, 'flag');
  console.log('  accessCaps :', d.accessCapabilities.length, 'flag');
  console.log('  eventCaps  :', JSON.stringify(d.eventCapabilities));
  console.log('  work       :', JSON.stringify(d.work));
  console.log('  time       :', JSON.stringify(d.time));
  console.log('  network    :', JSON.stringify(d.network));
  console.log('  errors     :', d.errors);
}

console.log('\n═══ 2. USER PER PERANGKAT ═══');
for (const key of ['masuk', 'keluar']) {
  const users = await getDeviceUsers(getDeviceByKey(key));
  console.log(`\n[${key}] total=${users.length}`);
  for (const u of users) {
    console.log(`  ${String(u.employeeNo).padEnd(4)} ${String(u.name).padEnd(18)} type=${u.userType} valid=${u.valid} end=${u.validEnd}`);
  }
}

console.log('\n═══ 3. KONFLIK ═══');
const cf = await detectConflicts();
console.log('konflik:', cf.conflicts.length);
for (const c of cf.conflicts) {
  console.log(`  [${c.reason}] no=${c.employeeNo} →`, c.names.map(n => `${n.deviceKey}:${n.name}`).join(' | '));
}
console.log('deviceKeys:', cf.deviceKeys);
