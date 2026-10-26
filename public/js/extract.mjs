// The text of a document, read in the browser: the file never leaves the device. Returns a suggested title and the
// text in segments — a slide title, a paragraph, a line — each with a weight (titles and headings count for more).
//   PowerPoint .pptx (slides and speaker notes), Word .docx, OpenOffice .odp and .odt, plain text and Markdown: read
//   here, with zip.mjs. PDF: read with pdf.js (vendor/pdfjs, Mozilla, Apache 2.0), loaded only when one is opened.
import { readZip } from './zip.mjs';

export const ACCEPT = '.pptx,.ppsx,.pptm,.potx,.docx,.docm,.dotx,.odp,.odt,.pdf,.txt,.md,.markdown,.text';
export const MAX_BYTES = 100 * 1024 * 1024;
const TITLE = 3; // a slide title or heading counts three times

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };
const decode = s => s
  .replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (m, hex, dec, name) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(+dec) : ENTITIES[name] ?? m);
const all = (xml, re) => xml.match(re) ?? [];
const textOf = (xml, tag) => all(xml, new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))
  .map(t => decode(t.replace(/<[^>]+>/g, ''))).join('');
const tidy = s => s.replace(/\s+/g, ' ').trim();
const byNumber = re => (a, b) => +a.match(re)[1] - +b.match(re)[1];

// ---------- PowerPoint ----------

function pptxShapes(xml, onlyBody = false) {
  const out = [];
  for (const block of [...all(xml, /<p:sp\b[\s\S]*?<\/p:sp>/g), ...all(xml, /<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)]) {
    const ph = block.match(/<p:ph\b[^>]*>/)?.[0];
    const kind = ph ? ph.match(/\btype="(\w+)"/)?.[1] ?? 'body' : null; // a placeholder with no type is body text
    if (onlyBody && kind !== 'body') continue; // in notes, the rest is the slide image and the slide number
    if (['sldNum', 'dt', 'ftr', 'hdr'].includes(kind)) continue;
    const weight = kind === 'title' || kind === 'ctrTitle' ? TITLE : 1;
    for (const p of all(block, /<a:p>[\s\S]*?<\/a:p>|<a:p\s[^>]*>[\s\S]*?<\/a:p>/g)) {
      const text = tidy(textOf(p.replace(/<a:br\s*\/>/g, '<a:t> </a:t>'), 'a:t'));
      if (text) out.push({ text, weight, title: weight === TITLE });
    }
  }
  return out;
}

async function pptx(zip) {
  const slideRe = /^ppt\/slides\/slide(\d+)\.xml$/;
  const notesRe = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;
  const segments = [];
  const slides = zip.names.filter(n => slideRe.test(n)).sort(byNumber(slideRe));
  for (const name of slides) segments.push(...pptxShapes(await zip.text(name)));
  for (const name of zip.names.filter(n => notesRe.test(n)).sort(byNumber(notesRe))) {
    segments.push(...pptxShapes(await zip.text(name), true));
  }
  return { segments, parts: slides.length, unit: 'slide' };
}

// ---------- Word ----------

async function docx(zip) {
  const xml = await zip.text('word/document.xml');
  if (!xml) throw new Error('This Word document looks empty');
  const segments = [];
  for (const p of all(xml, /<w:p\b[\s\S]*?<\/w:p>/g)) {
    const text = tidy(textOf(p.replace(/<w:(tab|br)\b[^>]*\/>/g, '<w:t> </w:t>'), 'w:t'));
    if (!text) continue;
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '';
    const heading = /^(Heading\d|Title|Subtitle)$/i.test(style);
    segments.push({ text, weight: heading ? TITLE : 1, title: /^title$/i.test(style) || (heading && !segments.some(s => s.title)) });
  }
  return { segments, parts: segments.filter(s => s.weight === TITLE).length || 1, unit: 'heading' };
}

// ---------- OpenOffice ----------

async function odf(zip, presentation) {
  const xml = await zip.text('content.xml');
  if (!xml) throw new Error('This document looks empty');
  const clean = x => tidy(decode(x.replace(/<text:(s|tab|line-break)\b[^>]*\/>/g, ' ').replace(/<[^>]+>/g, '')));
  const segments = [];
  if (presentation) {
    const pages = all(xml, /<draw:page\b[\s\S]*?<\/draw:page>/g);
    for (const page of pages) {
      for (const frame of all(page, /<draw:frame\b[\s\S]*?<\/draw:frame>/g)) {
        const weight = /presentation:class="title"/.test(frame) ? TITLE : 1;
        for (const p of all(frame, /<text:(p|h)\b[\s\S]*?<\/text:\1>/g)) {
          const text = clean(p);
          if (text) segments.push({ text, weight, title: weight === TITLE });
        }
      }
    }
    return { segments, parts: pages.length, unit: 'slide' };
  }
  for (const p of all(xml, /<text:(p|h)\b[\s\S]*?<\/text:\1>/g)) {
    const text = clean(p);
    const heading = p.startsWith('<text:h');
    if (text) segments.push({ text, weight: heading ? TITLE : 1, title: heading && !segments.some(s => s.title) });
  }
  return { segments, parts: segments.filter(s => s.weight === TITLE).length || 1, unit: 'heading' };
}

// ---------- plain text and Markdown ----------

function plain(text) {
  const segments = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = /^\s{0,3}#{1,6}\s/.test(line);
    const t = tidy(line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*([-*+•]|\d+[.)])\s+/, '').replace(/[*_`]+/g, ''));
    if (t) segments.push({ text: t, weight: heading ? TITLE : 1, title: heading && !segments.some(s => s.title) });
  }
  return { segments, parts: segments.filter(s => s.weight === TITLE).length || 1, unit: 'heading' };
}

// ---------- PDF ----------

async function pdf(buffer) {
  const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  const segments = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const lines = [];
    let line = { text: '', size: 0 };
    for (const item of (await page.getTextContent()).items) {
      line.text += item.str ?? '';
      line.size = Math.max(line.size, Math.abs(item.transform?.[3] ?? 0));
      if (item.hasEOL) { lines.push(line); line = { text: '', size: 0 }; }
    }
    lines.push(line);
    // The biggest type on a page is its title (on a slide, usually the first line)
    const biggest = Math.max(...lines.map(l => (tidy(l.text) ? l.size : 0)));
    for (const l of lines) {
      const text = tidy(l.text);
      const title = biggest > 0 && l.size >= biggest * 0.95;
      if (text) segments.push({ text, weight: title ? TITLE : 1, title: title && !segments.some(s => s.title) });
    }
  }
  return { segments, parts: doc.numPages, unit: 'page' };
}

// ---------- any of them ----------

export async function readDocument(name, buffer) {
  const ext = name.toLowerCase().match(/\.(\w+)$/)?.[1] ?? '';
  let doc;
  if (['pptx', 'ppsx', 'pptm', 'potx'].includes(ext)) doc = await pptx(await readZip(buffer));
  else if (['docx', 'docm', 'dotx'].includes(ext)) doc = await docx(await readZip(buffer));
  else if (ext === 'odp' || ext === 'odt') doc = await odf(await readZip(buffer), ext === 'odp');
  else if (ext === 'pdf') doc = await pdf(buffer);
  else if (['txt', 'md', 'markdown', 'text'].includes(ext)) doc = plain(new TextDecoder().decode(buffer));
  else if (ext === 'key' || ext === 'pages') throw new Error('Apple Keynote and Pages files can’t be read here — export to PowerPoint, Word or PDF first');
  else if (ext === 'ppt' || ext === 'doc') throw new Error('That’s an old-style Office file — save it as .pptx or .docx first');
  else throw new Error('Upload a PowerPoint, Word, PDF, OpenOffice or text file');
  const title = doc.segments.find(s => s.title)?.text ?? name.replace(/\.\w+$/, '').replace(/[_-]+/g, ' ');
  return { ...doc, title: tidy(title).slice(0, 60) };
}
