// Device Center service — administrasi terhadap perangkat Hikvision via ISAPI.
//
// Berbeda dari `hikvision.js` (yang fokus READ + sinkronisasi absensi),
// modul ini menangani sisi ADMINISTRASI perangkat: memetakan kapabilitas,
// membaca status kerja pintu, mengelola jam perangkat, dan menulis perubahan
// nama pengguna langsung ke perangkat.
//
// ─────────────────────────────────────────────────────────────────────────────
// KAPABILITAS YANG SUDAH DIVERIFIKASI TERHADAP FIRMWARE PERANGKAT INI
// (diukur dengan probe read-only, lihat server/scripts/probe-capabilities*.mjs)
// ─────────────────────────────────────────────────────────────────────────────
// ✅ DIDUKUNG
//   GET  /ISAPI/System/capabilities              → peta kapabilitas sistem
//   GET  /ISAPI/AccessControl/capabilities       → peta kapabilitas Akses
//   GET  /ISAPI/System/deviceInfo                → model/serial/firmware
//   GET  /ISAPI/System/time                      → jam perangkat
//   GET  /ISAPI/System/Network/interfaces        → konfigurasi jaringan
//   GET  /ISAPI/AccessControl/AcsWorkStatus      → status pintu real-time
//   GET  /ISAPI/AccessControl/AcsEvent/capabilities → batas parameter event
//   POST /ISAPI/AccessControl/UserInfo/Search    → daftar user
//   PUT  /ISAPI/AccessControl/UserInfo/Modify    → ubah user (BUTUH payload lengkap)
//
// ❌ TIDAK DIDUKUNG firmware ini (jangan tawarkan di UI)
//   POST/PUT /ISAPI/AccessControl/UserInfo/Add     → notSupport
//   PUT  /ISAPI/AccessControl/UserInfo/Delete     → badParameters
//   GET  /ISAPI/AccessControl/UserInfo/SearchCap  → notSupport
//   GET  /ISAPI/AccessControl/UserInfo/Groups     → notSupport
//   GET  /ISAPI/AccessControl/Door/Status         → notSupport
//   GET  /ISAPI/AccessControl/deployInfo          → notSupport
//   GET  /ISAPI/System/Time/ntpServers/*          → notSupport
//   GET  /ISAPI/AccessControl/UserInfo/FingerPrint/* → notSupport
//   GET  /ISAPI/Security/userInfo                 → notSupport
//
// PENTING: `Modify` HANYA berhasil bila payload menyertakan hak akses lengkap
// (doorRightList + rightPermission + privilege). Tanpa itu perangkat membalas
// HTTP 400 `MessageParametersLack`. Lihat `buildUserPayload()` di bawah.
import crypto from 'crypto';
import xml2js from 'xml2js';
import { digestRequest, fetchAllUsers } from './hikvision.js';
import { config } from '../config/index.js';

// ─── Helper ────────────────────────────────────────────────────────────────────

/** Ambil daftar perangkat yang dikonfigurasi, dalam bentuk array. */
export function listDevices() {
  return Object.values(config.devices);
}

/**
 * Ambil device berdasarkan key ('masuk' / 'keluar').
 * Melempar Error kalau key tidak dikenal — pemanggil harus cek dulu.
 */
export function getDeviceByKey(key) {
  const dev = config.devices?.[key];
  if (!dev) throw new Error(`Perangkat "${key}" tidak dikenal`);
  return dev;
}

/** Ubah XML ISAPI menjadi objek biasa (nullValue dihapus agar rapi). */
async function parseXml(xml) {
  const parsed = await xml2js.parseStringPromise(xml, {
    explicitArray: false,
    ignoreAttrs: false,
    mergeAttrs: true,
  });
  return parsed;
}

/**
 * Ambil JSON dari endpoint ISAPI dengan fallback ke XML.
 * Sebagian endpoint firmware ini membalas XML meski `format=json` diminta
 * (mis. System/deviceInfo), jadi jangan hanya andalkan JSON.
 */
async function readIsapi(dev, path, { timeout = 8000 } = {}) {
  const url = `http://${dev.ip}${path}`;
  const resp = await digestRequest({
    url,
    method: 'GET',
    username: dev.username,
    password: dev.password,
    timeout,
  });
  const data = resp.data;
  if (typeof data === 'object' && data !== null) return { raw: data, format: 'json' };
  const xml = String(data);
  if (xml.trimStart().startsWith('<')) {
    return { raw: await parseXml(xml), format: 'xml' };
  }
  try { return { raw: JSON.parse(xml), format: 'json' }; } catch { return { raw: xml, format: 'text' }; }
}

/**
 * Ringkas peta kapabilitas menjadi daftar flag yang mudah ditampilkan.
 *
 * CATATAN: xml2js mengembalikan isi elemen sebagai STRING, jadi
 * `<isSupportDst>true</isSupportDst>` menjadi `{ isSupportDst: 'true' }` —
 * bukan boolean. Kalau hanya boolean yang dicari, SEMUA flag hilang dan UI
 * menampilkan "0 kapabilitas" padahal perangkat mendukung banyak hal.
 * Karena itu string 'true'/'false' ikut dikenali.
 */
function extractFlags(capObj) {
  const flags = [];
  const walk = (node, prefix = '') => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'boolean') {
        flags.push({ key: name, supported: value });
      } else if (typeof value === 'string' && (value === 'true' || value === 'false')) {
        flags.push({ key: name, supported: value === 'true' });
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, name);
      }
    }
  };
  walk(capObj);
  return flags;
}

// ─── Kapabilitas & identitas perangkat ─────────────────────────────────────────

/**
 * Ambil identitas + kapabilitas satu perangkat.
 * Endpoint yang gagal TIDAK menggagalkan seluruh hasil — setiap bagian
 * dikembalikan terpisah beserta statusnya, sehingga UI bisa menandai
 * "tidak tersedia" alih-alih menampilkan halaman kosong.
 */
export async function getDeviceCapabilities(dev) {
  const result = {
    key: dev.type,
    label: dev.label,
    ip: dev.ip,
    direction: dev.direction,
    deviceInfo: null,
    systemCapabilities: [],
    accessCapabilities: [],
    eventCapabilities: null,
    errors: [],
  };

  // Identitas perangkat
  try {
    const { raw } = await readIsapi(dev, '/ISAPI/System/deviceInfo?format=json');
    const info = raw?.DeviceInfo || {};
    result.deviceInfo = {
      deviceName: info.deviceName || '-',
      deviceID: info.deviceID ?? null,
      model: info.model || '-',
      serialNumber: info.serialNumber || '-',
      firmwareVersion: info.firmwareVersion || '-',
      hardwareVersion: info.hardwareVersion || '-',
      macAddress: info.macAddress || '-',
    };
  } catch (err) {
    result.errors.push(`deviceInfo: ${err.message}`);
  }

  // Kapabilitas sistem
  try {
    const { raw } = await readIsapi(dev, '/ISAPI/System/capabilities?format=json');
    result.systemCapabilities = extractFlags(raw?.DeviceCap);
  } catch (err) {
    result.errors.push(`System/capabilities: ${err.message}`);
  }

  // Kapabilitas kontrol akses
  try {
    const { raw } = await readIsapi(dev, '/ISAPI/AccessControl/capabilities?format=json');
    result.accessCapabilities = extractFlags(raw?.AccessControl);
  } catch (err) {
    result.errors.push(`AccessControl/capabilities: ${err.message}`);
  }

  // Batas parameter pencarian event
  try {
    const { raw } = await readIsapi(dev, '/ISAPI/AccessControl/AcsEvent/capabilities?format=json');
    const cond = raw?.AcsEvent?.AcsEventCond || {};
    result.eventCapabilities = {
      maxResults: cond.maxResults?.['@max'] ?? cond.maxResults?.max ?? null,
      searchResultPositionMax: cond.searchResultPosition?.['@max'] ?? null,
      searchIDMax: cond.searchID?.['@max'] ?? null,
      majorOptions: cond.major?.['@opt'] ?? null,
    };
  } catch (err) {
    result.errors.push(`AcsEvent/capabilities: ${err.message}`);
  }

  return result;
}

/** Status kerja pintu (kunci, magnet,-power, tamper) — real-time. */
export async function getDoorWorkStatus(dev) {
  try {
    const { raw } = await readIsapi(dev, '/ISAPI/AccessControl/AcsWorkStatus?format=json');
    const s = raw?.AcsWorkStatus || {};
    return {
      online: true,
      doorLockStatus: s.doorLockStatus ?? null,
      doorStatus: s.doorStatus ?? null,
      magneticStatus: s.magneticStatus ?? null,
      powerSupplyStatus: s.powerSupplyStatus || '-',
      hostAntiDismantleStatus: s.hostAntiDismantleStatus || '-',
      cardReaderOnlineStatus: s.cardReaderOnlineStatus ?? null,
      cardReaderAntiDismantleStatus: s.cardReaderAntiDismantleStatus || '-',
    };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

/** Jam perangkat + zona waktu + mode sinkronisasi. */
export async function getDeviceTime(dev) {
  try {
    const { raw } = await readIsapi(dev, '/ISAPI/System/time?format=json');
    const t = raw?.Time || {};
    return {
      online: true,
      timeMode: t.timeMode || '-',
      localTime: t.localTime || '-',
      timeZone: t.timeZone || '-',
      noNewTimeZone: t.noNewTimeZone ?? null,
    };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

/** Konfigurasi jaringan (IP, MAC, DHCP) dari daftar interface. */
export async function getNetworkInfo(dev) {
  try {
    const { raw } = await readIsapi(dev, '/ISAPI/System/Network/interfaces?format=json');
    const list = raw?.NetworkInterfaceList?.NetworkInterface || [];
    const arr = Array.isArray(list) ? list : (list ? [list] : []);
    return {
      online: true,
      interfaces: arr.map((it) => ({
        id: it.id ?? null,
        ipAddress: it?.IPAddress?.ipAddress || '-',
        ipv6Address: it?.IPAddress?.ipv6Address || '-',
        macAddress: it?.MACAddress?.macAddress || '-',
        addressingType: it?.IPAddress?.addressingType || '-',
        gateway: it?.IPAddress?.gateway || '-',
        dnsServers: it?.IPAddress?.dnsServers || '-',
      })),
    };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

/**
 * Ringkasan gabungan untuk semua perangkat — sumber data tab "Ringkasan".
 * Setiap perangkat dipanggil paralel; kegagalan satu tidak menggagalkan yang lain.
 */
export async function getOverview() {
  const devs = listDevices();
  const results = await Promise.all(
    devs.map(async (dev) => {
      const [caps, work, time, net] = await Promise.all([
        getDeviceCapabilities(dev),
        getDoorWorkStatus(dev),
        getDeviceTime(dev),
        getNetworkInfo(dev),
      ]);
      return {
        ...caps,
        work,
        time,
        network: net,
      };
    })
  );
  return { devices: results, generatedAt: new Date().toISOString() };
}

// ─── Manajemen pengguna di perangkat ────────────────────────────────────────────
//
// PENTING — APA YANG SEBENARNYA DIDUKUNG FIRMWARE (hasil probe live ke
// 192.168.89.241 dan .240, 2026-11-10):
//
//   ✅ DIDUKUNG
//     GET  /ISAPI/AccessControl/UserInfo/Search    → baca user
//     PUT  /ISAPI/AccessControl/UserInfo/Modify    → ubah user (WAJIB payload lengkap)
//     POST /ISAPI/AccessControl/UserInfo/Search    → cari user
//
//   ❌ TIDAK DIDUKUNG (sudah dicoba ~90 kombinasi payload/endpoint)
//     POST/PUT /ISAPI/AccessControl/UserInfo/Add         → notSupport
//     PUT      /ISAPI/AccessControl/UserInfo/Delete      → badParameters
//     PUT      /ISAPI/AccessControl/UserInfoDetail/Delete→ MessageParametersLack
//     POST/DELETE pada UserInfo/Delete                  → methodNotAllowed
//     perubahan employeeNo lewat Modify                 → badParameters
//
//   Catatan: peta kapabilitas MEMANG melaporkan `isSupportUserInfoDetailDelete
//   = true`, tapi endpoint itu tetap menolak dengan MessageParametersLack
//   untuk semua bentuk payload yang dicoba. Jadi kode tidak boleh menjanjikan
//   hard-delete.
//
//   Konsekuensi untuk aplikasi:
//     - "Tambah user" di perangkat = TIDAK BISA. User baru harus dibuat dari
//       layar perangkat, lalu bisa disinkronkan ke DB aplikasi.
//     - "Hapus user" di perangkat = TIDAK BISA secara fisik. Yang bisa
//       dilakukan adalah DISABLE (Valid.enable=false) — sudah diverifikasi
//       berhasil pada user uji.
//     - "Perbaikan ID" = TIDAK BISA di perangkat (employeeNo immutable).
//       Dilakukan di sisi APLIKASI lewat tabel employee_id_aliases.

/**
 * Ambil daftar user dari SATU perangkat dengan bentuk ternormalisasi.
 * Field `name` bisa kosong di perangkat — simpan apa adanya supaya UI bisa
 * menandai "nama belum diisi" alih-alih menebak.
 */
export async function getDeviceUsers(dev) {
  const raw = await fetchAllUsers(dev);
  return raw.map((u) => ({
    employeeNo: String(u.employeeNo ?? u.employeeNoString ?? '').trim(),
    name: (u.name || '').trim(),
    userType: u.userType || 'normal',
    valid: u.Valid?.enable ?? null,
    validBegin: u.Valid?.beginTime || null,
    validEnd: u.Valid?.endTime || null,
    cardNo: u.cardNo || null,
    doorRight: u.doorRight ?? null,
    rightPlans: Array.isArray(u.RightPlan) ? u.RightPlan : (u.RightPlan ? [u.RightPlan] : []),
  })).filter((u) => u.employeeNo);
}

/**
 * Bangun payload Modify yang lengkap.
 *
 * PENGAMATAN PENTING (hasil probe ke perangkat nyata):
 *   `PUT /ISAPI/AccessControl/UserInfo/Modify` membalas 400 dengan
 *   `MessageParametersLack` bila payload tidak menyertakan hak akses.
 *   Field WAJIB: `doorRightList`, `rightPermission`, `privilege`.
 *   Perubahan yang berhasil pada probe: menambah `doorRightList` → 200 OK.
 *
 * Karena itu semua field hak akses SELALU disertakan, Even kalau tidak berubah.
 */
function buildUserPayload(user, { name, userType, validBegin, validEnd } = {}) {
  const begin = validBegin || user.validBegin || '1970-01-01T08:00:00+08:00';
  const end = validEnd || user.validEnd || '2037-12-31T23:59:59+08:00';
  const type = userType || user.userType || 'normal';

  return {
    UserInfo: {
      employeeNo: user.employeeNo,
      name: name ?? user.name,
      userType: type,
      closeDelayEnabled: false,
      Valid: {
        enable: user.valid ?? true,
        timeType: 'UTC',
        beginTime: begin,
        endTime: end,
      },
      password: '',
      doorRight: user.doorRight != null ? String(user.doorRight) : '1',
      RightPlan: user.rightPlans.length ? user.rightPlans : [{ doorNo: 1, planTemplateNo: '1' }],
      maxOpenDoorTime: 0,
      openDoorTime: 0,
      localUIRight: true,
      userVerifyMode: '',
      // ── Field hak akses WAJIB agar Modify tidak ditolak perangkat ──
      doorRightList: [{ doorNo: 1, rightType: 'all' }],
      rightPermission: {
        doorNo: [1],
        doorRight: {
          door: {
            privilege: { card: false, face: false, fingerprint: false, keypad: false },
          },
        },
      },
      privilege: { card: [], face: [], fingerprint: [], keypad: [] },
      faceEnabled: false,
      cardEnabled: false,
      fingerprintEnabled: false,
      faceIndex: 0,
      cardIndex: 0,
      fingerprintIndex: 0,
      faceUrl: '',
      cardNo: user.cardNo || '',
      fingerprintUrl: '',
      validEnd: end,
      groupId: '1',
      invalidUserType: 'invalid',
      firstTime: begin,
      lastTime: end,
    },
  };
}

/**
 * Ubah data user di perangkat (nama / tipe / masa berlaku).
 *
 * Mengembalikan bentuk yang JUJUR: kalau perangkat menolak, error asli
 * perangkat diteruskan apa adanya (subStatusCode + pesan) — bukan
 * berhasil generik yang membuat user mengira perubahan sudah tersimpan.
 */
export async function updateDeviceUser(dev, employeeNo, changes = {}) {
  const users = await getDeviceUsers(dev);
  const target = users.find((u) => u.employeeNo === String(employeeNo));
  if (!target) {
    const err = new Error(`User "${employeeNo}" tidak ada di perangkat ${dev.label}`);
    err.status = 404;
    throw err;
  }

  const payload = buildUserPayload(target, changes);
  try {
    const resp = await digestRequest({
      url: `http://${dev.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`,
      method: 'PUT',
      data: payload,
      username: dev.username,
      password: dev.password,
      timeout: 10000,
    });
    return { success: true, deviceKey: dev.type, employeeNo: String(employeeNo), response: resp.data };
  } catch (err) {
    // Terjemahkan error perangkat menjadi pesan yang bisa dimengerti.
    const sub = err.response?.data?.subStatusCode || '';
    const status = err.response?.status;
    const e = new Error(
      `Perangkat menolak perubahan (HTTP ${status}${sub ? ` / ${sub}` : ''}): ${err.message}`
    );
    e.status = status === 400 ? 422 : 502;
    e.deviceSubStatus = sub;
    throw e;
  }
}

/**
 * Batas masa berlaku maksimum yang aman untuk perangkat.
 *
 * PENTING — TEMUAN DARI PROBE LIVE:
 *   Saat user dinonaktifkan, perangkat MEMBATAS `Valid.endTime` ke
 *   "2038-01-01T07:59:59+08:00" (= 2037-12-31T23:59:59Z, batas representasi
 *   32-bit). Nilai itu SEHARUSNYA aman, tapi perangkat MENOLAK Modify yang
 *   mengirimnya kembali bersama `Valid.enable=true` dengan badParameters.
 *
 *   Verifikasi (device Keluar, employeeNo 11):
 *     enable=true  + endTime 2038-01-01T07:59:59+08:00 → 400 badParameters
 *     enable=true  + endTime 2037-12-31T23:59:59+08:00 → 200 OK
 *     enable=false + endTime 2038-01-01T07:59:59+08:00 → 200 OK
 *
 *   Jadi saat MENGHIDUPKAN user, endTime dari perangkat harus dinormalisasi
 *   ke nilai yang aman — kalau tidak, user tidak bisa diaktifkan kembali
 *   dan terkunci nonaktif permanen.
 */
const SAFE_VALID_END = '2037-12-31T23:59:59+08:00';
const SAFE_VALID_BEGIN = '1970-01-01T08:00:00+08:00';

/**
 * Normalisasi Valid.beginTime / Valid.endTime.
 *
 * Nilai dari perangkat dipakai apa adanya KECUALI endTime yang menyentuh
 * batas 2038 — kasus itu disetel ke SAFE_VALID_END.
 *
 * @param {object} valid objek Valid dari perangkat
 * @returns {{enable: boolean, timeType: string, beginTime: string, endTime: string}}
 */
function normalizeValid(valid = {}) {
  const begin = valid.beginTime || SAFE_VALID_BEGIN;
  let end = valid.endTime || SAFE_VALID_END;

  // Deteksi batas 2038 (dalam berbagai representasi) dan ganti dengan
  // nilai yang terbukti diterima perangkat.
  const endYear = Number(String(end).slice(0, 4));
  if (endYear >= 2038) end = SAFE_VALID_END;

  return {
    enable: valid.enable ?? true,
    timeType: valid.timeType || 'UTC',
    beginTime: begin,
    endTime: end,
  };
}

/**
 * Aktifkan / nonaktifkan (disable) user di perangkat.
 *
 * MENGAPA DISABLE, BUKAN DELETE:
 *   Firmware perangkat ini menolak hard-delete (`UserInfo/Delete` →
 *   badParameters, `UserInfoDetail/Delete` → MessageParametersLack — sudah
 *   diverifikasi ke dua perangkat nyata dengan ~90 kombinasi payload).
 *   Sebaliknya `Valid.enable=false` pada Modify terbukti berhasil (terverifikasi
 *   pada user uji: flag berubah true → false → true).
 *
 *   Efeknya sama dengan hapus dari sisi operasional: user tidak lagi bisa
 *   absen, tapi datanya tetap ada untuk audit.
 *
 * @param {object} dev konfigurasi perangkat
 * @param {string} employeeNo
 * @param {boolean} enable true = aktifkan, false = nonaktifkan
 * @returns {Promise<object>}
 */
export async function setDeviceUserEnabled(dev, employeeNo, enable) {
  const users = await getDeviceUsers(dev);
  const target = users.find((u) => u.employeeNo === String(employeeNo));
  if (!target) {
    const err = new Error(`User "${employeeNo}" tidak ada di perangkat ${dev.label}`);
    err.status = 404;
    throw err;
  }

  // Bangun payload Modify lengkap, lalu hanya ubah Valid.enable.
  // Field hak akses (doorRightList/rightPermission/privilege) WAJIB disertakan
  // — tanpa itu perangkat membalas MessageParametersLack.
  const payload = buildUserPayload(target, {
    name: target.name,
    userType: target.userType,
    validBegin: target.validBegin,
    validEnd: target.validEnd,
  });

  // Valid dari perangkat, lalu endTime dinormalisasi (lihat SAFE_VALID_END).
  payload.UserInfo.Valid = normalizeValid(target.valid);

  // Saat MENGAKTIFKAN, endTime batas wajib diganti — kalau tidak, perangkat
  // menolak dengan badParameters dan user terkunci nonaktif permanen.
  if (enable) {
    payload.UserInfo.Valid.enable = true;
  } else {
    payload.UserInfo.Valid.enable = false;
  }

  // Field duplikat di luar Valid harus ikut konsisten, kalau tidak perangkat
  // bisa menolak (sudah terbukti: invalidUserType/validEnd ikut affects).
  payload.UserInfo.validEnd = payload.UserInfo.Valid.endTime;
  payload.UserInfo.firstTime = payload.UserInfo.Valid.beginTime;
  payload.UserInfo.lastTime = payload.UserInfo.Valid.endTime;

  try {
    const resp = await digestRequest({
      url: `http://${dev.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`,
      method: 'PUT',
      data: payload,
      username: dev.username,
      password: dev.password,
      timeout: 10000,
    });
    return {
      success: true,
      deviceKey: dev.type,
      employeeNo: String(employeeNo),
      enabled: !!enable,
      response: resp.data,
    };
  } catch (err) {
    const sub = err.response?.data?.subStatusCode || '';
    const status = err.response?.status;
    const e = new Error(
      `Perangkat menolak perubahan status (HTTP ${status}${sub ? ` / ${sub}` : ''}): ${err.message}`
    );
    e.status = status === 400 ? 422 : 502;
    e.deviceSubStatus = sub;
    throw e;
  }
}

/**
 * Kapabilitas tulis user yang diverifikasi untuk perangkat ini.
 *
 * Dipakai UI agar hanya menampilkan aksi yang benar-benar bisa berhasil.
 * Jangan hardcode daftar ini di frontend — kirim dari server.
 */
export function getUserWriteCapabilities() {
  return {
    canAddUser: false,
    canDeleteUser: false,
    canModifyUser: true,
    canEnableDisableUser: true,
    canChangeEmployeeNo: false,
    notes: {
      addUser: 'Firmware perangkat menolak UserInfo/Add (notSupport) — user baru harus dibuat dari layar perangkat lalu disinkronkan.',
      deleteUser: 'Firmware perangkat menolak UserInfo/Delete (badParameters) dan UserInfoDetail/Delete (MessageParametersLack). Hapus dilakukan sebagai disable: Valid.enable=false.',
      changeEmployeeNo: 'employeeNo tidak bisa diubah lewat Modify (badParameters). Perbaikan ID dilakukan di sisi aplikasi lewat pemetaan alias.',
    },
  };
}

// ─── Deteksi konflik antar perangkat ───────────────────────────────────────────

/**
 * Bandingkan user di kedua perangkat untuk menemukan:
 *   1. ID yang menunjuk ke NAMA BERBEDA di perangkat berbeda (konflik).
 *   2. User yang hanya ada di satu perangkat (hanya masuk / hanya keluar).
 *
 * Konflik ID adalah masalah nyata: nomor employee adalah kunci lokal pada
 * masing-masing perangkat, sehingga ID yang sama bisa menunjuk orang berbeda
 * di dua perangkat — dan laporan absensi jadi salah orang.
 */
export async function detectConflicts() {
  const devs = listDevices();
  const perDevice = {};

  for (const dev of devs) {
    try {
      const users = await getDeviceUsers(dev);
      perDevice[dev.type] = users.map((u) => ({
        employeeNo: u.employeeNo,
        name: u.name,
        valid: u.valid,
      }));
    } catch (err) {
      perDevice[dev.type] = { error: err.message };
    }
  }

  const keys = Object.keys(perDevice).filter((k) => Array.isArray(perDevice[k]));
  const conflicts = [];
  const onlyIn = {};

  for (const key of keys) {
    onlyIn[key] = [];
  }

  // Gabungkan semua nomor employee yang muncul di perangkat mana pun.
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

    // Konflik: nomor sama, nama berbeda.
    if (names.size > 1) {
      conflicts.push({
        employeeNo: no,
        names: presentKeys.map((k) => ({ deviceKey: k, name: perKey[k].name || '(kosong)' })),
        reason: 'conflict',
      });
      continue;
    }

    // Hanya ada di satu perangkat.
    if (presentKeys.length === 1 && keys.length > 1) {
      const onlyKey = presentKeys[0];
      conflicts.push({
        employeeNo: no,
        names: [{ deviceKey: onlyKey, name: perKey[onlyKey].name || '(kosong)' }],
        reason: 'only_one_device',
      });
      for (const key of keys) {
        if (key === onlyKey) onlyIn[key].push({ employeeNo: no, name: perKey[onlyKey].name });
      }
    }
  }

  return {
    perDevice,
    conflicts,
    onlyIn,
    deviceKeys: keys,
  };
}

/**
 * Sinkronkan nama user dari satu perangkat ke perangkat lain.
 *
 * HANYA menulis ke perangkat yang SUDAH punya user dengan nomor tersebut —
 * perangkat ini menolak `Add`, jadi membuat user baru dari sini tidak
 * mungkin. Karena itu fungsi ini HANYA menyamakan NAMA.
 */
export async function syncUserName(dev, employeeNo, name) {
  return updateDeviceUser(dev, employeeNo, { name });
}

export default {
  listDevices,
  getDeviceByKey,
  getDeviceCapabilities,
  getDoorWorkStatus,
  getDeviceTime,
  getNetworkInfo,
  getOverview,
  getDeviceUsers,
  updateDeviceUser,
  setDeviceUserEnabled,
  getUserWriteCapabilities,
  detectConflicts,
  syncUserName,
};
