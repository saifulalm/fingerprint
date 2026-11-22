// Device roster — pencocokan user antar perangkat berdasarkan NAMA.
//
// MASALAH YANG DISELESAIKAN:
//
//   Nomor employee adalah kunci LOKAL tiap perangkat. Dua perangkat punya
//   penomoran yang BERBEDA untuk orang yang sama:
//
//     Fingerprint In  (masuk)          Fingerprint Out (keluar)
//     2  Saiful                        2  Saiful
//     3  Astrid                        3  Astrid
//     4  Chika                         4  Chika
//     5  Juanto                       5  Adit      ← nomor 5 = orang BERBEDA
//     6  Adit                         6  Chika     ← nomor 6 = orang BERBEDA
//     7  (tidak ada)                   7  Juanto    ← hanya ada di keluar
//     8  Cepi                         8  Cepi
//     9  Dian                         9  Dian
//     10 Ibu Christina               10 Ibu Christina
//     11 Brook                       11 Brook
//
//   Karena itu pencocokan HARUS berbasis NAMA, bukan nomor. Alias di
//   `employee_id_aliases` hanya menangani kasus "nomor sama, nama berbeda".
//   Kasus "seseorang HANYA ada di satu perangkat" (mis. No.7 Juanto hanya
//   ada di keluar) TIDAK punya alias — dan itulah sumber laporan yang
//   salah/tKosong.
//
// APA YANG FUNGSI INI LAKUKAN:
//
//   1. Membaca roster user dari MASING-MASING perangkat (live).
//   2. Mencocokkan antar perangkat berdasarkan nama (case-insensitive,
//      dinormalisasi: spasi ganda, spasi di awal/akhir).
//   3. Menghasilkan 3 kelompok hasil:
//      - MATCHED  : nama sama, nomor BERBEDA → butuh alias
//      - MISSING  : ada di satu perangkat saja → user belum terdaftar
//                   di perangkat itu (tidak bisa di-fix di perangkat, tapi
//                   bisa dicatat supaya tidak salah orang di laporan)
//      - CONFLICT : nama sama persis, nomor sama → sudah cocok
//   4. Untuk MATCHED: menghasilkan alias yang benar dengan arah yang
//      benar (nomor di perangkat non-referensi → nomor di perangkat
//      referensi).
//
// CATATAN PENTING SOAL ALAS:
//   Alias yang sudah ada di `employee_id_aliases` harus DIJAGA dan tidak
//   ditimpa. Fungsi ini hanya MENARIK alias yang valid — alias yang ada
//   tetap dipakai apa adanya.

import prisma from '../db.js';
import { CANONICAL_DEVICE_KEY } from './employeeIdentityService.js';

/**
 * Normalkan nama supaya pencocokan tahan variasi penulisan.
 *
 * "Adit ", "adit", "ADIT" → semua jadi "adit".
 * Spasi di tengah juga diratakan ("Ibu  Christina" → "ibu christina").
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeRosterName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Hitung daftar user per perangkat dari data perangkat (live).
 *
 * @param {object} devices map deviceKey → konfigurasi perangkat
 * @param {Function} getUsers async (dev) => [{ employeeNo, name }]
 * @returns {Promise<Record<string, {employeeNo:string,name:string}[]>>}
 */
export async function fetchDeviceRosters(devices, getUsers) {
  const perDevice = {};

  for (const [key, dev] of Object.entries(devices)) {
    try {
      const users = await getUsers(dev);
      perDevice[key] = users
        .map((u) => ({
          employeeNo: String(u.employeeNo ?? '').trim(),
          name: String(u.name ?? '').trim(),
        }))
        // User tanpa nomor tidak bisa dicocokkan — lewati.
        .filter((u) => u.employeeNo && u.name);
    } catch (err) {
      // Perangkat gagal dihubungi TIDAK boleh disamakan dengan "tidak ada
      // user". Statusnya disimpan supaya UI bisa menampilkan "offline".
      perDevice[key] = { error: err.message };
    }
  }

  return perDevice;
}

/**
 * Cocokkan roster antar perangkat berdasarkan nama.
 *
 * @param {Record<string, {employeeNo:string,name:string}[]|{error:string}>} perDevice
 * @param {string} referenceKey perangkat yang nomornya jadi canonical
 * @returns {object} hasil pencocokan
 */
export function matchRostersByName(perDevice, referenceKey = CANONICAL_DEVICE_KEY, existingAliases = null) {
  const keys = Object.keys(perDevice).filter((k) => Array.isArray(perDevice[k]));
  const offline = Object.keys(perDevice).filter((k) => perDevice[k]?.error);

  const refUsers = perDevice[referenceKey];
  if (!Array.isArray(refUsers)) {
    return {
      ok: false,
      reason: `Data perangkat referensi "${referenceKey}" tidak tersedia`,
      offline,
      matched: [], missing: [], conflicts: [],
    };
  }

  // Alias yang sudah ada dipakai sebagai PETUNJUK untuk memilih nomor
  // yang benar ketika satu nama muncul LEBIH DARI SATU KALI di satu
  // perangkat.
  //
  // KASUS NYATA: device "keluar" punya No.4 = Chika DAN No.6 = Chika.
  // Device "masuk" hanya punya No.4 = Chika. Tanpa petunjuk, pencocokan
  // akan menganggap No.4 (keluar) = No.4 (masuk) → sudah cocok, dan
  // No.6 (keluar) tidak pernah dipetakan.
  //
  // padahal alias yang sudah ada memberi tahu: `keluar:6 → 4` — jadi
  // Chika yang sebenarnya di "keluar" adalah nomor 6, dan nomor 4 di
  // "keluar" adalah orang LAIN (Chika juga, tapi datanya duplikat).
  //
  // Alias existing dipakai untuk MEMILIH pasangan mana yang benar, bukan
  // untuk membuat alias baru (itu tugas `diffAgainstExistingAliases`).
  const aliasHint = new Map();
  const aliasList = Array.isArray(existingAliases)
    ? existingAliases
    : [...(existingAliases?.entries?.() || [])].map(([key, employeeNo]) => {
        const [deviceKey, deviceEmployeeNo] = key.split(':');
        return { deviceKey, deviceEmployeeNo, employeeNo };
      });
  for (const a of aliasList) {
    aliasHint.set(`${a.deviceKey}:${a.deviceEmployeeNo}`, a.employeeNo);
  }

  // ── Peta nama → SEMUA user dengan nama itu, per perangkat ────────────────
  //
  // PENTING: satu nama bisa muncul LEBIH DARI SATU KALI di satu perangkat.
  // Data nyata: device "keluar" punya No.4 = Chika DAN No.6 = Chika.
  // Kalau hanya menyimpan user pertama, nomor kedua akan hilang dan
  // alias-nya tidak pernah ditemukan — persis kasus Chika di repo ini.
  //
  // Jadi setiap nama menyimpan DAFTAR user, bukan satu user.
  const byName = new Map();   // namaNormalized → { deviceKey → [user, ...] }
  for (const key of keys) {
    for (const u of perDevice[key]) {
      const n = normalizeRosterName(u.name);
      if (!n) continue;
      if (!byName.has(n)) byName.set(n, new Map());
      const perDev = byName.get(n);
      if (!perDev.has(key)) perDev.set(key, []);
      perDev.get(key).push(u);
    }
  }

  const matched = [];
  const missing = [];
  const conflicts = [];

  for (const [normName, perDev] of byName) {
    const refList = perDev.get(referenceKey) || [];

    // ── Nomor di perangkat LAIN untuk nama yang sama ────────────────────────
    for (const key of keys) {
      if (key === referenceKey) continue;
      const others = perDev.get(key) || [];

      // Nomor yang sudah dipakai di referensi pada nama ini.
      const refNos = new Set(refList.map((u) => u.employeeNo));

      // Nomor referensi yang BELUM dipakai di perangkat ini.
      const refFree = refList.filter((u) => !others.some((x) => x.employeeNo === u.employeeNo));

      // 1. Nomor SAMA → sudah benar, KECUALI bila alias existing
      //    menyatakan nomor itu sebenarnya milik nomor referensi yang lain.
      for (const o of others) {
        if (!refNos.has(o.employeeNo)) continue;

        // Alias existing untuk nomor ini (di perangkat non-acuan).
        const hinted = aliasHint.get(`${key}:${o.employeeNo}`);

        // Bila alias menunjuk nomor referensi yang LAIN, nomor ini bukan
        // pasangan yang benar → tangani sebagai nomor berbeda (bagian 2).
        if (hinted && hinted !== o.employeeNo && refNos.has(hinted)) continue;

        const refHit = refList.find((u) => u.employeeNo === o.employeeNo);
        conflicts.push({
          reason: 'same_number',
          name: refHit?.name || o.name,
          reference: { deviceKey: referenceKey, employeeNo: refHit?.employeeNo || o.employeeNo, name: refHit?.name || o.name },
          other: { deviceKey: key, employeeNo: o.employeeNo, name: o.name },
        });
      }

      // 2. Nomor BERBEDA → butuh alias. Pasangkan dengan nomor referensi
      //    yang belum terpakai di perangkat ini.
      //
      //    Urutan pasangan ditentukan oleh PETUNJUK alias existing: kalau
      //    alias `key:no → refNo` sudah ada, nomor itu PASANGANNYA refNo.
      const refCursor = 0;
      const refUsed = new Set();

      // Pasangan yang ditentukan alias existing (diprioritaskan).
      const hintedPairs = [];
      for (const o of others) {
        const hinted = aliasHint.get(`${key}:${o.employeeNo}`);
        if (!hinted || hinted === o.employeeNo) continue;
        const refHit = refList.find((u) => u.employeeNo === hinted);
        if (!refHit) continue;
        hintedPairs.push({ o, refHit });
        refUsed.add(refHit.employeeNo);
      }

      for (const { o, refHit } of hintedPairs) {
        matched.push({
          reason: 'number_mismatch',
          name: refHit.name,
          reference: { deviceKey: referenceKey, employeeNo: refHit.employeeNo, name: refHit.name },
          other: { deviceKey: key, employeeNo: o.employeeNo, name: o.name },
          suggestedAlias: {
            deviceKey: key,
            deviceEmployeeNo: o.employeeNo,
            employeeNo: refHit.employeeNo,
          },
          fromExistingAlias: true,
        });
      }

      for (const o of others) {
        if (refNos.has(o.employeeNo)) continue;   // sudah dicatat "sama"
        if (refUsed.has(o.employeeNo)) continue;  // sudah dipasangkan
        if (hintedPairs.some((p) => p.o.employeeNo === o.employeeNo)) continue;

        const refHit = refFree.find((u) => !refUsed.has(u.employeeNo));
        if (!refHit) continue;                   // tidak ada nomor referensi tersisa
        refUsed.add(refHit.employeeNo);

        matched.push({
          reason: 'number_mismatch',
          name: refHit.name,
          reference: { deviceKey: referenceKey, employeeNo: refHit.employeeNo, name: refHit.name },
          other: { deviceKey: key, employeeNo: o.employeeNo, name: o.name },
          suggestedAlias: {
            deviceKey: key,
            deviceEmployeeNo: o.employeeNo,
            employeeNo: refHit.employeeNo,
          },
        });
      }
    }

    // ── Ada di referensi tapi TIDAK ada di salah satu perangkat lain ───────
    for (const key of keys) {
      if (key === referenceKey) continue;
      const others = perDev.get(key) || [];
      if (others.length) continue;

      const refHit = refList[0];
      if (!refHit) continue;
      missing.push({
        reason: 'missing_on_device',
        name: refHit.name,
        presentOn: { deviceKey: referenceKey, employeeNo: refHit.employeeNo },
        missingOn: key,
      });
    }

    // ── Hanya ada di perangkat LAIN (bukan di referensi) ────────────────────
    if (refList.length === 0) {
      for (const key of keys) {
        if (key === referenceKey) continue;
        for (const u of perDev.get(key) || []) {
          missing.push({
            reason: 'only_on_other_device',
            name: u.name,
            presentOn: { deviceKey: key, employeeNo: u.employeeNo },
            missingOn: referenceKey,
          });
        }
      }
    }
  }

  return { ok: true, offline, matched, missing, conflicts };
}

/**
 * Alias yang perlu dibuat, DIBANDINGKAN dengan alias yang sudah ada.
 *
 * Alias yang sudah ada tidak boleh ditimpa — kalau sudah ada untuk
 * (deviceKey, deviceEmployeeNo), pakai yang existing.
 *
 * @param {object} match hasil matchRostersByName
 * @param {Map<string,string>|Array} existingAliases
 * @returns {{ toCreate: object[], existing: object[], conflicts: object[] }}
 */
export function diffAgainstExistingAliases(match, existingAliases) {
  const existing = new Map();
  const list = Array.isArray(existingAliases)
    ? existingAliases
    : [...(existingAliases || new Map()).entries()].map(([key, employeeNo]) => {
        const [deviceKey, deviceEmployeeNo] = key.split(':');
        return { deviceKey, deviceEmployeeNo, employeeNo };
      });

  for (const a of list) {
    existing.set(`${a.deviceKey}:${a.deviceEmployeeNo}`, a.employeeNo);
  }

  const toCreate = [];
  const alreadyThere = [];
  const conflicting = [];

  for (const m of match.matched) {
    const key = `${m.suggestedAlias.deviceKey}:${m.suggestedAlias.deviceEmployeeNo}`;
    const current = existing.get(key);

    if (!current) {
      toCreate.push({
        ...m.suggestedAlias,
        name: m.name,
        note: `Nomor ${m.suggestedAlias.deviceEmployeeNo} di device ${m.suggestedAlias.deviceKey} sebenarnya ${m.name}`,
      });
      continue;
    }

    if (current === m.suggestedAlias.employeeNo) {
      alreadyThere.push({ ...m.suggestedAlias, name: m.name });
    } else {
      conflicting.push({
        ...m.suggestedAlias,
        name: m.name,
        existingEmployeeNo: current,
        note: 'Alias yang ada menunjuk nomor lain — perlu ditinjau manual.',
      });
    }
  }

  return { toCreate, existing: alreadyThere, conflicts: conflicting };
}

/**
 * Ringkasan singkat hasil pencocokan untuk ditampilkan ke user.
 *
 * @param {object} match
 * @param {object} diff
 */
export function summarizeRosterMatch(match, diff) {
  return {
    ok: match.ok,
    offline: match.offline || [],
    matchedCount: match.matched?.length || 0,
    missingCount: match.missing?.length || 0,
    conflictCount: (match.conflicts?.length || 0) + (diff?.conflicts?.length || 0),
    toCreateCount: diff?.toCreate?.length || 0,
    existingCount: diff?.existing?.length || 0,
  };
}

/**
 * Baca alias yang sudah ada dari DB.
 * @returns {Promise<Array<{deviceKey:string,deviceEmployeeNo:string,employeeNo:string,note?:string}>>}
 */
export async function loadExistingAliases() {
  return prisma.employeeIdAlias.findMany({
    orderBy: [{ deviceKey: 'asc' }, { deviceEmployeeNo: 'asc' }],
  });
}

/**
 * Deteksi PERALIHAN ORANG pada satu nomor di perangkat.
 *
 * KASUS NYATA: HR memindahkan user, jadi nomor employee di perangkat berubah
 * seiring waktu:
 *
 *     Periode 1 Okt – 27 Okt      Periode 28 Okt – 11 Nov
 *     No.5 = Juanto               No.5 = Adit
 *
 * Nomor yang sama menunjuk orang BERBEDA di periode berbeda. Ini bukan
 * data rusak — itu riwayat. Tapi kalau laporan memakai nomor sebagai
 * identitas, hasil aggregasinya bisa salah orang.
 *
 * Fungsi ini membandingkan nama per Periode, lalu melaporkan nomor yang
 * punya lebih dari satu nama berbeda.
 *
 * @param {Array<{employeeNo:string,employeeName:string,deviceKey:string,time:Date}>} records
 * @returns {Map<string, {deviceKey:string, employeeNo:string, names:Array<{name:string,count:number,from:string,to:string}>}>}
 */
export function detectEmployeeNumberReassignments(records) {
  // Kunci: deviceKey + employeeNo + nama → info periode.
  const buckets = new Map();

  for (const r of records) {
    const key = `${r.deviceKey}|${r.employeeNo}|${r.employeeName}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        deviceKey: r.deviceKey,
        employeeNo: String(r.employeeNo),
        name: r.employeeName,
        count: 0,
        from: r.time,
        to: r.time,
      });
    }
    const b = buckets.get(key);
    b.count++;
    if (r.time < b.from) b.from = r.time;
    if (r.time > b.to) b.to = r.time;
  }

  // Kelompokkan per (deviceKey, employeeNo).
  const byNo = new Map();
  for (const b of buckets.values()) {
    const key = `${b.deviceKey}|${b.employeeNo}`;
    if (!byNo.has(key)) byNo.set(key, []);
    byNo.get(key).push(b);
  }

  // Nomor dengan >1 nama → sudah dipakai lebih dari satu orang.
  const result = new Map();
  for (const [key, list] of byNo) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.from - b.from);
    result.set(key, {
      deviceKey: list[0].deviceKey,
      employeeNo: list[0].employeeNo,
      names: sorted.map((b) => ({
        name: b.name,
        count: b.count,
        from: b.from.toISOString().slice(0, 10),
        to: b.to.toISOString().slice(0, 10),
      })),
    });
  }

  return result;
}
