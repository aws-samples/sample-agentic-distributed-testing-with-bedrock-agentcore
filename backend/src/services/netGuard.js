import dns from 'node:dns/promises';
import net from 'node:net';

// Addresses a user-supplied host must not point at: link-local, which hosts the cloud
// instance-metadata service. Loopback and private ranges stay allowed (databases and the app
// under test are often local). The same approach and ranges as the target URL health check
// (services/targetHealth.js, PR #51): BlockList matches IPv4-mapped IPv6 (::ffff:a.b.c.d)
// against its IPv4 rules, and the third rule is the AWS IPv6 metadata range.
// shortcut: duplicated until #51 is merged; then both should import one helper from here.
const blocked = new net.BlockList();
blocked.addSubnet('169.254.0.0', 16, 'ipv4');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet(['fd00', 'ec2', ''].join(':') + ':', 32, 'ipv6');

export const isBlockedAddress = (ip) => blocked.check(ip, net.isIPv4(ip) ? 'ipv4' : 'ipv6');

/**
 * Resolve a host once and refuse link-local / metadata addresses. Returns the address to connect
 * to, so a second DNS answer (rebinding) cannot change the target after the check.
 */
export async function resolveAllowedHost(host, timeoutMs = 5000) {
  const h = String(host).replace(/^\[|\]$/g, '');
  const addrs = net.isIP(h) ? [{ address: h }] : await Promise.race([
    dns.lookup(h, { all: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs)),
  ]);
  if (addrs.some(a => isBlockedAddress(a.address))) throw new Error('Link-local and cloud-metadata addresses are not allowed');
  return addrs[0].address;
}
