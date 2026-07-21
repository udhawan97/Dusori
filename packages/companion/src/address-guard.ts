import { isIP } from 'node:net';

function ipv4ToInt(address: string): number {
  return address.split('.').reduce((total, octet) => total * 256 + Number.parseInt(octet, 10), 0);
}

const blockedV4Ranges: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function blockedV4(address: string): boolean {
  const value = ipv4ToInt(address);
  return blockedV4Ranges.some(
    ([base, bits]) => value >>> (32 - bits) === ipv4ToInt(base) >>> (32 - bits),
  );
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedV4(address);
  if (family !== 6) return true;

  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;

  const dottedMapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized);
  if (dottedMapped) return blockedV4(dottedMapped[1]);
  const hexMapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/u.exec(normalized);
  if (hexMapped) {
    const high = Number.parseInt(hexMapped[1], 16);
    const low = Number.parseInt(hexMapped[2], 16);
    return blockedV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }

  const firstGroup = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
  if (firstGroup >= 0xfc00 && firstGroup <= 0xfdff) return true; // unique local fc00::/7
  if (firstGroup >= 0xfe80 && firstGroup <= 0xfeff) return true; // link-local + site-local
  return false;
}
