// Minimal PDF writer: one JPEG per page, scaled to fill an A4 landscape page (o09).
// Pages are drawn on a canvas first, so Chinese text needs no embedded font.

const A4 = [842, 595];

/** UTF-16BE hex string with BOM, the PDF way to store non-Latin text in /Info */
function pdfText(s) {
  let hex = "FEFF";
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    const units = cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp];
    for (const u of units) hex += u.toString(16).padStart(4, "0").toUpperCase();
  }
  return `<${hex}>`;
}

/** pages: [{ jpeg: Uint8Array, width, height }] (pixel size of the JPEG) → Uint8Array parts of a PDF file */
export function pdfParts(pages, title = "") {
  const enc = new TextEncoder(), parts = [], offsets = [];
  let pos = 0;
  const put = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n, body) => { offsets[n] = pos; put(`${n} 0 obj\n${body}\nendobj\n`); };
  put("%PDF-1.4\n");
  put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker comment
  const kids = pages.map((_, i) => `${4 + i * 3} 0 R`).join(" ");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  obj(3, `<< /Title ${pdfText(title)} /Producer (BlockingPRO) >>`);
  pages.forEach((p, i) => {
    const n = 4 + i * 3, draw = `q ${A4[0]} 0 0 ${A4[1]} 0 0 cm /Im0 Do Q`;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4[0]} ${A4[1]}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    obj(n + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    offsets[n + 2] = pos;
    put(`${n + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    put(p.jpeg);
    put("\nendstream\nendobj\n");
  });
  const count = 4 + pages.length * 3, xref = pos;
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) put(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  put(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return parts;
}

export const PDF_PAGE = A4;
