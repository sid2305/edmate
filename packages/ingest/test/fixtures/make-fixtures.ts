// Writes the 12 binary fixtures (4 PDF, 4 DOCX, 4 PPTX) under test/fixtures/. The repo is public,
// so every fixture is self-written lesson text: no teacher material, no student data, no names.
// PDFs are written by hand (a few objects and an xref table); DOCX and PPTX are zipped with jszip,
// already a dependency. Output is deterministic (fixed zip dates), so a re-run changes nothing.
//
// Run from packages/ingest:  node test/fixtures/make-fixtures.ts
// The tests also import the builders to make edge-case files (blank, broken) in memory.
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

const ROOT = new URL('./', import.meta.url);
const ZIP_DATE = new Date(Date.UTC(2026, 0, 1));

function write(rel: string, bytes: Uint8Array): void {
  const url = new URL(rel, ROOT);
  mkdirSync(new URL('./', url), { recursive: true });
  writeFileSync(url, bytes);
}

// ---------- PDF ----------

/** One page: a list of lines; each line is one or more text runs drawn on the same baseline. */
export type PdfPage = readonly (string | readonly string[])[];

function pdfString(text: string): string {
  return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

function pageStream(page: PdfPage): string {
  if (page.length === 0) return '';
  const ops = ['BT', '/F1 12 Tf', '72 720 Td'];
  page.forEach((line, i) => {
    if (i > 0) ops.push('0 -18 Td');
    const runs = typeof line === 'string' ? [line] : line;
    runs.forEach((run, j) => {
      // A later run on the same line starts a little to the right, like a second text box.
      if (j > 0) ops.push(`${String(runs[j - 1]!.length * 7 + 4)} 0 Td`);
      ops.push(`${pdfString(run)} Tj`);
    });
    if (runs.length > 1) {
      const back = runs.slice(0, -1).reduce((sum, r) => sum + r.length * 7 + 4, 0);
      ops.push(`${String(-back)} 0 Td`);
    }
  });
  ops.push('ET');
  return ops.join('\n');
}

/** Latin-1 text maps byte for byte onto WinAnsiEncoding for the characters used here (×, ÷, °). */
export function makePdf(pages: readonly PdfPage[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pages.length)} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((page, i) => {
    const id = pageIds[i]!;
    const stream = pageStream(page);
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${String(id + 1)} 0 R >>`;
    objects[id + 1] =
      `<< /Length ${String(Buffer.byteLength(stream, 'latin1'))} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${String(id)} 0 obj\n${objects[id]!}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${String(objects.length)}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${String(objects.length)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------- zip helpers ----------

export async function zip(entries: readonly (readonly [string, string])[]): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [name, text] of entries) z.file(name, text, { date: ZIP_DATE });
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- DOCX ----------

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export type DocxBlock =
  | { readonly h: 1 | 2 | 3; readonly text: string }
  | { readonly p: readonly (string | { readonly b: string } | 'BR')[] }
  | { readonly table: readonly (readonly string[])[] };

function run(part: string | { readonly b: string } | 'BR'): string {
  if (part === 'BR') return '<w:r><w:br/></w:r>';
  if (typeof part === 'string') return `<w:r><w:t xml:space="preserve">${xmlEscape(part)}</w:t></w:r>`;
  return `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(part.b)}</w:t></w:r>`;
}

function docxBlock(block: DocxBlock): string {
  if ('h' in block) {
    return `<w:p><w:pPr><w:pStyle w:val="Heading${String(block.h)}"/></w:pPr>${run(block.text)}</w:p>`;
  }
  if ('p' in block) return `<w:p>${block.p.map(run).join('')}</w:p>`;
  const rows = block.table
    .map((row) => `<w:tr>${row.map((c) => `<w:tc><w:p>${run(c)}</w:p></w:tc>`).join('')}</w:tr>`)
    .join('');
  return `<w:tbl>${rows}</w:tbl>`;
}

export function makeDocx(blocks: readonly DocxBlock[]): Promise<Uint8Array> {
  const styles = [1, 2, 3]
    .map(
      (n) =>
        `<w:style w:type="paragraph" w:styleId="Heading${String(n)}"><w:name w:val="heading ${String(n)}"/></w:style>`,
    )
    .join('');
  return zip([
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    ],
    [
      'word/_rels/document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    ],
    [
      'word/styles.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">${styles}</w:styles>`,
    ],
    [
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>` +
        blocks.map(docxBlock).join('') +
        '</w:body></w:document>',
    ],
  ]);
}

// ---------- PPTX ----------

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A slide is a list of shapes; a shape is a list of paragraphs; 'BR' inside a paragraph is a soft break. */
export type Slide = readonly (readonly (readonly string[])[])[];

function shape(paragraphs: readonly (readonly string[])[]): string {
  const ps = paragraphs
    .map(
      (runs) =>
        `<a:p>${runs.map((r) => (r === 'BR' ? '<a:br/>' : `<a:r><a:t>${xmlEscape(r)}</a:t></a:r>`)).join('')}</a:p>`,
    )
    .join('');
  return `<p:sp><p:txBody><a:bodyPr/>${ps}</p:txBody></p:sp>`;
}

function slideXml(slide: Slide): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}">` +
    `<p:cSld><p:spTree>${slide.map(shape).join('')}</p:spTree></p:cSld></p:sld>`
  );
}

/**
 * `files` maps a slide file number to its content. `order` (show order, as file numbers) writes
 * presentation.xml and its rels; without it the deck has no presentation.xml at all. `entryOrder`
 * is the order the zip entries are written in.
 */
export function makePptx(
  files: ReadonlyMap<number, Slide>,
  order: readonly number[] | undefined,
  entryOrder: readonly number[] = [...files.keys()],
): Promise<Uint8Array> {
  const entries: [string, string][] = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '</Types>',
    ],
  ];
  if (order !== undefined) {
    entries.push(
      [
        'ppt/presentation.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst>` +
          order.map((n, i) => `<p:sldId id="${String(256 + i)}" r:id="rId${String(n + 10)}"/>`).join('') +
          '</p:sldIdLst></p:presentation>',
      ],
      [
        'ppt/_rels/presentation.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
          order
            .map(
              (n) =>
                `<Relationship Id="rId${String(n + 10)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${String(n)}.xml"/>`,
            )
            .join('') +
          '</Relationships>',
      ],
    );
  }
  for (const n of entryOrder) entries.push([`ppt/slides/slide${String(n)}.xml`, slideXml(files.get(n)!)]);
  return zip(entries);
}

export const slides = (list: readonly Slide[]): Map<number, Slide> =>
  new Map(list.map((s, i) => [i + 1, s]));

// ---------- the fixtures ----------

async function main(): Promise<void> {
  write(
    'pdf/photosynthesis-three-pages.pdf',
    makePdf([
      ['Photosynthesis', 'Green plants make sugar from light, water and carbon dioxide.'],
      ['Where it happens', 'Chloroplasts in leaf cells hold the green pigment chlorophyll.'],
      ['What comes out', 'Plants release oxygen into the air as a by-product.'],
    ]),
  );
  write(
    'pdf/fractions-one-page.pdf',
    makePdf([
      [
        'Adding fractions',
        'To add 1/4 and 2/4, keep the denominator and add the numerators.',
        'The answer is 3/4.',
      ],
    ]),
  );
  write(
    'pdf/forces-blank-middle.pdf',
    makePdf([
      ['Forces push or pull', 'A force can change the speed or direction of an object.'],
      [],
      ['Friction', 'Friction is a force that slows moving surfaces that touch.'],
    ]),
  );
  write(
    'pdf/measurement-symbols.pdf',
    makePdf([
      ['Area of a rectangle', ['Area =', 'length × width'], 'A 3 m by 4 m floor has area 12 m².'],
      ['Angles (in degrees)', 'A right angle measures 90°.', 'Half of 180° is 180 ÷ 2 = 90°.'],
    ]),
  );

  write(
    'docx/solar-system-headings.docx',
    await makeDocx([
      { h: 1, text: 'The Solar System' },
      { p: ['The Sun is a star at the centre of our solar system.'] },
      { h: 2, text: 'Inner planets' },
      { p: ['Mercury, Venus, Earth and Mars are rocky planets.'] },
      { h: 2, text: 'Outer planets' },
      { p: ['Jupiter and Saturn are gas giants.'] },
      { p: ['Uranus and Neptune are ice giants.'] },
      { h: 1, text: 'Moons' },
      { p: ['A moon is a natural object that orbits a planet.'] },
    ]),
  );
  write(
    'docx/grammar-table.docx',
    await makeDocx([
      { h: 1, text: 'Parts of Speech' },
      { p: ['Each word in a sentence has a job.'] },
      {
        table: [
          ['Part', 'Example'],
          ['Noun', 'river'],
          ['Verb', 'runs'],
        ],
      },
      { h: 2, text: 'Adjectives' },
      { p: ['An adjective describes a noun, as in a ', { b: 'wide' }, ' river.'] },
    ]),
  );
  write(
    'docx/rocks-no-heading.docx',
    await makeDocx([
      { p: ['Igneous rock forms when melted rock cools.'] },
      { p: ['Sedimentary rock forms from layers of sand and mud.'] },
      { p: ['Metamorphic rock forms under heat and pressure.'] },
    ]),
  );
  write(
    'docx/electricity-breaks.docx',
    await makeDocx([
      { h: 1, text: 'Electricity' },
      { h: 3, text: 'Simple circuits' },
      { p: ['A ', { b: 'cir' }, 'cuit needs a power source,', 'BR', 'wires and a bulb.'] },
      { h: 2, text: 'Safety' },
      { p: ['Never touch a plug with wet hands.'] },
    ]),
  );

  write(
    'pptx/habitats-three-slides.pptx',
    await makePptx(
      slides([
        [[['Habitats']], [['A habitat is the home of a plant or animal.']]],
        [[['Deserts']], [['Deserts get very little rain.'], ['Camels store fat in their humps.']]],
        [[['Oceans']], [['Oceans cover most of the Earth.']]],
      ]),
      [1, 2, 3],
    ),
  );
  const counting = slides(
    Array.from({ length: 12 }, (_, i): Slide => [[[`Counting in twos: ${String((i + 1) * 2)}`]]]),
  );
  // No presentation.xml, and entries written out of order: only a numeric sort of the slide file
  // numbers gives 1..12 (a text sort puts slide10 before slide2).
  write(
    'pptx/counting-twelve-slides.pptx',
    await makePptx(counting, undefined, [10, 3, 12, 1, 7, 2, 11, 5, 9, 4, 8, 6]),
  );
  // Show order 3, 1, 2 by presentation.xml: the deck was reordered after the files were named.
  write(
    'pptx/weather-reordered.pptx',
    await makePptx(
      slides([
        [[['Clouds']], [['Clouds are made of tiny water droplets.']]],
        [[['Rain']], [['Rain falls when droplets grow heavy.']]],
        [[['Weather words']], [['Today we learn three weather words.']]],
      ]),
      [3, 1, 2],
    ),
  );
  write(
    'pptx/shapes-blank-slide.pptx',
    await makePptx(
      slides([
        [[['Shapes']], [['A triangle has three sides.', 'BR', 'A square has four.']]],
        [],
        [[['Circles']], [['A circle has ', 'no corners', '.']]],
      ]),
      [1, 2, 3],
    ),
  );
}

// Only when run as a script: the tests import the builders above to make edge-case files in memory.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
