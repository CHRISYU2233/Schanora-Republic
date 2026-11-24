import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const window = {};
runInNewContext(await readFile(new URL('../web/engineering-tools.js', import.meta.url), 'utf8'), { window });
const { convert, compareFields } = window.__SCHANORA_ENGINEERING_TOOLS__;

test('engineering conversion keeps dimensions separate and handles absolute temperature', () => {
  assert.equal(convert('length', '1', 'in', 'mm'), '1 in = 25.4 mm');
  assert.equal(convert('torque', '37', 'N·m', 'N·mm'), '37 N·m = 37000 N·mm');
  assert.equal(convert('temperature', '32', '°F', '°C'), '32 °F = 0 °C');
  assert.equal(convert('temperature', '0', 'K', '°C'), '0 K = -273.15 °C');
  assert.throws(() => convert('temperature', '-1', 'K', '°C'), /value/);
  assert.throws(() => convert('length', '10', 'in', 'N·m'), /units/);
  assert.throws(() => convert('torque', '0x10', 'N·m', 'N·mm'), /value/);
});

test('revision comparison returns unchanged, added, removed and modified fields accurately', () => {
  const differences = compareFields('扭矩：37 N·m\n公差: ±2 N·m\n版本: B', '扭矩：40 N·m\n版本: B\n检验: 100%');
  assert.deepEqual(JSON.parse(JSON.stringify(differences)), [
    { name: '扭矩', previous: '37 N·m', current: '40 N·m' },
    { name: '公差', previous: '±2 N·m' },
    { name: '检验', current: '100%' },
  ]);
  assert.equal(compareFields('公差: ±2 N·m', '公差 = ±2 N·m').length, 0);
  assert.throws(() => compareFields('扭矩: 37 N·m\n扭矩: 40 N·m', '扭矩: 42 N·m'), /duplicate/);
  assert.throws(() => compareFields('not a field', '扭矩: 42 N·m'), /format/);
});
