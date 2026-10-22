import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake c-ares resolver: answers per host and record type, and records cancel() calls.
const dnsState = vi.hoisted(() => ({
  answers: new Map<string, readonly string[] | Error | 'hang'>(),
  cancels: 0,
  options: [] as unknown[],
}));

vi.mock('node:dns/promises', () => {
  class Resolver {
    private readonly hung: ((err: Error) => void)[] = [];
    constructor(options: unknown) {
      dnsState.options.push(options);
    }
    private answer(key: string): Promise<string[]> {
      const a = dnsState.answers.get(key);
      if (a === 'hang') {
        return new Promise((_resolve, reject) => {
          this.hung.push(reject);
        });
      }
      if (a instanceof Error) return Promise.reject(a);
      if (a === undefined) return Promise.reject(dnsError('ENODATA'));
      return Promise.resolve([...a]);
    }
    resolve4(host: string): Promise<string[]> {
      return this.answer(`A ${host}`);
    }
    resolve6(host: string): Promise<string[]> {
      return this.answer(`AAAA ${host}`);
    }
    cancel(): void {
      dnsState.cancels += 1;
      for (const reject of this.hung.splice(0)) reject(dnsError('ECANCELLED'));
    }
  }
  return { Resolver };
});

function dnsError(code: string): Error {
  return Object.assign(new Error(`query failed ${code}`), { code });
}

const { FAMILY_GRACE_MS, NO_SUCH_NAME, errorCode, isPublicAddress, systemResolveHost } =
  await import('../../src/fetch/address.js');

describe('NO_SUCH_NAME and errorCode', () => {
  it('names the resolver codes that mean no address', () => {
    expect([...NO_SUCH_NAME].sort()).toEqual(['ENODATA', 'ENONAME', 'ENOTFOUND']);
  });

  it.each([
    [dnsError('ESERVFAIL'), 'ESERVFAIL'],
    [{ code: 42 }, 'EUNKNOWN'],
    [null, 'EUNKNOWN'],
    [undefined, 'EUNKNOWN'],
    ['boom', 'EUNKNOWN'],
  ])('errorCode(%o) is %s', (input, code) => {
    expect(errorCode(input)).toBe(code);
  });
});

describe('isPublicAddress', () => {
  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '1.1.1.1',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.0',
    '2606:4700:4700::1111',
    '2a00:1450:4001:80b::200e',
    '2001:3::1',
    '2001:2:1::1',
    '2001:30::1',
    '2001:4860:4860::8888',
    '3ffe::1',
    '3fff:1000::1',
  ])('%s is public', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    ['this network', '0.0.0.0'],
    ['private 10/8', '10.255.0.1'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['loopback', '127.0.0.1'],
    ['loopback, anywhere in 127/8', '127.200.1.1'],
    ['link-local and metadata', '169.254.169.254'],
    ['private 172.16/12', '172.16.0.1'],
    ['private 172.16/12 top', '172.31.255.255'],
    ['IETF protocol', '192.0.0.170'],
    ['documentation', '192.0.2.1'],
    ['private 192.168/16', '192.168.0.1'],
    ['benchmarking', '198.18.0.1'],
    ['documentation 2', '198.51.100.1'],
    ['documentation 3', '203.0.113.9'],
    ['multicast', '224.0.0.1'],
    ['reserved', '240.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['unspecified v6', '::'],
    ['loopback v6', '::1'],
    ['v4-mapped loopback', '::ffff:127.0.0.1'],
    ['v4-mapped private, hex form', '::ffff:a00:1'],
    ['NAT64', '64:ff9b::7f00:1'],
    ['discard', '100::1'],
    ['Teredo', '2001::1'],
    ['benchmarking v6 (2001:2::/48)', '2001:2::1'],
    ['benchmarking v6, top of the /48', '2001:2:0:ffff::1'],
    ['ORCHID (2001:10::/28)', '2001:10::1'],
    ['ORCHID top of the /28', '2001:1f:ffff::1'],
    ['ORCHIDv2 (2001:20::/28)', '2001:20::1'],
    ['ORCHIDv2 top of the /28', '2001:2f::1'],
    ['IPv4-compatible (::/96)', '::7f00:1'],
    ['discard-only (100::/64), top', '100::ffff:ffff:ffff:ffff'],
    ['NAT64 local-use (64:ff9b:1::/48)', '64:ff9b:1::1'],
    ['documentation v6', '2001:db8::1'],
    ['documentation v6 (3fff::/20, RFC 9637)', '3fff::1'],
    ['documentation v6, top of 3fff::/20', '3fff:fff:ffff::1'],
    ['6to4', '2002:7f00:1::1'],
    ['unique local', 'fd00:ec2::254'],
    ['unique local fc', 'fc00::1'],
    ['link-local v6', 'fe80::1'],
    ['link-local v6 with zone', 'fe80::1%en0'],
    ['site-local v6', 'fec0::1'],
    ['multicast v6', 'ff02::1'],
    ['bracketed loopback', '[::1]'],
    ['not an address at all', 'lessons.example.org'],
    ['empty', ''],
    ['malformed v6', '1:2:3:4:5:6:7:8:9'],
    ['malformed v6 group', '1::2::3'],
    ['non-hex v6 group', 'gggg::1'],
    ['malformed v4 tail in v6', '::ffff:999.1.1.1'],
    ['too few groups without ::', '1:2:3'],
    ['malformed v4', '1.2.3.x'],
  ])('%s (%s) is not public', (_label, ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it('a public v4 address mapped into v6 is public', () => {
    expect(isPublicAddress('::ffff:93.184.216.34')).toBe(true);
  });
});

describe('systemResolveHost', () => {
  beforeEach(() => {
    dnsState.answers.clear();
    dnsState.cancels = 0;
    dnsState.options.length = 0;
  });

  it('returns the A then the AAAA answers, from a resolver with its own timeout', async () => {
    dnsState.answers.set('A two.example', ['93.184.216.34']);
    dnsState.answers.set('AAAA two.example', ['2606:4700:4700::1111']);
    await expect(systemResolveHost('two.example')).resolves.toEqual([
      '93.184.216.34',
      '2606:4700:4700::1111',
    ]);
    expect(dnsState.options).toEqual([{ timeout: 2_000, tries: 2 }]);
  });

  it('one family with no records still returns the other', async () => {
    dnsState.answers.set('AAAA six.example', ['2606:4700:4700::1111']);
    await expect(systemResolveHost('six.example')).resolves.toEqual(['2606:4700:4700::1111']);
  });

  it.each([
    ['no such name', 'ENOTFOUND'],
    ['no records', 'ENODATA'],
  ])('%s in both families is a no-such-name error with fixed words', async (_l, code) => {
    dnsState.answers.set('A gone.example', dnsError(code));
    dnsState.answers.set('AAAA gone.example', dnsError('ENODATA'));
    const err = await systemResolveHost('gone.example').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'ENOTFOUND', message: 'dns: no such name' });
  });

  it('a transient failure (SERVFAIL, timeout) keeps its code so the caller can retry', async () => {
    dnsState.answers.set('A flaky.example', dnsError('ESERVFAIL'));
    dnsState.answers.set('AAAA flaky.example', dnsError('ENODATA'));
    const err = await systemResolveHost('flaky.example').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'ESERVFAIL', message: 'dns: lookup failed' });
    expect(String((err as Error).message)).not.toContain('flaky');
  });

  it('an empty answer counts as no records; a failure with no code is transient', async () => {
    dnsState.answers.set('A odd.example', []);
    dnsState.answers.set('AAAA odd.example', new Error('no code at all'));
    const err = await systemResolveHost('odd.example').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'EUNKNOWN', message: 'dns: lookup failed' });
    dnsState.answers.set('AAAA odd.example', []);
    await expect(systemResolveHost('odd.example')).rejects.toMatchObject({ code: 'ENOTFOUND' });
  });

  it('queries with a short per-query limit: every retry fits well inside the 15 s fetch deadline', async () => {
    dnsState.options.length = 0;
    dnsState.answers.set('A t.example', ['93.184.216.34']);
    dnsState.answers.set('AAAA t.example', ['2606:4700:4700::1111']);
    await systemResolveHost('t.example');
    const [opts] = dnsState.options as { timeout: number; tries: number }[];
    // c-ares doubles the timeout on each retry: the total wait is timeout * (2^tries - 1).
    expect(opts).toBeDefined();
    expect((opts?.timeout ?? 0) * (2 ** (opts?.tries ?? 0) - 1)).toBeLessThanOrEqual(6_000);
  });

  it('does not wait for a dropped AAAA query once A has answered', async () => {
    vi.useFakeTimers();
    try {
      dnsState.answers.set('A half.example', ['93.184.216.34']);
      dnsState.answers.set('AAAA half.example', 'hang');
      const p = systemResolveHost('half.example');
      await vi.advanceTimersByTimeAsync(FAMILY_GRACE_MS);
      await expect(p).resolves.toEqual(['93.184.216.34']);
      expect(dnsState.cancels).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps waiting when the first family answered with nothing', async () => {
    vi.useFakeTimers();
    try {
      dnsState.answers.set('A late6.example', []);
      dnsState.answers.set('AAAA late6.example', 'hang');
      const p = systemResolveHost('late6.example');
      let done = false;
      void p.then(
        () => (done = true),
        () => (done = true),
      );
      await vi.advanceTimersByTimeAsync(FAMILY_GRACE_MS * 3);
      expect(done).toBe(false);
      expect(dnsState.cancels).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the resolver when the signal aborts, and stops listening afterwards', async () => {
    dnsState.answers.set('A slow.example', 'hang');
    dnsState.answers.set('AAAA slow.example', 'hang');
    const controller = new AbortController();
    const p = systemResolveHost('slow.example', controller.signal);
    controller.abort();
    await expect(p).rejects.toMatchObject({ code: 'ECANCELLED' });
    expect(dnsState.cancels).toBe(1);
    controller.signal.dispatchEvent(new Event('abort'));
    expect(dnsState.cancels).toBe(1);
  });

  it('an already-aborted signal cancels before any answer is used', async () => {
    dnsState.answers.set('A late.example', 'hang');
    dnsState.answers.set('AAAA late.example', 'hang');
    await expect(systemResolveHost('late.example', AbortSignal.abort())).rejects.toMatchObject({
      code: 'ECANCELLED',
    });
    expect(dnsState.cancels).toBe(1);
  });
});
