import dns from 'node:dns/promises';
import net from 'node:net';
import { isLinkLocal } from './targetHealth.js';

// A user-supplied host must not point at link-local addresses, which host the cloud
// instance-metadata service. The ranges (IPv4 169.254/16, fe80::/10, AWS fd00:ec2::/32 and
// IPv4-mapped forms) are the ones the target URL health check already uses, imported from
// there. Loopback and private ranges stay allowed (databases are often local).
export const isBlockedAddress = isLinkLocal;

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
