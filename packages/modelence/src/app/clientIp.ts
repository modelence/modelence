import type { Application, Request } from 'express';
import type { IncomingMessage } from 'http';
import proxyaddr from 'proxy-addr';
import { getSecurityConfig } from './securityConfig';

type ClientIpRequest = Pick<IncomingMessage, 'headers' | 'socket'>;

export function configureTrustedProxies(app: Application) {
  app.set('trust proxy', getTrustedProxySetting());
}

function getTrustedProxySetting() {
  const { trustedProxies } = getSecurityConfig();
  const envTrustedProxies = parseTrustedProxies(process.env.MODELENCE_TRUSTED_PROXIES);
  const trustProxy = envTrustedProxies ?? trustedProxies;
  // Preserve the existing behavior for apps without proxy settings.
  return trustProxy === undefined ? true : trustProxy;
}

function parseTrustedProxies(value: string | undefined): string[] | undefined {
  const entries = value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries?.length ? entries : undefined;
}

function getTrustedHeaderIp(
  req: ClientIpRequest,
  isTrustedPeer: (address: string) => boolean
): string | undefined {
  const { clientIpHeader } = getSecurityConfig();
  const peerIp = req.socket?.remoteAddress;
  // A direct caller can set this header, so only accept it from a trusted peer.
  if (!clientIpHeader || !peerIp || !isTrustedPeer(peerIp)) {
    return undefined;
  }

  const value = req.headers[clientIpHeader.toLowerCase()];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

export function getClientIp(req: Request): string | undefined {
  const headerIp = getTrustedHeaderIp(req, (peerIp) => {
    const trust = req.app?.get?.('trust proxy fn');
    return typeof trust === 'function'
      ? Boolean(trust(peerIp, 0))
      : req.app?.get?.('trust proxy') !== false;
  });
  const ip = headerIp || req.ip || req.socket?.remoteAddress;
  return ip ? normalizeIp(ip) : undefined;
}

export function createClientIpResolver() {
  const setting = getTrustedProxySetting();
  const ranges =
    typeof setting === 'string' ? setting.split(',').map((value) => value.trim()) : setting;
  const trust = ranges === true ? () => true : proxyaddr.compile(ranges || []);

  return (req: IncomingMessage): string | undefined => {
    if (!req.socket?.remoteAddress) {
      return undefined;
    }
    const headerIp = getTrustedHeaderIp(req, (peerIp) => trust(peerIp, 0));
    return normalizeIp(headerIp ?? proxyaddr(req, trust));
  };
}

function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
