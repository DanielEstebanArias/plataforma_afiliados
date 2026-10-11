import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('el catálogo contiene 125 municipios únicos y el formulario usa selección asistida', () => {
  const source = fs.readFileSync('affiliates/web/antioquia.js', 'utf8');
  const context: any = {};
  vm.createContext(context);
  vm.runInContext(source + ';globalThis.result=ANTIOQUIA_MUNICIPALITIES', context);
  assert.equal(context.result.length, 125);
  assert.equal(new Set(context.result).size, 125);
  for (const municipality of ['Medellín', 'Itagüí', 'Santa Fe de Antioquia', 'San Vicente Ferrer'])
    assert.ok(context.result.includes(municipality));
  const app = fs.readFileSync('affiliates/web/app.js', 'utf8');
  assert.match(app, /data-municipality/);
  assert.match(app, /normalizeMunicipality/);
  assert.match(app, /ANTIOQUIA_MUNICIPALITIES\.includes/);
});

test('la configuración territorial es cerrada, idempotente y usa 1.001 aliados ficticios', () => {
  const script = fs.readFileSync('scripts/configure-antioquia.ts', 'utf8');
  for (const name of ['Valle de Aburrá','Bajo Cauca','Norte','Nordeste','Suroeste','Occidente','Oriente','Urabá','Magdalena Medio'])
    assert.ok(script.includes(`'${name}'`));
  for (const label of ['Nombres','Apellidos','Número de cédula','Municipio','Barrio','Fecha de nacimiento','Número de celular','Aporte en votos'])
    assert.ok(script.includes(`label: '${label}'`));
  assert.match(script, /length: 1001/);
  assert.match(script, /FICTICIA-VA-/);
  assert.match(script, /demo\.aliados-antioquia\.invalid/);
});
