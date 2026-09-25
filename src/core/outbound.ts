import { BadRequestException } from '@nestjs/common';
import { HttpsUrl } from '../contracts/app-config.schema';
export async function approvedFetch(url: string, init: RequestInit = {}) {
  const parsed = new URL(HttpsUrl.parse(url));
  const allowed = (process.env.OUTBOUND_HOSTS ?? '').split(',').filter(Boolean);
  if (
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443') ||
    !allowed.includes(parsed.hostname)
  )
    throw new BadRequestException('Outbound host not approved');
  // Production egress policy must also block private/link-local destinations after DNS resolution.
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Outbound request failed: ' + response.status);
  return response;
}
