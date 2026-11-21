// Employee identity service — SATU-SATUNYA sumber kebenaran untuk
// memetakan nomor employee → nama karyawan.
//
// MASALAH YANG DISELESAIKAN:
//
// 1. DUPLIKASI. `buildEmployeeNameMap()` pernah ada di EMPAT controller
//    (attendanceController, exportController, reportController, dan
//    attendanceSyncService) dengan prioritas yang BERBEDA-BEDA. Akibatnya
//    laporan, rekap, dan WhatsApp bisa menampilkan nama berbeda untuk
//    orang yang sama. Sekarang semua pakai modul ini.
//
// 2. KONFLIK NOMOR ID. Nomor employee adalah kunci LOKAL di tiap
//    perangkat. ID yang sama bisa menunjuk orang berbeda di device Masuk vs
//    Keluar — terverifikasi live ke dua perangkat nyata:
//
//      masuk:  5=Juanto  6=Adit
//      keluar: 5=Adit    6=Chika
//
//    Perangkat TIDAK bisa memperbaiki ini sendiri: `UserInfo/Modify`
//    menolak perubahan employeeNo (badParameters) dan `UserInfo/Add`
//    ditolak (notSupport). Jadi pemetaan disimpan di tabel
//    `employee_id_aliases` — ini satu-satunya cara memperbaiki ID yang
//    tersedia.
//
// 3. STATUS AKTIF. Dua sumber status yang harus digabung:
//      - `DeviceUser.enabled` — status di APLIKASI (soft-delete),
//      - `Valid.enable` di perangkat — status di PERANGKAT.
//    Status efektif = keduanya harus true. Hard-delete di perangkat tidak
//    didukung firmware, jadi "hapus" berarti disable di perangkat + soft
//    delete di aplikasi.
import prisma from '../db.js';

/**
 * Nama "dummy" yang dipakai perangkat untuk user tanpa nama asli.
 * User seperti ini tidak boleh dianggap punya nama valid.
 */
export function isPlaceholderName(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  return n.startsWith('ID ');
}

/**
 * Bangun peta employeeNo → info karyawan dari tabel device_users.
 *
 * Peta ini adalah "canonical" — satu nomor dianggap milik satu orang, dan
 * prioritas nama ditentukan oleh perangkat. PerANGKAT dengan prioritas
 * tertinggi menang.
 *
 * @param {object} opts
 * @param {boolean} opts.includeDisabled sertakan user non-aktif (default true)
 * @returns {Promise<Map<string, object>>}
 */
export async function buildEmployeeIndex({ includeDisabled = true } = {}) {
  const rows = await prisma.deviceUser.findMany();
  const index = new Map();

  // Urutan prioritas perangkat. Device "masuk" adalah pintu masuk absensi,
  // jadi nomornya dipakai sebagai nomor CANONICAL ketika satu orang punya
  // nomor berbeda di dua perangkat.
  const devicePriority = [CANONICAL_DEVICE_KEY, ...['masuk', 'keluar'].filter((k) => k !== CANONICAL_DEVICE_KEY)];

  // Peta nama PER PERANGKAT. Dibutuhkan karena nama yang tampil harus
  // mengikuti perangkat asalnya: nomor "5" di Masuk adalah Juanto, di
  // Keluar adalah Adit. Peta canonical (index) tidak bisa dipakai untuk
  // itu, karena ia sudah memilih satu nama per nomor.
  const deviceNames = new Map();

  for (const u of rows) {
    const empNo = String(u.employeeNo);
    const name = (u.name || '').trim();
    const isValid = !isPlaceholderName(name);
    const entry = {
      employeeNo: empNo,
      name: isValid ? name : `ID ${empNo}`,
      isValid,
      deviceKey: u.deviceKey,
      enabled: u.enabled !== false,
      // Status perangkat ikut dilacak agar UI bisa membedakan
      // "dinonaktifkan di aplikasi" vs "dinonaktifkan di perangkat".
      deviceEnabled: u.deviceEnabled !== false,
    };

    if (!deviceNames.has(u.deviceKey)) deviceNames.set(u.deviceKey, new Map());
    const dmap = deviceNames.get(u.deviceKey);
    if (!dmap.has(empNo)) {
      dmap.set(empNo, { name: entry.name, isValid });
    }

    const cur = index.get(empNo);
    if (!cur) {
      index.set(empNo, entry);
      continue;
    }

    // Aturan memilih nama canonical untuk satu nomor employee:
    //   1. nama valid (bukan "ID X") beating nama placeholder
    //   2. perangkat dengan prioritas lebih tinggi beating yang lain
    const curRank = devicePriority.indexOf(cur.deviceKey);
    const entryRank = devicePriority.indexOf(entry.deviceKey);
    const betterName =
      (entry.isValid && !cur.isValid) ||
      (entry.isValid === cur.isValid && entryRank < curRank);

    // Status aktif digabung: user aktif kalau salah satu device masih aktif.
    const merged = {
      ...(betterName ? entry : cur),
      enabled: cur.enabled || entry.enabled,
      deviceEnabled: cur.deviceEnabled || entry.deviceEnabled,
    };
    index.set(empNo, merged);
  }

  // Peta nama per perangkat ditempel ke Map hasil, supaya resolver bisa
  // menampilkan nama sesuai perangkat asal event.
  Object.defineProperty(index, 'deviceNames', {
    value: deviceNames,
    enumerable: false,
  });

  if (!includeDisabled) {
    for (const [k, v] of index) if (!v.enabled || !v.deviceEnabled) index.delete(k);
  }
  return index;
}

/**
 * Ambil peta alias nomor ID dari tabel employee_id_aliases.
 * Key: `${deviceKey}:${deviceEmployeeNo}` → canonical employeeNo.
 *
 * @returns {Promise<Map<string, string>>}
 */
export async function loadIdAliases() {
  const rows = await prisma.employeeIdAlias.findMany();
  const map = new Map();
  for (const r of rows) {
    map.set(`${r.deviceKey}:${r.deviceEmployeeNo}`, r.employeeNo);
  }
  return map;
}

/**
 * Perangkat yang dipakai sebagai REFERENSI nomor employee.
 *
 * MASALAH YANG DISELESAIKAN:
 *   Nomor employee adalah kunci LOKAL tiap perangkat, jadi nomor yang sama
 *   bisa menunjuk orang berbeda di dua perangkat (terverifikasi live:
 *   masuk "5 = Juanto" vs keluar "5 = Adit"). Perangkat tidak bisa
 *   mengganti employeeNo, jadi penDatasyonya harus dilakukan di aplikasi.
 *
 *   Untuk itu satu perangkat ditetapkan sebagai REFERENSI: nomor employee
 *   yang dipakai di perangkat itu dianggap nomor CANONICAL. Nomor yang sama
 *   di perangkat lain dipetakan ke nomor canonical lewat tabel alias.
 *
 *   Default: "masuk" — perangkat absensi masuk dipakai sebagai acuan karena
 *   absensi selalu dimulai dari pintu masuk.
 */
export const CANONICAL_DEVICE_KEY = 'masuk';

/**
 * Petakan nomor employee di sebuah perangkat ke nomor CANONICAL.
 *
 * Alias bersifat SATU LANGKAH: nilainya adalah nomor canonical (nomor yang
 * dipakai di perangkat referensi), bukan nomor lokal perangkat itu sendiri.
 * Jadi `keluar:5 → 6` berarti "nomor 5 di Keluar adalah orang bernomor 6
 * di perangkat referensi" — TIDAK berarti "nomor 5 di Keluar adalah nomor
 * 5 di Keluar yang dipetakan lagi".
 *
 * Tanpa konteks perangkat, alias dari perangkat referensi dipakai lebih
 * dulu, baru perangkat lain.
 *
 * @param {string} employeeNo
 * @param {Map<string, string>|null} aliases
 * @param {string|null} deviceKey perangkat asal; null = tanpa konteks
 * @returns {string} nomor canonical
 */
export function resolveCanonicalEmployeeNo(employeeNo, aliases = null, deviceKey = null) {
  const empNo = String(employeeNo || '').trim();
  if (!empNo || !aliases) return empNo;

  if (deviceKey) {
    // Hanya alias perangkat itu yang relevan. Nomornya di perangkat lain
    // adalah hal yang BERBEDA, bukan nama lain untuk nomor yang sama.
    const hit = aliases.get(`${deviceKey}:${empNo}`);
    return hit && hit !== empNo ? hit : empNo;
  }

  // Tanpa konteks perangkat, nomor hanya bisa dipahami relatif terhadap
  // perangkat REFERENSI — itu definisi nomor canonical. Alias perangkat
  // lain TIDAK boleh dipakai di sini: nomor "5" tanpa konteks adalah
  // "5 di perangkat referensi", bukan "5 di perangkat mana saja".
  const hit = aliases.get(`${CANONICAL_DEVICE_KEY}:${empNo}`);
  return hit && hit !== empNo ? hit : empNo;
}

/**
 * Resolver nama yang dipakai seluruh laporan/absensi.
 *
 * MODEL KEBENARAN:
 *   Dua hal berbeda bisa konflik antar perangkat:
 *     1. NAMA orang — TIDAK konflik. Perangkat menyimpan nama asli orang,
 *        jadi "Adit" di Masuk dan "Adit" di Keluar memang orang yang sama.
 *     2. NOMOR employee — konflik. Nomor adalah kunci LOKAL tiap perangkat,
 *        jadi nomor 5 di Masuk (Juanto) dan nomor 5 di Keluar (Adit) orang
 *        yang BERBEDA.
 *
 *   Karena itu nama tampilan diambil dari baris device_users yang PERSIS
 *   untuk perangkat asalnya — itu sudah benar tanpa perlu alias.
 *   Alias dipakai untuk memetakan NOMOR ke nomor canonical (lihat
 *   resolveCanonicalEmployeeNo), supaya laporan menampilkan nomor yang
 *   konsisten untuk orang yang sama.
 *
 * @param {string} employeeNo nomor employee dari event / record
 * @param {Map<string, object>} index hasil buildEmployeeIndex()
 * @param {Map<string, string>} [aliases] hasil loadIdAliases()
 * @param {string} [deviceKey] perangkat asal event — dipakai untuk alias
 * @returns {string} nama untuk ditampilkan
 */
export function resolveDisplayName(employeeNo, index, aliases = null, deviceKey = null) {
  const empNo = String(employeeNo || '').trim();
  if (!empNo) return 'ID ?';

  // 1. Nama milik perangkat asal. Ini yang paling akurat: baris
  //    device_users menyimpan nama persis seperti yang dibaca di perangkat.
  if (deviceKey) {
    const perDevice = index.deviceNames?.get(deviceKey);
    const hit = perDevice?.get(empNo);
    if (hit?.isValid) return hit.name;
  }

  // 2. Tanpa konteks perangkat: pakai nama canonical. Nama canonical
  //    dipilih dari perangkat referensi, jadi ini sudah konsisten.
  const canonical = aliases
    ? resolveCanonicalEmployeeNo(empNo, aliases, null)
    : empNo;

  const viaCanonical = index.get(canonical);
  if (viaCanonical?.isValid) return viaCanonical.name;

  const local = index.get(empNo);
  if (local?.isValid) return local.name;
  return `ID ${empNo}`;
}

/**
 * Buat resolver nama siap pakai untuk controller/service.
 *
 * MASALAH YANG DISELESAIKAN:
 *   Helper ini pernah disalin ke EMPAT file (attendanceController,
 *   exportController, reportController, attendanceSyncService) — dan
 *   emailController TIDAK punya sama sekali. Duplikasi itu menyebabkan
 *   laporan menampilkan nama berbeda untuk orang yang sama, dan satu
 *   controller (email) sama sekali mengabaikan pemetaan alias sehingga
 *   laporan email bisa menampilkan ORANG YANG SALAH.
 *
 * SEKARANG: satu implementasi di sini, dipakai semua pemanggil.
 *
 * @returns {Promise<{index: Map<string,object>, aliases: Map<string,string>,
 *   name: (empNo: string, deviceKey?: string|null) => string}>}
 */
export async function createNameResolver() {
  const [index, aliases] = await Promise.all([
    buildEmployeeIndex(),
    loadIdAliases(),
  ]);
  return {
    index,
    aliases,
    /** Nama tampilan untuk nomor employee pada perangkat tertentu. */
    name: (empNo, deviceKey = null) => resolveDisplayName(empNo, index, aliases, deviceKey),
  };
}

/**
 * Pilih nama untuk ditampilkan dari dua sumber: nama hasil resolver dan
 * nama yang tersimpan di data (mis. kolom `attendance_records.employee_name`).
 *
 * MASALAH YANG DISELESAIKAN:
 *   Resolver hanya mengenal orang yang tercatat di tabel `device_users`.
 *   Bila seorang karyawan terdaftar di perangkat tetapi aplikasinya belum
 *   melakukan sinkronisasi user, resolver mengembalikan placeholder
 *   "ID 3" — padahal record absensinya sudah menyimpan nama aslinya
 *   ("Astrid"). Laporan lalu menampilkan "Terlambat rutin: ID 3" dan
 *   analisanya salah mengelompokkan orang.
 *
 * Aturan: nama pertama yang BUKAN placeholder menang. Kalau keduanya
 * placeholder, kembalikan yang resolver (konsisten dengan controller lain).
 */
export function preferRealName(resolved, fallback) {
  const r = String(resolved || '').trim();
  const f = String(fallback || '').trim();
  if (r && !isPlaceholderName(r)) return r;
  if (f && !isPlaceholderName(f)) return f;
  return r || f || '';
}

/**
 * Resolver versi ringkas untuk kasus yang hanya butuh nama (bukan device).
 *
 * @param {string} employeeNo
 * @param {Map<string, object>} index
 * @param {Map<string, string>} [aliases]
 * @returns {string}
 */
export function resolveName(employeeNo, index, aliases = null) {
  return resolveDisplayName(employeeNo, index, aliases, null);
}

/**
 * Deteksi konflik nomor ID antar perangkat.
 *
 * Konflik = nomor employee yang sama menunjuk nama BERBEDA di perangkat
 * berbeda. Ini penyebab laporan absensi salah orang.
 *
 * Fungsi ini membaca data PERANGKAT (bukan DB cache) supaya hasilnya
 * mencerminkan kondisi perangkat saat ini.
 *
 * @param {Array<{type:string,label:string}>} devices
 * @param {Function} getUsers async (dev) => [{employeeNo, name}]
 * @returns {Promise<object>}
 */
export async function detectIdConflicts(devices, getUsers) {
  const perDevice = {};

  for (const dev of devices) {
    try {
      const users = await getUsers(dev);
      perDevice[dev.type] = users.map((u) => ({
        employeeNo: String(u.employeeNo),
        name: (u.name || '').trim(),
      }));
    } catch (err) {
      perDevice[dev.type] = { error: err.message };
    }
  }

  const keys = Object.keys(perDevice).filter((k) => Array.isArray(perDevice[k]));
  const conflicts = [];
  const onlyIn = {};

  for (const key of keys) onlyIn[key] = [];

  const allNos = new Set();
  for (const key of keys) {
    for (const u of perDevice[key]) allNos.add(u.employeeNo);
  }

  for (const no of allNos) {
    const perKey = {};
    for (const key of keys) {
      const found = perDevice[key].find((u) => u.employeeNo === no);
      if (found) perKey[key] = found;
    }
    const presentKeys = Object.keys(perKey);
    const names = new Set(presentKeys.map((k) => (perKey[k].name || '').trim().toLowerCase()));

    if (names.size > 1) {
      conflicts.push({
        employeeNo: no,
        names: presentKeys.map((k) => ({ deviceKey: k, name: perKey[k].name || '(kosong)' })),
        reason: 'conflict',
      });
      continue;
    }

    if (presentKeys.length === 1 && keys.length > 1) {
      const onlyKey = presentKeys[0];
      conflicts.push({
        employeeNo: no,
        names: [{ deviceKey: onlyKey, name: perKey[onlyKey].name || '(kosong)' }],
        reason: 'only_one_device',
      });
      onlyIn[onlyKey].push({ employeeNo: no, name: perKey[onlyKey].name });
    }
  }

  return { perDevice, conflicts, onlyIn, deviceKeys: keys };
}

/**
 * Usulkan pemetaan alias untuk konflik nomor ID.
 *
 * MASALAH YANG DISELESAIKAN:
 *   Nomor employee adalah kunci LOKAL tiap perangkat, jadi nomor yang sama
 *   bisa menunjuk orang berbeda di dua perangkat. Perangkat tidak bisa
 *   mengganti employeeNo, jadi satu-satunya perbaikan adalah mencatat
 *   "nomor X di perangkat D sebenarnya orang bernomor Y".
 *
 * ARAH PEMETAAN:
 *   Alias SELALU dari perangkat non-referensi menuju nomor canonical yang
 *   dipakai di perangkat referensi. Nilai alias adalah nomor orang tersebut
 *   DI PERANGKAT REFERENSI — bukan nomor lokal perangkat itu.
 *
 * CARA MENENTUKAN Y:
 *   Cari orang dengan NAMA SAMA di perangkat referensi. Nomor yang dia
 *   pakai di sana adalah Y. Nama tidak pernah konflik antar perangkat
 *   (perangkat menyimpan nama asli), jadi pencocokan nama itu valid.
 *
 *   Contoh nyata (probe live ke 192.168.89.240 & .241, 2026-11-10):
 *     masuk : 2=Saiful 3=Astrid 4=Chika 5=Juanto 6=Adit  8=Cepi 9=Dian 10=Ibu Christina 11=Brook
 *     keluar: 2=Saiful 3=Astrid 4=-      5=Adit  6=Chika 7=Juanto 8=Cepi 9=Dian 10=Ibu Christina 11=Brook
 *
 *   Saran:
 *     - keluar:5 → 6   (Adit   di Keluar; di Masuk orang itu bernomor 6)
 *     - keluar:6 → 4   (Chika  di Keluar; di Masuk orang itu bernomor 4)
 *     - keluar:7 → 5   (Juanto di Keluar; di Masuk orang itu bernomor 5)
 *
 * @param {object} perDevice hasil detectIdConflicts().perDevice
 * @param {string[]} deviceKeys daftar perangkat yang dibaca
 * @param {string} [referenceKey] perangkat referensi (default CANONICAL_DEVICE_KEY)
 * @returns {Array<{deviceKey:string,deviceEmployeeNo:string,employeeNo:string,name:string,reason:string}>}
 */
export function suggestIdAliases(perDevice, deviceKeys, referenceKey = CANONICAL_DEVICE_KEY) {
  const keys = (deviceKeys || []).filter((k) => Array.isArray(perDevice?.[k]));
  const suggestions = [];

  const refUsers = perDevice?.[referenceKey];
  if (!Array.isArray(refUsers)) return suggestions;

  // Nama → nomor canonical, dari perangkat referensi.
  const refByName = new Map();
  for (const u of refUsers) {
    const name = (u.name || '').trim();
    if (!name) continue;
    if (!refByName.has(name)) refByName.set(name, u.employeeNo);
  }

  // Nomor → nama, dari perangkat referensi.
  const refByNo = new Map();
  for (const u of refUsers) refByNo.set(u.employeeNo, (u.name || '').trim());

  for (const key of keys) {
    if (key === referenceKey) continue;

    for (const u of perDevice[key]) {
      const no = u.employeeNo;
      const name = (u.name || '').trim();
      if (!name) continue;

      const canonicalNo = refByName.get(name);
      if (!canonicalNo || canonicalNo === no) continue;

      // Nomor yang sama di perangkat referensi menunjuk orang lain → konflik.
      const refNameForNo = refByNo.get(no);
      const reason = refNameForNo && refNameForNo.toLowerCase() !== name.toLowerCase()
        ? 'conflict'
        : 'only_one_device';

      suggestions.push({
        deviceKey: key,
        deviceEmployeeNo: no,
        employeeNo: canonicalNo,
        name,
        reason,
      });
    }
  }

  return suggestions;
}

export default {
  isPlaceholderName,
  buildEmployeeIndex,
  loadIdAliases,
  createNameResolver,
  resolveCanonicalEmployeeNo,
  resolveDisplayName,
  resolveName,
  preferRealName,
  detectIdConflicts,
  suggestIdAliases,
};
