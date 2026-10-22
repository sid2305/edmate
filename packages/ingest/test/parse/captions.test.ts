// Task 8.2c Phase A: caption files (.vtt, .srt) parse into the same 90 s timestamp units a Whisper
// transcript gives. Every fixture here is synthetic text, written for this test only (rule 5): no
// caption file from a real video.
import { describe, expect, it } from 'vitest';
import { parseSrt, parseVtt } from '../../src/parse/captions.js';
import { formatTimestamp, parseVideoTranscript, VIDEO_UNIT_WINDOW_MS } from '../../src/parse/video.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('parseVtt', () => {
  it('parses a happy-path file with header text after WEBVTT', () => {
    const doc = parseVtt(
      enc(
        'WEBVTT - sample captions\n\n00:00:00.000 --> 00:00:02.000\nHello class.\n\n00:00:05.000 --> 00:00:07.000\nWe begin today.\n',
      ),
      'Lesson one',
    );
    expect(doc).toEqual({
      sourceTitle: 'Lesson one',
      units: [{ text: 'Hello class. We begin today.', locator: '0:00' }],
    });
  });

  it('skips NOTE, STYLE and REGION blocks', () => {
    const doc = parseVtt(
      enc(
        [
          'WEBVTT',
          '',
          'NOTE',
          'This is a note about the file.',
          '',
          'STYLE',
          '::cue { color: yellow; }',
          '',
          'REGION',
          'id:bottom',
          'width:40%',
          '',
          '00:00:00.000 --> 00:00:01.000',
          'Only real cue.',
          '',
        ].join('\n'),
      ),
      'Regions',
    );
    expect(doc.units).toEqual([{ text: 'Only real cue.', locator: '0:00' }]);
  });

  it('ignores cue settings after the timing line', () => {
    const doc = parseVtt(
      enc('WEBVTT\n\n00:00:00.000 --> 00:00:01.000 line:90% align:start\nPositioned text.\n'),
      'Settings',
    );
    expect(doc.units).toEqual([{ text: 'Positioned text.', locator: '0:00' }]);
  });

  it('strips every tag kind and decodes entities', () => {
    const doc = parseVtt(
      enc(
        [
          'WEBVTT',
          '',
          '00:00:00.000 --> 00:00:03.000',
          '<v Teacher>Rock &amp; roll <c.yellow>chemistry</c.yellow> &lt;fun&gt; <00:00:01.500><i>today</i><b>!</b><u>!</u><lang en>!</lang><ruby>x<rt>y</rt></ruby> &quot;quoted&quot; &#39;it&#39;s&#39; &nbsp;end',
          '',
        ].join('\n'),
      ),
      'Tags',
    );
    expect(doc.units[0]?.text).toBe(
      'Rock & roll chemistry <fun> today!!!xy "quoted" \'it\'s\' end',
    );
  });

  it('a cue identifier line is optional', () => {
    const withId = parseVtt(
      enc('WEBVTT\n\ncue-1\n00:00:00.000 --> 00:00:01.000\nWith an id.\n'),
      'Ids',
    );
    expect(withId.units).toEqual([{ text: 'With an id.', locator: '0:00' }]);
  });

  it('parses CRLF and CR line endings', () => {
    const crlf = parseVtt(enc('WEBVTT\r\n\r\n00:00:00.000 --> 00:00:01.000\r\nCRLF cue.\r\n'), 'CRLF');
    expect(crlf.units).toEqual([{ text: 'CRLF cue.', locator: '0:00' }]);
    const cr = parseVtt(enc('WEBVTT\r\r00:00:00.000 --> 00:00:01.000\rCR cue.\r'), 'CR');
    expect(cr.units).toEqual([{ text: 'CR cue.', locator: '0:00' }]);
  });

  it('a cue past one hour gets a locator past one hour (the unit window, same as parseVideoTranscript)', () => {
    const startMs = 3_600_000 + 2 * 60_000; // 01:02:00.000
    const doc = parseVtt(
      enc('WEBVTT\n\n01:02:00.000 --> 01:02:01.000\nAn hour and two minutes in.\n'),
      'Hours',
    );
    const window = Math.floor(startMs / VIDEO_UNIT_WINDOW_MS) * VIDEO_UNIT_WINDOW_MS;
    expect(doc.units).toEqual([
      { text: 'An hour and two minutes in.', locator: formatTimestamp(window) },
    ]);
    expect(doc.units[0]?.locator).toMatch(/^\d+:\d{2}:\d{2}$/);
  });

  it('drops a line that only repeats the previous cue last line (rolling captions)', () => {
    const doc = parseVtt(
      enc(
        [
          'WEBVTT',
          '',
          '00:00:00.000 --> 00:00:02.000',
          'the quick brown',
          '',
          '00:00:02.000 --> 00:00:04.000',
          'the quick brown',
          'fox jumps',
          '',
        ].join('\n'),
      ),
      'Rolling',
    );
    expect(doc.units).toEqual([{ text: 'the quick brown fox jumps', locator: '0:00' }]);
  });

  it('sorts out-of-order cues by start time', () => {
    const doc = parseVtt(
      enc(
        [
          'WEBVTT',
          '',
          '00:00:05.000 --> 00:00:06.000',
          'Second said first in the file.',
          '',
          '00:00:00.000 --> 00:00:01.000',
          'First.',
          '',
        ].join('\n'),
      ),
      'Order',
    );
    expect(doc.units).toEqual([
      { text: 'First. Second said first in the file.', locator: '0:00' },
    ]);
  });

  it('a missing WEBVTT header is unsupported, no text from the file', () => {
    try {
      parseVtt(enc('not a caption file\n\nsome text\n'), 'Bad');
      throw new Error('expected parseVtt to throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('unsupported');
      expect((e as Error).message).not.toContain('not a caption file');
    }
  });

  it('only bad timing lines is a validation error with no file text', () => {
    try {
      parseVtt(enc('WEBVTT\n\nnot a timing line\nsecret teacher text\n'), 'Bad timing');
      throw new Error('expected parseVtt to throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('validation');
      expect((e as Error).message).not.toContain('secret teacher text');
    }
  });

  it('cues with only empty text is a validation error', () => {
    expect(() =>
      parseVtt(enc('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<i></i>\n'), 'Empty'),
    ).toThrow('no captions to learn from');
  });

  it('a 1 MB line of unclosed < parses within a loose gross-regression bound (lessons: no tight timings)', () => {
    // No '>' anywhere means none of this is a closed tag (matches the `<[^>]*>` semantics this
    // avoids): the text is kept as-is. The point of this test is the time bound, a guard against the
    // classic ReDoS shape of a naive tag-stripping regex, not what the kept text looks like.
    const junk = '<'.repeat(1_000_000);
    const start = Date.now();
    const doc = parseVtt(enc(`WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${junk}real text\n`), 'Big');
    expect(Date.now() - start).toBeLessThan(5_000);
    expect(doc.units[0]?.text.endsWith('real text')).toBe(true);
  });

  it('matches parseVideoTranscript units for the same segments', () => {
    const doc = parseVtt(
      enc('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello class.\n'),
      'Compare',
    );
    const transcript = {
      text: 'Hello class.',
      language: 'en',
      durationMs: 1_000,
      segments: [{ startMs: 0, endMs: 1_000, text: 'Hello class.' }],
    };
    const fromVideo = parseVideoTranscript(transcript, 'Compare');
    expect(doc.units).toEqual(fromVideo.units);
  });
});

describe('parseSrt', () => {
  it('parses a happy path with index lines and a comma separator', () => {
    const doc = parseSrt(
      enc('1\n00:00:00,000 --> 00:00:02,000\nHello class.\n\n2\n00:00:05,000 --> 00:00:07,000\nWe begin today.\n'),
      'Srt lesson',
    );
    expect(doc).toEqual({
      sourceTitle: 'Srt lesson',
      units: [{ text: 'Hello class. We begin today.', locator: '0:00' }],
    });
  });

  it('parses without index lines, and with a dot separator', () => {
    const doc = parseSrt(
      enc('00:00:00.000 --> 00:00:01.000\nNo index line.\n'),
      'No index',
    );
    expect(doc.units).toEqual([{ text: 'No index line.', locator: '0:00' }]);
  });

  it('strips {\\an8} override tags and <font> tags', () => {
    const doc = parseSrt(
      enc('1\n00:00:00,000 --> 00:00:01,000\n{\\an8}<font color="#ffffff">Top text.</font>\n'),
      'Font',
    );
    expect(doc.units).toEqual([{ text: 'Top text.', locator: '0:00' }]);
  });

  it('a missing header is fine (SRT has none); only bad timing fails', () => {
    expect(() => parseSrt(enc('not timed at all\nsome text\n'), 'Bad')).toThrow(
      'no captions to learn from',
    );
  });

  it('error messages never contain file text for an empty-captions SRT', () => {
    try {
      parseSrt(enc('1\n00:00:00,000 --> 00:00:01,000\n\n'), 'Blank');
      throw new Error('expected parseSrt to throw');
    } catch (e) {
      expect((e as Error).message).not.toContain('1\n00:00:00');
    }
  });
});
