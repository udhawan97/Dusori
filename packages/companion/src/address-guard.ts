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
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function blockedV4(address: string): boolean {
  const value = ipv4ToInt(address);
  return blockedV4Ranges.some(
    ([base, bits]) => value >>> (32 - bits) === ipv4ToInt(base) >>> (32 - bits),
  );
}

/** Expands a valid IPv6 literal (as confirmed by node:net isIP) into its 16 bytes. */
function ipv6ToBytes(address: string): number[] | null {
  let normalized = address.toLowerCase();

  // An embedded IPv4 dotted-quad (e.g. "::ffff:192.168.1.1") counts as the
  // last two 16-bit groups; rewrite it to hex groups before expanding "::".
  const lastColon = normalized.lastIndexOf(':');
  const tail = normalized.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToInt(tail);
    const high = ((v4 >>> 16) & 0xffff).toString(16);
    const low = (v4 & 0xffff).toString(16);
    normalized = `${normalized.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const doubleColon = normalized.indexOf('::');
  let groups: string[];
  if (doubleColon !== -1) {
    const left = normalized.slice(0, doubleColon);
    const right = normalized.slice(doubleColon + 2);
    const leftGroups = left === '' ? [] : left.split(':');
    const rightGroups = right === '' ? [] : right.split(':');
    const missing = 8 - (leftGroups.length + rightGroups.length);
    if (missing < 0) return null;
    groups = [...leftGroups, ...Array(missing).fill('0'), ...rightGroups];
  } else {
    groups = normalized.split(':');
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group || '0', 16);
    if (Number.isNaN(value)) return null;
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function embeddedV4(bytes: number[], offset: number): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

function blockedV6(bytes: number[]): boolean {
  // Multicast ff00::/8
  if (bytes[0] === 0xff) return true;

  // IPv4-mapped ::ffff:0:0/96 — unwrap and re-check as IPv4.
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return blockedV4(embeddedV4(bytes, 12));
  }

  // NAT64 64:ff9b::/96 — unwrap and re-check as IPv4.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((b) => b === 0)
  ) {
    return blockedV4(embeddedV4(bytes, 12));
  }

  // 6to4 2002::/16 — embedded IPv4 lives in bytes 2-5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return blockedV4(embeddedV4(bytes, 2));
  }

  // IPv4-compatible ::/96 (also covers :: and ::1) — unwrap and re-check as IPv4.
  if (bytes.slice(0, 12).every((b) => b === 0)) {
    return blockedV4(embeddedV4(bytes, 12));
  }

  // Unique local fc00::/7
  if ((bytes[0]! & 0xfe) === 0xfc) return true;

  // Link-local fe80::/10
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true;

  // Site-local fec0::/10
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return true;

  // Documentation 2001:db8::/32
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;

  // Discard-only 100::/64
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && bytes.slice(2, 8).every((b) => b === 0)) return true;

  return false;
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedV4(address);
  if (family !== 6) return true;

  const bytes = ipv6ToBytes(address);
  if (!bytes) return true; // fail closed on anything we can't parse

  return blockedV6(bytes);
}
