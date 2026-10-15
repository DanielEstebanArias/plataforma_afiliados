import { createHash, randomBytes } from 'node:crypto';
import type { AffiliatesStore } from './store';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const html = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export class AffiliatePasswordRecovery {
  constructor(private store: AffiliatesStore) {}

  get mailReady() {
    return !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL && !!process.env.PUBLIC_APP_URL;
  }

  async request(email: string) {
    const normalized = typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
    if (!/^\S+@\S+\.\S+$/.test(normalized)) return { ok: true, mailReady: this.mailReady };
    const candidates = await this.store.loginCandidates(normalized);
    if (!this.mailReady) return { ok: true, mailReady: false };
    const base = new URL(process.env.PUBLIC_APP_URL!);
    for (const candidate of candidates) {
      try { await candidate.store.features.access(candidate.member.id); } catch { continue; }
      const token = randomBytes(32).toString('base64url');
      await candidate.store.tx(async (tx, n) => {
        await tx.affiliatePasswordReset.deleteMany({ where: { tenantId: n.tenantId, networkId: n.id, memberId: candidate.member.id, usedAt: null } });
        await tx.affiliatePasswordReset.create({ data: { tenantId: n.tenantId, networkId: n.id, memberId: candidate.member.id, tokenDigest: digest(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
      });
      const link = new URL(base); link.searchParams.set('reset', token);
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL, to: [candidate.member.email], subject: 'Recupera tu acceso a Aliados por Antioquia',
        html: `<div style="font-family:Arial,sans-serif;color:#073d34;max-width:600px;margin:auto"><h2>Recuperación de contraseña</h2><p>Hola, ${html(candidate.member.name)}.</p><p>Recibimos una solicitud para cambiar tu contraseña en ${html(candidate.name)}.</p><p><a href="${html(link.toString())}" style="display:inline-block;background:#073d34;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">Crear nueva contraseña</a></p><p>El enlace vence en 30 minutos y solo puede utilizarse una vez. Si no hiciste esta solicitud, ignora este correo.</p></div>`,
      }) });
      if (!response.ok) console.error('Password recovery email rejected:', response.status);
    }
    return { ok: true, mailReady: true };
  }

  async consume(token: string, passwordHash: string) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,80}$/.test(token)) throw Object.assign(new Error('El enlace no es válido o ya venció.'), { status: 400 });
    return this.store.tx(async (tx, n) => {
      const reset = await tx.affiliatePasswordReset.findFirst({ where: { tenantId: n.tenantId, tokenDigest: digest(token), usedAt: null, expiresAt: { gt: new Date() } } });
      if (!reset) throw Object.assign(new Error('El enlace no es válido o ya venció.'), { status: 400 });
      await tx.affiliatePasswordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
      await tx.affiliateMember.update({ where: { tenantId_networkId_id: { tenantId: reset.tenantId, networkId: reset.networkId, id: reset.memberId } }, data: { password: passwordHash } });
      await tx.affiliateSession.deleteMany({ where: { tenantId: reset.tenantId, networkId: reset.networkId, memberId: reset.memberId } });
      await tx.auditLog.create({ data: { tenantId: reset.tenantId, actor: `affiliate:${reset.memberId}`, action: 'affiliate.password.recovered', resourceId: reset.memberId, details: { networkId: reset.networkId } } });
      return { ok: true };
    });
  }
}
