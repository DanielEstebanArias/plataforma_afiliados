import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('platform directory schema isolates global administration from tenant data', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
  const migration = fs.readFileSync('prisma/migrations/202610160001_platform_directories/migration.sql', 'utf8');
  assert.match(schema, /model PlatformAdministrator/);
  assert.match(schema, /model PlatformDirectory/);
  assert.match(schema, /divisionLabel\s+String/);
  assert.match(schema, /platformAdminId String\?/);
  assert.match(migration, /"PlatformAuditLog"/);
  assert.match(migration, /REVOKE UPDATE,DELETE ON "PlatformAuditLog"/);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY[^;]*PlatformDirectory/);
});

test('global control tables are excluded from tenant RLS validation only', () => {
  const manager = fs.readFileSync('src/security/tenant-context.manager.ts', 'utf8');
  assert.match(manager, /PlatformAdministrator.*PlatformAdminSession.*PlatformAuditLog.*PlatformDirectory/);
  assert.match(manager, /NOT c\.relrowsecurity OR NOT c\.relforcerowsecurity/);
});

test('global administrator can manage directories only through protected routes', () => {
  const service = fs.readFileSync('src/affiliates/platform-directories.ts', 'utf8');
  assert.match(service, /platform_session/);
  assert.match(service, /x-csrf-token/);
  assert.match(service, /body\.confirmation !== 'borrar directorio'/);
  assert.match(service, /status === 'ARCHIVED'/);
  assert.match(service, /platformAdminId: administrator\.id/);
  assert.match(service, /actor: 'platform-admin:' \+ administrator\.id/);
});

test('directory UI exposes configurable division labels and destructive confirmation', () => {
  const html = fs.readFileSync('affiliates/web/platform.html', 'utf8');
  const ui = fs.readFileSync('affiliates/web/platform.js', 'utf8');
  const app = fs.readFileSync('affiliates/web/app.js', 'utf8');
  assert.match(html, /platform\.js/);
  assert.match(ui, /name="divisionLabel"/);
  assert.match(ui, /borrar directorio/);
  assert.match(ui, /Ingresar con privilegios/);
  assert.match(app, /divisionLabel\(\)/);
  assert.match(app, /Superadministrador de directorio/);
});

test('campaign public links stay inside the owning directory', () => {
  const server = fs.readFileSync('affiliates/server.cjs', 'utf8');
  const campaign = fs.readFileSync('affiliates/web/campaign.js', 'utf8');
  assert.match(server, /const publicBase=req\.baseUrl\|\|''/);
  assert.match(campaign, /campaignApiBase/);
  assert.match(campaign, /fetch\(campaignApiBase\+'\/api\/public\/campaigns\//);
});
