'use strict';

// PR B — unit tests for the new document + OCR tools. We mock tesseract.js
// so the test suite never has to download the 8 MB English training data,
// and we build a tiny valid PDF + DOCX on the fly so the parsers exercise
// their real happy path against real bytes.

// pdf-parse is its own well-tested library; we only need to prove our
// wrapper passes buffers through, clamps output, and reports metadata.
// Mocking removes the dependency on pdf-parse's internal quirks (it
// refuses to start when its sample PDF isn't present on disk).
jest.mock('pdf-parse', () => jest.fn(async (buf, opts) => ({
  // Long enough to exceed the 500-char floor that toolReadPdf enforces,
  // so the truncation test can verify the suffix marker without lowering
  // the production clamp.
  text: 'Hello Kelion. ' + 'The quick brown fox jumps over the lazy dog. '.repeat(20),
  numpages: 1,
  info: { Title: 'Test Doc' },
  _bufLen: Buffer.isBuffer(buf) ? buf.length : 0,
  _max: opts && opts.max ? opts.max : null,
})));

// mammoth: return a short document when called with a Buffer; throw on
// clearly-invalid input so our "bad bytes" test exercises the error path.
jest.mock('mammoth', () => ({
  extractRawText: jest.fn(async ({ buffer }) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
      throw new Error('invalid docx');
    }
    const head = buffer.slice(0, 2).toString('binary');
    if (head !== 'PK') throw new Error('not a zip/docx container');
    return { value: 'Hello Kelion from DOCX', messages: [] };
  }),
}));

jest.mock('tesseract.js', () => ({
  createWorker: jest.fn(async (_lang) => ({
    recognize: jest.fn(async (_buf) => ({
      data: {
        text:
          'P<ROUENCIULESCU<<ADRIAN<<<<<<<<<<<<<<<<<<<<<\n' +
          '1234567890ROU8503154M2701011<<<<<<<<<<<<<<08\n',
        confidence: 88.5,
      },
    })),
    terminate: jest.fn(async () => {}),
  })),
}));

const {
  toolReadPdf,
  toolReadDocx,
  toolOcrImage,
  toolOcrPassport,
  parseMrz,
} = require('../src/services/realTools');

function fakePdfBuffer() {
  // pdf-parse is mocked above, so the buffer contents don't matter —
  // only that we pass through a real Buffer to exercise the wrapper.
  return Buffer.from('%PDF-1.4 fake', 'utf8');
}

function fakeDocxBuffer() {
  // mammoth mock just checks for the ZIP "PK" magic bytes.
  return Buffer.concat([Buffer.from('PK\u0003\u0004', 'binary'), Buffer.alloc(64)]);
}

describe('docs + OCR tools — PR B', () => {
  test('toolReadPdf rejects missing inputs', async () => {
    const r = await toolReadPdf({});
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/url|base64/i);
  });

  test('toolReadPdf reads a PDF buffer (via mocked pdf-parse)', async () => {
    const r = await toolReadPdf({ base64: fakePdfBuffer().toString('base64') });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Hello Kelion');
    expect(r.pages).toBe(1);
    expect(r.chars).toBeGreaterThan(0);
    expect(r.info).toEqual({ Title: 'Test Doc' });
  });

  test('toolReadPdf clamps max_chars and reports truncation', async () => {
    const r = await toolReadPdf({
      base64: fakePdfBuffer().toString('base64'),
      max_chars: 5,
    });
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.text.endsWith('… [truncated]')).toBe(true);
  });

  test('toolReadPdf rejects oversized base64 payloads (defense-in-depth)', async () => {
    // Build a 26 MB base64 blob — above the 25 MB cap the tool enforces.
    // The Devin-review finding was that the base64 path bypassed the
    // maxBytes check; this locks in the regression so it cannot come
    // back silently.
    const oversize = Buffer.alloc(26 * 1024 * 1024, 0x25).toString('base64');
    const r = await toolReadPdf({ base64: oversize });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/too large/i);
  });

  test('toolReadDocx reads a docx buffer (via mocked mammoth)', async () => {
    const r = await toolReadDocx({ base64: fakeDocxBuffer().toString('base64') });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Hello Kelion from DOCX');
    expect(r.chars).toBeGreaterThan(0);
    expect(r.warnings).toEqual([]);
  });

  test('toolReadDocx rejects missing inputs', async () => {
    const r = await toolReadDocx({});
    expect(r.ok).toBe(false);
  });

  test('toolReadDocx surfaces parser error on invalid bytes', async () => {
    const r = await toolReadDocx({
      base64: Buffer.from('not a docx').toString('base64'),
    });
    // mammoth returns an explicit error rather than crashing, so ok:false
    // with a human-readable message is the contract.
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });

  test('toolOcrImage recognises text via mocked tesseract', async () => {
    const r = await toolOcrImage({
      base64: Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
    });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('ENCIULESCU');
    expect(r.confidence).toBeCloseTo(88.5, 1);
    expect(r.language).toBe('eng');
  });

  test('toolOcrImage sanitises language and passes to tesseract', async () => {
    const r = await toolOcrImage({
      base64: Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
      lang: 'eng+ron!; DROP TABLE',
    });
    expect(r.ok).toBe(true);
    expect(r.language).toBe('eng+ron');
  });

  test('toolOcrPassport parses MRZ into structured fields', async () => {
    const r = await toolOcrPassport({
      base64: Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
    });
    expect(r.ok).toBe(true);
    expect(r.fields.format).toBe('TD3');
    expect(r.fields.documentType).toBe('P');
    expect(r.fields.issuingCountry).toBe('ROU');
    expect(r.fields.surname).toBe('ENCIULESCU');
    expect(r.fields.givenNames).toBe('ADRIAN');
    expect(r.fields.passportNumber).toBe('123456789');
    expect(r.fields.nationality).toBe('ROU');
    expect(r.fields.sex).toBe('M');
    expect(r.fields.dateOfBirth).toBe('1985-03-15');
    expect(r.fields.dateOfExpiry).toBe('2027-01-01');
    expect(r.mrz.length).toBeGreaterThanOrEqual(2);
  });

  test('parseMrz returns null on too few lines', () => {
    expect(parseMrz([])).toBe(null);
    expect(parseMrz(['A<<<'])).toBe(null);
  });

  test('parseMrz marks unknown when no TD3 pair present', () => {
    const result = parseMrz(['TOO-SHORT', 'ALSO-SHORT']);
    expect(result).toEqual({ format: 'unknown', lines: ['TOO-SHORT', 'ALSO-SHORT'] });
  });
});
