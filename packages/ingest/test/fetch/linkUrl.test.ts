import { describe, expect, it } from 'vitest';
import {
  checkWebLinkUrl,
  isDeniedHostName,
  isYouTubeHost,
  WEB_LINK_MAX_URL_LENGTH,
} from '../../src/fetch/linkUrl.js';
import { REFUSED_URLS, YOUTUBE_URLS } from './urlTable.js';

describe('checkWebLinkUrl: refusals (no DNS, pure)', () => {
  it.each(REFUSED_URLS)('refuses %s', (_label, url, code) => {
    expect(checkWebLinkUrl(url)).toEqual({ ok: false, code });
  });

  it.each(YOUTUBE_URLS)('refuses the YouTube link %s with its own code', (url) => {
    expect(checkWebLinkUrl(url)).toEqual({ ok: false, code: 'youtube_unsupported' });
  });

  it.each(['', '   ', 'not a url', 'https://', '//lessons.example.org/a'])(
    'an unparseable link (%j) is invalid_url',
    (raw) => {
      expect(checkWebLinkUrl(raw)).toEqual({ ok: false, code: 'invalid_url' });
    },
  );

  it('refuses a link longer than 2048 characters, before or after normalising', () => {
    const base = 'https://lessons.example.org/';
    const long = base + 'a'.repeat(WEB_LINK_MAX_URL_LENGTH);
    expect(checkWebLinkUrl(long)).toEqual({ ok: false, code: 'too_long' });
    // Under the limit as typed, but percent-encoding the spaces grows it past the limit.
    const grows = `${base}${'a b'.repeat(600)}`;
    expect(grows.length).toBeLessThan(WEB_LINK_MAX_URL_LENGTH);
    expect(checkWebLinkUrl(grows)).toEqual({ ok: false, code: 'too_long' });
  });
});

describe('checkWebLinkUrl: accepted links', () => {
  it('returns the normalised URL and a host-only display title', () => {
    expect(checkWebLinkUrl('  https://Lessons.Example.org:443/unit/1?key=secret#part  ')).toEqual({
      ok: true,
      url: 'https://lessons.example.org/unit/1?key=secret#part',
      displayTitle: 'lessons.example.org',
    });
  });

  it('accepts a public IP literal and a name with a trailing dot', () => {
    expect(checkWebLinkUrl('https://93.184.216.34/a')).toMatchObject({
      ok: true,
      displayTitle: '93.184.216.34',
    });
    expect(checkWebLinkUrl('https://[2606:4700:4700::1111]/a')).toMatchObject({ ok: true });
    expect(checkWebLinkUrl('https://lessons.example.org./a')).toMatchObject({
      ok: true,
      displayTitle: 'lessons.example.org',
    });
  });

  it('the display title never carries the path, query or fragment', () => {
    const r = checkWebLinkUrl('https://docs.example.org/share/tok-123?sig=abc#x');
    expect(r).toMatchObject({ ok: true, displayTitle: 'docs.example.org' });
  });

  it('a look-alike of a YouTube or internal host is an ordinary site', () => {
    for (const url of [
      'https://notyoutube.com/a',
      'https://youtube.com.example.org/a',
      'https://local.example.org/a',
      'https://internal.example.org/a',
    ]) {
      expect(checkWebLinkUrl(url)).toMatchObject({ ok: true });
    }
  });
});

describe('host helpers', () => {
  it('isYouTubeHost matches the fixed host list, any case, with or without a trailing dot', () => {
    expect(isYouTubeHost('WWW.YouTube.com.')).toBe(true);
    expect(isYouTubeHost('youtu.be')).toBe(true);
    expect(isYouTubeHost('gaming.youtube.com')).toBe(false);
    expect(isYouTubeHost('example.org')).toBe(false);
  });

  it('isDeniedHostName refuses internal names and leaves IP literals to the address check', () => {
    expect(isDeniedHostName('localhost.')).toBe(true);
    expect(isDeniedHostName('')).toBe(true);
    expect(isDeniedHostName('a.b.home.arpa')).toBe(true);
    expect(isDeniedHostName('127.0.0.1')).toBe(false);
    expect(isDeniedHostName('[::1]')).toBe(false);
    expect(isDeniedHostName('lessons.example.org')).toBe(false);
  });
});
