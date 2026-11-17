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
sys.exit(0 if total_overlap == 0 else 1)
