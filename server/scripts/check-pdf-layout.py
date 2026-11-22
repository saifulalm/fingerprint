#!/usr/bin/env python3
"""Verifikasi layout PDF laporan absensi dengan bounding box asli (PyMuPDF).

Bukan parsing content stream manual: pymupdf memberi kotak batas teks nyata,
jadi tumpang tindih bisa dideteksi akurat (dua kotak yang saling Memotong
pada area yang sama).
"""
import sys
import pymupdf

pdf_path = sys.argv[1]
doc = pymupdf.open(pdf_path)
print(f"PDF: {pdf_path}  halaman={doc.page_count}")

total_overlap = 0

# ─── Halaman kosong ─────────────────────────────────────────────────────────────
#
# Halaman yang HANYA berisi footer (atau tidak berisi teks isi) adalah
# gejala PDFKit menambah halaman karena teks meluber melewati tepi halaman.
#
# SEBELUMNYA cek ini tidak ada. Footer yang panjang membungkus ke bawah,
# baris-baris itu jatuh di luar halaman → PDFKit menambah halaman kosong →
# dokumen jadi 6 halaman (dari 2) dan nomor halaman jadi salah.
#
#/pages kosong DIHARAPKAN di laporan ini karena tabel panjang terpotong →
# halaman lanjutan tetap punya isi. Yang werdah adalah halaman yang isinya
# cuma footer.
empty_pages = []
for pno in range(doc.page_count):
    page = doc[pno]
    # Bandingkan jumlah kata di area BADAN halaman vs area FOOTER.
    body_words = [w for w in page.get_text("words") if w[3] < page.rect.height - 45]
    if not body_words:
        empty_pages.append(pno + 1)

for pno in empty_pages:
    print(f"  halaman {pno}: HANYA berisi footer (halaman kosong) -> FAIL")


# ─── Header: band navy menutup teks, tanpa tumpang tindih ─────────────
#
# Header PDF = judul + [subjudul] + periode + meta. Semuanya harus berada
# di dalam band navy (yang tingginya dihitung dari tinggi terukur), dan
# baris-barisnya tidak boleh saling tumpang tindih.
#
# Cek ini menutup dua kelas regresi:
#   - headerH tidak ikut tumbuh saat subjudul ada → subjudul menabrak periode
#   - posisi Y salah → dua baris header tumpang tindih
header_problems = 0
page0 = doc[0]
band_bottom = None
for dr in page0.get_drawings():
    r = dr["rect"]
    # Band navy = gambar penuh lebar yang dimulai di y=0.
    if r.width > page0.rect.width * 0.9 and r.y0 < 2 and r.height > 20:
        band_bottom = max(band_bottom or 0, r.y1)

if band_bottom is None:
    print("  header: band navy tidak ditemukan → FAIL")
    header_problems += 1
else:
    # Semua teks yang cautionary: judul, subjudul, periode, meta — semuanya
    # ada di area header (sebelum kartu statistik). Ambil SEMUA span di
    # bagian atas halaman, lalu NILAI posisinya terhadap band.
    #
    # PENTING: jangan menyaring span dengan `y < band_bottom` — dengan band
    # yang terlalu pendek (bug lama `headerH = 74`), baris meta justru
    # BERADA di luar band dan akan TIDAK ikut terambil, sehingga cek lolos
    # sia-sia. Ambil semua span, lalu periksa relatif terhadap band.
    hdr_spans = []
    for b in page0.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        for l in b["lines"]:
            for s in l["spans"]:
                hdr_spans.append((s["bbox"], s["text"], s["size"]))
    hdr_spans.sort(key=lambda x: x[0][1])

    # Header = blok TEKS di band: judul (17pt), subjudul (9pt italic),
    # periode (9pt), meta (7.5pt). Kartu statistik (angka 18pt) berada DI
    # BAWAH band — itu bukan header.
    #
    # Kriteria: span yang ada DI DALAM band, ATAU yang tepat di bawahnya
    # (span yang keluar band = kandidat bocor). Ambil maksimal 8 baris
    # teratas supaya kartu statistik tidak ikut terambil.
    header_spans = [s for s in hdr_spans if s[0][1] < band_bottom + 60][:8]
    # Buang yang jelas bukan header: angka besar kartu statistik (>= 14pt).
    header_spans = [s for s in header_spans if s[2] < 14]

    # (a) semua teks header di dalam band
    outside = [(t, bbox) for bbox, t, _ in header_spans if bbox[3] > band_bottom + 1]
    if outside:
        for t, bbox in outside[:3]:
            print(f"  header: teks di luar band → FAIL  y1={bbox[3]:.1f} > {band_bottom:.1f}  {t[:40]!r}")
        header_problems += 1

    # (b) baris-baris header tidak tumpang tindih.
    #
    # Bandingkan setiap span terhadap span SEBELUMNYA yang benar-benar berada
    # di baris berbeda. Span pada baris yang sama (angka kartu statistik di
    # kolom berbeda) BUKAN tumpang tindih.
    #
    # Cara: kelompokkan span berdasarkan baris visual (y0 mirip), lalu cek
    # antar-kelompok: baris berikutnya harus mulai DI BAWAH baris ini.
    groups = []
    for bbox, t, sz in header_spans:
        for g in groups:
            if abs(g["y0"] - bbox[1]) < 2.0:
                g["y0"] = min(g["y0"], bbox[1])
                g["y1"] = max(g["y1"], bbox[3])
                g["texts"].append(t)
                break
        else:
            groups.append({"y0": bbox[1], "y1": bbox[3], "texts": [t]})
    groups.sort(key=lambda g: g["y0"])

    for i in range(len(groups) - 1):
        a, b = groups[i], groups[i + 1]
        if b["y0"] < a["y1"] - 0.5:
            print(f"  header: baris tumpang tindih \u2192 FAIL  ({a['texts'][0][:26]!r} vs {b['texts'][0][:26]!r})")
            header_problems += 1
            break

    if header_problems == 0:
        print(f"  header OK: band {band_bottom:.1f}pt, {len(hdr_spans)} baris, tanpa tumpang tindih")

for pno in range(doc.page_count):
    page = doc[pno]
    words = page.get_text("words")  # x0,y0,x1,y1,word,block,line,wordno
    # Kelompokkan kata menjadi baris visual berdasarkan y0 yang Similar
    lines = []
    for w in words:
        placed = False
        for ln in lines:
            if abs(ln["y0"] - w[1]) < 2.0:
                ln["words"].append(w)
                ln["y0"] = min(ln["y0"], w[1])
                ln["y1"] = max(ln["y1"], w[3])
                placed = True
                break
        if not placed:
            lines.append({"y0": w[1], "y1": w[3], "words": [w]})
    lines.sort(key=lambda l: l["y0"])

    # Deteksi baris yang saling tumpang tindih secara VERTIKAL pada kolom sama
    overlaps = []
    for i in range(len(lines)):
        for j in range(i + 1, len(lines)):
            a, b = lines[i], lines[j]
            if b["y0"] >= a["y1"] - 0.5:
                break  # terurut, tidak mungkin overlap lagi
            # cakupan x yang sama
            ax0 = min(w[0] for w in a["words"]); ax1 = max(w[2] for w in a["words"])
            bx0 = min(w[0] for w in b["words"]); bx1 = max(w[2] for w in b["words"])
            if min(ax1, bx1) - max(ax0, bx0) > 2:
                overlaps.append((a, b))

    status = "OK" if not overlaps else "FAIL"
    print(f"  halaman {pno+1}: {len(lines)} baris, {len(overlaps)} tumpang tindih -> {status}")
    for a, b in overlaps[:6]:
        at = " ".join(w[4] for w in a["words"])[:60]
        bt = " ".join(w[4] for w in b["words"])[:60]
        print(f"     A y={a['y0']:.1f}-{a['y1']:.1f}: {at}")
        print(f"     B y={b['y0']:.1f}-{b['y1']:.1f}: {bt}")
    total_overlap += len(overlaps)

print("HASIL:", "OK tidak ada tumpang tindih" if total_overlap == 0 else f"FAIL {total_overlap} tumpang tindih")
if empty_pages:
    print(f"FAIL {len(empty_pages)} halaman kosong (hanya footer): {empty_pages}")
    sys.exit(1)
if header_problems:
    print(f"FAIL {header_problems} masalah pada header PDF")
    sys.exit(1)
sys.exit(0 if total_overlap == 0 else 1)
