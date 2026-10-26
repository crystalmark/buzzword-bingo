// Just enough of a zip reader for Office and OpenOffice documents (.pptx, .docx, .odp, .odt are all zip files), using
// the browser's own decompressor, so no library is needed. Runs in Node too, which is how the tests use it.

const EOCD = 0x06054b50; // end of central directory
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export async function readZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) { end = i; break; }
  }
  if (end < 0) throw new Error('This file isn’t a document we can open');

  const entries = new Map();
  let p = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0; n--) {
    if (view.getUint32(p, true) !== CENTRAL) throw new Error('This document looks damaged');
    const nameLength = view.getUint16(p + 28, true);
    entries.set(new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength)), {
      method: view.getUint16(p + 10, true), size: view.getUint32(p + 20, true), local: view.getUint32(p + 42, true),
    });
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }

  return {
    names: [...entries.keys()],
    async text(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (view.getUint32(e.local, true) !== LOCAL) throw new Error('This document looks damaged');
      const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
      const data = bytes.subarray(start, start + e.size);
      if (e.method === 0) return new TextDecoder().decode(data);
      if (e.method !== 8) throw new Error('This document uses a kind of compression we can’t read');
      const inflated = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new TextDecoder().decode(await new Response(inflated).arrayBuffer());
    },
  };
}
