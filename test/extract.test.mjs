import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDocument } from '../public/js/extract.mjs';
import { readZip } from '../public/js/zip.mjs';
import { makeZip } from './helpers/zip.mjs';

const P = 'xmlns:a="a" xmlns:p="p"';
const shape = (ph, ...paras) => `<p:sp><p:nvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody>${
  paras.map(t => `<a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-GB"/><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
const slide = (...shapes) => `<?xml version="1.0"?><p:sld ${P}><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`;

test('the zip reader reads deflated files and reports what is in the archive', async () => {
  const zip = await readZip(makeZip({ 'a.txt': 'hello', 'dir/b.xml': '<x>é ✓</x>'.repeat(50) }));
  assert.deepEqual(zip.names, ['a.txt', 'dir/b.xml']);
  assert.equal(await zip.text('a.txt'), 'hello');
  assert.equal(await zip.text('dir/b.xml'), '<x>é ✓</x>'.repeat(50));
  assert.equal(await zip.text('missing'), null);
  await assert.rejects(readZip(new TextEncoder().encode('not a zip at all').buffer), /isn’t a document/);
});

test('PowerPoint: slide titles count more, body text and speaker notes are read, slide numbers are not', async () => {
  const doc = await readDocument('Talk.pptx', makeZip({
    'ppt/slides/slide2.xml': slide(shape('<p:ph type="title"/>', 'Insulin resistance'), shape('<p:ph idx="1"/>', 'HbA1c targets', 'Tom &amp; Jerry')),
    'ppt/slides/slide10.xml': slide(shape('<p:ph type="sldNum"/>', '10'), shape('', 'A text box')),
    'ppt/slides/slide1.xml': slide(shape('<p:ph type="ctrTitle"/>', 'Diabetes update 2026')),
    'ppt/notesSlides/notesSlide1.xml': slide(shape('<p:ph type="sldImg"/>'), shape('<p:ph type="body" idx="1"/>', 'Mention the NICE guidelines'), shape('<p:ph type="sldNum"/>', '1')),
    'ppt/presentation.xml': '<p:presentation/>',
  }));
  assert.equal(doc.title, 'Diabetes update 2026');
  assert.equal(doc.parts, 3);
  assert.equal(doc.unit, 'slide');
  assert.deepEqual(doc.segments.map(s => [s.text, s.weight]), [
    ['Diabetes update 2026', 3], ['Insulin resistance', 3], ['HbA1c targets', 1], ['Tom & Jerry', 1], ['A text box', 1],
    ['Mention the NICE guidelines', 1],
  ]);
});

test('Word: headings count more, and the Title style gives the title', async () => {
  const para = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const doc = await readDocument('notes.docx', makeZip({
    'word/document.xml': `<w:document><w:body>${para('Practice meeting', 'Title')}${para('Repeat prescriptions', 'Heading1')}${para('Patients ask for antibiotics')}${para('')}</w:body></w:document>`,
  }));
  assert.equal(doc.title, 'Practice meeting');
  assert.deepEqual(doc.segments.map(s => [s.text, s.weight]), [['Practice meeting', 3], ['Repeat prescriptions', 3], ['Patients ask for antibiotics', 1]]);
});

test('OpenOffice: Impress title frames and Writer headings count more', async () => {
  const odp = await readDocument('talk.odp', makeZip({
    'content.xml': `<office:document-content><draw:page><draw:frame presentation:class="title"><draw:text-box><text:p>Sepsis<text:s/>six</text:p></draw:text-box></draw:frame><draw:frame presentation:class="outline"><text:p>Early <text:span>warning</text:span> score</text:p></draw:frame></draw:page></office:document-content>`,
  }));
  assert.deepEqual(odp.segments.map(s => [s.text, s.weight]), [['Sepsis six', 3], ['Early warning score', 1]]);
  assert.equal(odp.parts, 1);
  const odt = await readDocument('notes.odt', makeZip({
    'content.xml': `<office:document-content><text:h text:outline-level="1">Red flags</text:h><text:p>Safety-netting matters</text:p></office:document-content>`,
  }));
  assert.equal(odt.title, 'Red flags');
  assert.deepEqual(odt.segments.map(s => s.weight), [3, 1]);
});

test('plain text and Markdown: # headings count more, list markers and emphasis are dropped', async () => {
  const doc = await readDocument('talk.md', new TextEncoder().encode('# Asthma review\n\n- **Inhaler technique**\n1. Peak flow\nplain line\n').buffer);
  assert.deepEqual(doc.segments.map(s => [s.text, s.weight]), [['Asthma review', 3], ['Inhaler technique', 1], ['Peak flow', 1], ['plain line', 1]]);
  assert.equal(doc.title, 'Asthma review');
});

test('with no title in the document, the file name is used', async () => {
  const doc = await readDocument('quarterly_review-final.txt', new TextEncoder().encode('just text').buffer);
  assert.equal(doc.title, 'quarterly review final');
});

test('files that can’t be read say what to do instead', async () => {
  const empty = new ArrayBuffer(8);
  await assert.rejects(readDocument('talk.key', empty), /export to PowerPoint/);
  await assert.rejects(readDocument('old.ppt', empty), /save it as \.pptx/);
  await assert.rejects(readDocument('photo.jpg', empty), /Upload a PowerPoint/);
});
