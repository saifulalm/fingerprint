// Uji JALUR TULIS service: Modify → baca ulang → RESTORE.
// Selalu mengembalikan perangkat ke kondisi semula, apa pun hasilnya.
import { getDeviceByKey, getDeviceUsers, updateDeviceUser } from '../src/services/hikvisionAdmin.js';

const dev = getDeviceByKey('masuk');
const EMP = '2';

const before = (await getDeviceUsers(dev)).find((u) => u.employeeNo === EMP);
console.log('SEBELUM  :', JSON.stringify({ no: before.employeeNo, name: before.name, type: before.userType }));

const TEST_NAME = 'UJI_MODIFY_SERVICE';

try {
  console.log('\n─── MODIFY (tulis nama sementara) ───');
  const r = await updateDeviceUser(dev, EMP, { name: TEST_NAME });
  console.log('  hasil :', JSON.stringify(r.response));

  await new Promise(res => setTimeout(res, 1200));
  const mid = (await getDeviceUsers(dev)).find((u) => u.employeeNo === EMP);
  console.log('  baca ulang :', mid.name);
  console.log('  TERSIMPAN?  :', mid.name === TEST_NAME ? '✅ YA' : '❌ TIDAK');
} catch (err) {
  console.log('  ❌ GAGAL:', err.message);
} finally {
  console.log('\n─── RESTORE ───');
  try {
    await updateDeviceUser(dev, EMP, { name: before.name });
    await new Promise(res => setTimeout(res, 1200));
    const after = (await getDeviceUsers(dev)).find((u) => u.employeeNo === EMP);
    console.log('  SESUDAH :', after.name);
    console.log('  RESTORE  :', after.name === before.name ? '✅ OK' : '❌ GAGAL');
  } catch (e) {
    console.log('  ❌ RESTORE GAGAL:', e.message);
  }
}

// Uji error: user tidak ada → harus 404, bukan 500
console.log('\n─── UJI ERROR: user tidak ada ───');
try {
  await updateDeviceUser(dev, '999999', { name: 'X' });
  console.log('  ❌ seharusnya error');
} catch (err) {
  console.log('  ✅ error seperti yang diharapkan:', err.status, '|', err.message);
}

process.exit(0);
