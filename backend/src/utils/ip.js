import { config } from '../config.js';

export function clientIp(req) {
  let ip = req.ip || req.socket.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

export function ipInAllowedSubnets(req) {
  if (!config.allowedSubnets.length) return true;
  const ip = clientIp(req);
  return config.allowedSubnets.some((subnet) => matchesCidr(ip, subnet));
}

function toLong(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function matchesCidr(ip, subnet) {
  const [base, bitsRaw] = subnet.split('/');
  const ipLong = toLong(ip);
  const baseLong = toLong(base);
  if (ipLong === null || baseLong === null) return false;
  const bits = Number(bitsRaw ?? 32);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipLong & mask) === (baseLong & mask);
}
