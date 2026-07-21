import { describe, expect, it } from 'vitest';

import { isBlockedAddress } from './address-guard.js';

const blocked = [
  '0.0.0.1',
  '10.0.0.5',
  '100.64.1.1',
  '127.0.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '172.31.255.255',
  '192.0.0.1',
  '192.168.1.1',
  '198.18.0.1',
  '224.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  'fc00::1',
  'fd12:3456::1',
  'fe80::1',
  'fec0::1',
  '::ffff:10.0.0.1',
  '::ffff:a00:1',
  '0::1',
  '0:0:0:0:0:0:0:1',
  'ff02::1',
  'ff00::',
  '2002:c0a8:101::',
  '64:ff9b::c0a8:101',
  '::192.168.1.1',
  '::ffff:192.168.1.1',
  '2001:db8::1',
  '100::1',
  // local-use NAT64 64:ff9b:1::/48 (RFC 8215) — embedded IPv4 sits at
  // bytes[6],[7],[9],[10] per RFC 6052 §2.2, not contiguous bytes 12-15.
  '64:ff9b:1:a00:0:500::', // embeds 10.0.0.5
  '64:ff9b:1:7f00:0:100::', // embeds 127.0.0.1
  '64:ff9b:1:c0a8:1:100::', // embeds 192.168.1.1
  // IPv4-translated ::ffff:0:0:0/96 (RFC 2765 / SIIT) — ffff marker at
  // bytes 8-9 (not 10-11 like IPv4-mapped), IPv4 in bytes 12-15.
  '::ffff:0:10.0.0.5',
  '::ffff:0:127.0.0.1',
  // Benchmarking 2001:2::/48 (RFC 5180) — reserved, blocked outright.
  '2001:2::1',
  '2001:2:0:1::1',
  '192.0.2.1',
  '198.51.100.1',
  '203.0.113.1',
  'not-an-ip',
  'localhost',
];

const allowed = [
  '1.1.1.1',
  '8.8.8.8',
  '93.184.215.14',
  '172.15.0.1',
  '172.32.0.1',
  '192.167.0.1',
  '198.17.0.1',
  '2606:4700:4700::1111',
  '2620:fe::fe',
  // Public IPv4 embedded under the local-use NAT64 /48 prefix must stay
  // allowed — proves we unwrap and re-check, not blanket-block the prefix.
  '64:ff9b:1:808:8:800::', // embeds 8.8.8.8
];

describe('isBlockedAddress', () => {
  it.each(blocked)('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(allowed)('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});
