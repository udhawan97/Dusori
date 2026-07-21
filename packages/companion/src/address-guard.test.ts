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
];

describe('isBlockedAddress', () => {
  it.each(blocked)('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(allowed)('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});
