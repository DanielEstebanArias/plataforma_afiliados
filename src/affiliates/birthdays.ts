import { PrismaClient } from '@prisma/client';

const xml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function colombiaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: value.month, day: value.day };
}

function personalizedCard(config: any, name: string) {
  const image = Buffer.from(config.birthdayCard).toString('base64');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
    <image href="data:${xml(config.birthdayCardMime || 'image/jpeg')};base64,${image}" width="1200" height="720" preserveAspectRatio="xMidYMid slice"/>
    <text x="${Number(config.birthdayNameX) * 12}" y="${Number(config.birthdayNameY) * 7.2}" text-anchor="middle" dominant-baseline="middle" fill="${xml(config.birthdayTextColor)}" font-family="Arial, sans-serif" font-size="${Number(config.birthdayFontSize)}" font-weight="700">${xml(name)}</text>
  </svg>`;
}

async function sendBirthdayEmail(member: any, svg: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BIRTHDAY_FROM_EMAIL;
  if (!apiKey || !from) throw new Error('El servicio de correo de cumpleaños no está configurado.');
  const encoded = Buffer.from(svg).toString('base64');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [member.email],
      subject: `Feliz cumpleaños, ${member.name}`,
      html: `<div style="font-family:Arial,sans-serif;text-align:center;color:#073d34"><h2>Feliz cumpleaños, ${xml(member.name)}</h2><p>Aliados por Antioquia celebra contigo este día especial.</p><img alt="Tarjeta de cumpleaños" style="width:100%;max-width:720px" src="data:image/svg+xml;base64,${encoded}"></div>`,
      attachments: [{ filename: 'tarjeta-cumpleanos.svg', content: encoded }],
    }),
  });
  const result: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.message || 'El proveedor de correo rechazó el envío.');
  return result.id as string | undefined;
}

export async function runBirthdayDelivery(prisma: PrismaClient, tenantId: string) {
  const today = colombiaToday();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
    const config = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!config?.birthdayEnabled || !config.birthdayCard)
      return { configured: !!config?.birthdayCard, sent: 0, failed: 0, pending: 0 };
    if (!process.env.RESEND_API_KEY || !process.env.BIRTHDAY_FROM_EMAIL)
      return { configured: true, mailReady: false, sent: 0, failed: 0, pending: 0 };
    const members = await tx.$queryRaw<any[]>`
      SELECT m.id,m.name,m.email FROM "AffiliateMember" m
      JOIN "AffiliateNetwork" n ON n.id=m."networkId" AND n."tenantId"=m."tenantId"
      WHERE m."tenantId"=${tenantId}::uuid AND m.status='active'
        AND n."approvalStatus"='APPROVED'
        AND substring(m.data->>'birthDate',6,5)=${today.month + '-' + today.day}
      ORDER BY m.id`;
    let sent = 0, failed = 0;
    for (const member of members) {
      const existing = await tx.affiliateBirthdayDelivery.findUnique({
        where: { tenantId_memberId_birthdayYear: { tenantId, memberId: member.id, birthdayYear: today.year } },
      });
      if (existing?.status === 'SENT') continue;
      const delivery = existing || await tx.affiliateBirthdayDelivery.create({
        data: { tenantId, memberId: member.id, birthdayYear: today.year, email: member.email },
      });
      try {
        const providerId = await sendBirthdayEmail(member, personalizedCard(config, member.name));
        await tx.affiliateBirthdayDelivery.update({ where: { id: delivery.id }, data: { status: 'SENT', providerId, error: null, sentAt: new Date() } });
        sent++;
      } catch (error: any) {
        await tx.affiliateBirthdayDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', error: String(error?.message || error).slice(0, 500) } });
        failed++;
      }
    }
    return { configured: true, sent, failed, pending: members.length - sent - failed };
  }, { timeout: 120000 });
}

export function startBirthdayScheduler(prisma: PrismaClient, tenantId?: string) {
  if (!tenantId) return;
  const run = () => void runBirthdayDelivery(prisma, tenantId).catch((error) =>
    console.error('Birthday delivery failed:', error instanceof Error ? error.message : 'Unknown error'));
  run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
}
