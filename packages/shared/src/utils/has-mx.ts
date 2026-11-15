import { promises as dns } from "dns";

const PRIVATE_IPV4 = [
  /^0\./, // "this" network
  /^10\./,
  /^127\./, // loopback
  /^169\.254\./, // link-local
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT
  /^2(2[4-9]|[3-5]\d)\./, // multicast and reserved
];

const isPublicIp = (ip: string): boolean => {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    if (v6 === "::" || v6 === "::1") return false;
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return false; // ULA, link-local
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPublicIp(mapped[1]) : true;
  }
  return !PRIVATE_IPV4.some((range) => range.test(ip));
};

const resolvesToPublicIp = async (host: string) => {
  const [v4, v6] = await Promise.all([
    dns.resolve4(host).catch(() => [] as string[]),
    dns.resolve6(host).catch(() => [] as string[]),
  ]);
  return [...v4, ...v6].some(isPublicIp);
};

/**
 * True when the domain has at least one MX host that resolves to a public IP.
 * Parked and dead domains often have MX records pointing at hosts that don't
 * exist, or at 127.0.0.1 / 0.0.0.0, and every email to them hard-bounces.
 */
const hasMX = async (domain: string) => {
  try {
    const records = await dns.resolveMx(domain);
    // "." is a null MX (RFC 7505): the domain explicitly accepts no mail.
    const hosts = records
      .map((mx) => mx.exchange)
      .filter((host) => host && host !== ".");
    if (!hosts.length) return false;

    const results = await Promise.all(hosts.map(resolvesToPublicIp));
    return results.some(Boolean);
  } catch {
    return false;
  }
};

export default hasMX;
