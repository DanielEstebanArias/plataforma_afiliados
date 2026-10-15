import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AffiliatePasswordRecovery } from '../src/affiliates/password-recovery';

test('password recovery stays safely prepared when Resend variables are absent', async () => {
  const previous = [process.env.RESEND_API_KEY, process.env.RESEND_FROM_EMAIL, process.env.PUBLIC_APP_URL];
  delete process.env.RESEND_API_KEY; delete process.env.RESEND_FROM_EMAIL; delete process.env.PUBLIC_APP_URL;
  try {
    const recovery = new AffiliatePasswordRecovery({ loginCandidates: async () => { throw new Error('must not reveal or query invalid email'); } } as any);
    assert.deepEqual(await recovery.request('not-an-email'), { ok: true, mailReady: false });
  } finally {
    [process.env.RESEND_API_KEY, process.env.RESEND_FROM_EMAIL, process.env.PUBLIC_APP_URL] = previous;
  }
});

test('one-time recovery token changes password and invalidates existing sessions', async () => {
  const token = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV';
  const digest = createHash('sha256').update(token).digest('hex');
  let savedPassword = '', used = false, sessionsDeleted = false;
  const tx = {
    affiliatePasswordReset: {
      findFirst: async ({ where }: any) => where.tokenDigest === digest && !used ? ({ id: 'reset', tenantId: '22222222-2222-4222-8222-222222222222', networkId: '11111111-1111-4111-8111-111111111111', memberId: '33333333-3333-4333-8333-333333333333' }) : null,
      update: async () => (used = true),
    },
    affiliateMember: { update: async ({ data }: any) => (savedPassword = data.password) },
    affiliateSession: { deleteMany: async () => (sessionsDeleted = true) },
    auditLog: { create: async () => ({}) },
  };
  const store = { tx: async (fn: any) => fn(tx, { tenantId: '22222222-2222-4222-8222-222222222222' }) } as any;
  const recovery = new AffiliatePasswordRecovery(store);
  await recovery.consume(token, 'new-password-hash');
  assert.equal(savedPassword, 'new-password-hash');
  assert.equal(sessionsDeleted, true);
  await assert.rejects(recovery.consume(token, 'another-hash'), { status: 400 });
});
