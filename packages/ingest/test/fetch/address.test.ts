import { describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn((host: string) =>
    host === 'two.example'
      ? Promise.resolve([
          { address: '93.184.216.34', family: 4 },
          { address: '2606:4700:4700::1111', family: 6 },
        ])
      : Promise.reject(new Error('ENOTFOUND')),
  ),
}));

const { isPublicAddress, systemResolveHost } = await import('../../src/fetch/address.js');

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
    ['documentation v6', '2001:db8::1'],
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
  it('returns every address the system resolver gives, without reordering', async () => {
    await expect(systemResolveHost('two.example')).resolves.toEqual([
      '93.184.216.34',
      '2606:4700:4700::1111',
    ]);
  });

  it('passes a lookup failure through for the caller to map', async () => {
    await expect(systemResolveHost('missing.example')).rejects.toThrow('ENOTFOUND');
  });
});
