const fs = require('node:fs');
const cp = require('node:child_process');
const dir = 'prisma/migrations/202609240001_init';
fs.mkdirSync(dir, { recursive: true });
const schema = cp.execFileSync(
  process.execPath,
  [
    'node_modules/prisma/build/index.js',
    'migrate',
    'diff',
    '--from-empty',
    '--to-schema-datamodel',
    'prisma/schema.prisma',
    '--script',
  ],
  { encoding: 'utf8' },
);
const sql = [
  fs.readFileSync('prisma/extensions.sql', 'utf8'),
  schema,
  fs.readFileSync('prisma/rls.sql', 'utf8'),
  fs.readFileSync('prisma/dynamic-tables.sql', 'utf8'),
].join('\n');
fs.writeFileSync(dir + '/migration.sql', sql);
