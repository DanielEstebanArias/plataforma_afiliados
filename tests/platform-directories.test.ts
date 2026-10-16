import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('platform directory schema isolates global administration from tenant data', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
  const migration = fs.readFileSync(
    'prisma/migrations/202610160001_platform_directories/migration.sql',
    'utf8',
  );
  const colorsMigration = fs.readFileSync(
    'prisma/migrations/202610160002_directory_colors/migration.sql',
    'utf8',
  );
  assert.match(schema, /model PlatformAdministrator/);
  assert.match(schema, /model PlatformDirectory/);
  assert.match(schema, /divisionLabel\s+String/);
  assert.match(schema, /primaryColor\s+String\s+@default\("#073d34"\)/);
  assert.match(colorsMigration, /"accentColor"/);
  assert.match(schema, /platformAdminId String\?/);
  assert.match(migration, /"PlatformAuditLog"/);
  assert.match(migration, /REVOKE UPDATE,DELETE ON "PlatformAuditLog"/);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY[^;]*PlatformDirectory/);
});

test('global control tables are excluded from tenant RLS validation only', () => {
  const manager = fs.readFileSync('src/security/tenant-context.manager.ts', 'utf8');
  assert.match(
    manager,
    /PlatformAdministrator.*PlatformAdminSession.*PlatformAuditLog.*PlatformDirectory/,
  );
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
  assert.match(service, /email !== permanentAdminEmail/);
  assert.match(service, /activeSession\.administrator\.email !== permanentAdminEmail/);
});

test('directory login and identity checks span every division', () => {
  const server = fs.readFileSync('affiliates/server.cjs', 'utf8');
  const store = fs.readFileSync('src/affiliates/store.ts', 'utf8');
  const features = fs.readFileSync('src/affiliates/features.ts', 'utf8');
  const campaigns = fs.readFileSync('src/affiliates/campaigns.ts', 'utf8');
  assert.match(server, /if \(db\.loginCandidates\)/);
  assert.doesNotMatch(server, /loginCandidates && !req\.baseUrl/);
  assert.match(store, /assertDirectoryIdentityAvailable/);
  assert.match(store, /AffiliateMember/);
  assert.match(store, /AffiliateCampaignEntry/);
  assert.match(store, /correo electrónico ya está registrado en otra división/);
  assert.match(store, /número de cédula ya está registrado en otra división/);
  assert.match(features, /await assertDirectoryIdentityAvailable/);
  assert.match(campaigns, /await assertDirectoryIdentityAvailable/);
});

test('directory UI exposes configurable division labels and destructive confirmation', () => {
  const html = fs.readFileSync('affiliates/web/platform.html', 'utf8');
  const ui = fs.readFileSync('affiliates/web/platform.js', 'utf8');
  const app = fs.readFileSync('affiliates/web/app.js', 'utf8');
  assert.match(html, /platform\.js/);
  assert.match(ui, /name="divisionLabel"/);
  assert.match(ui, /borrar directorio/);
  assert.match(ui, /Ingresar con privilegios/);
  assert.match(ui, /Administrar directorio/);
  assert.match(ui, /editDirectory/);
  assert.match(ui, /Nueva contraseña, opcional/);
  assert.doesNotMatch(ui, /Volver al directorio/);
  assert.match(ui, /name="primaryColor"/);
  assert.match(ui, /Copiar enlace/);
  assert.match(ui, /navigator\.share/);
  assert.match(app, /divisionLabel\(\)/);
  assert.match(app, /applyDirectoryTheme/);
  assert.match(app, /Superadministrador de directorio/);
  assert.doesNotMatch(ui, /Gran superadministrador/i);
  assert.doesNotMatch(app, /Gran superadministrador/i);
});

test('division heading uses only the configured name', () => {
  const features = fs.readFileSync('affiliates/web/features-ui.js', 'utf8');
  assert.match(features, /<h1>\$\{esc\(divisions\)\}<\/h1>/);
  assert.doesNotMatch(features, /que crecen|Las nuevas divisiones necesitan/);
});

test('directory editing keeps branding, primary division and root account synchronized', () => {
  const service = fs.readFileSync('src/affiliates/platform-directories.ts', 'utf8');
  assert.match(service, /method === 'PUT'/);
  assert.match(service, /primaryDivisionName/);
  assert.match(service, /tx\.app\.update/);
  assert.match(service, /tx\.affiliateNetwork\.update/);
  assert.match(service, /tx\.affiliateMember\.update/);
  assert.match(service, /await mirrorMember/);
  assert.match(service, /action: 'directory\.updated'/);
  assert.match(service, /credentialsChanged/);
});

test('campaign public links stay inside the owning directory', () => {
  const server = fs.readFileSync('affiliates/server.cjs', 'utf8');
  const campaign = fs.readFileSync('affiliates/web/campaign.js', 'utf8');
  assert.match(server, /const publicBase=req\.baseUrl\|\|''/);
  assert.match(campaign, /campaignApiBase/);
  assert.match(campaign, /fetch\(campaignApiBase\+'\/api\/public\/campaigns\//);
});
