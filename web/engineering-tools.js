(function () {
  'use strict';

  const poundForce = 4.4482216152605;
  const dimensions = {
    length: { mm: 0.001, μm: 0.000001, m: 1, in: 0.0254 },
    force: { N: 1, kN: 1000, lbf: poundForce },
    pressure: { MPa: 1000000, kPa: 1000, bar: 100000, psi: poundForce / (0.0254 ** 2) },
    torque: { 'N·m': 1, 'N·mm': 0.001, 'lbf·ft': poundForce * 0.3048 },
    speed: { rpm: 2 * Math.PI / 60, 'rad/s': 1 },
    temperature: { '°C': 1, '°F': 5 / 9, K: 1 },
  };
  const absoluteZero = { '°C': -273.15, '°F': -459.67, K: 0 };
  const celsiusFrom = { '°C': (value) => value, '°F': (value) => (value - 32) * 5 / 9, K: (value) => value - 273.15 };
  const celsiusTo = { '°C': (value) => value, '°F': (value) => value * 9 / 5 + 32, K: (value) => value + 273.15 };

  function convert(dimension, valueText, from, to) {
    const units = Object.hasOwn(dimensions, dimension) && dimensions[dimension];
    if (!units || !Object.hasOwn(units, from) || !Object.hasOwn(units, to)) throw new Error('units');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(valueText.trim())) throw new Error('value');
    const value = Number(valueText);
    if (!Number.isFinite(value) || (dimension === 'temperature' && value < absoluteZero[from])) throw new Error('value');
    const result = dimension === 'temperature'
      ? celsiusTo[to](celsiusFrom[from](value))
      : value * (units[from] / units[to]);
    if (!Number.isFinite(result)) throw new Error('value');
    return `${value} ${from} = ${Number(result.toPrecision(12))} ${to}`;
  }

  function readFields(text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length || lines.length > 16 || text.length > 900) throw new Error('lines');
    const fields = new Map();
    for (const line of lines) {
      const match = /^\s*([^:=：]+)\s*[:=：]\s*(\S.*)\s*$/.exec(line);
      if (!match) throw new Error('format');
      const key = match[1].trim();
      if (!key) throw new Error('format');
      if (fields.has(key)) throw new Error('duplicate');
      fields.set(key, match[2].trim());
    }
    return fields;
  }

  function compareFields(before, after) {
    const oldFields = readFields(before);
    const newFields = readFields(after);
    const rows = [];
    for (const [name, previous] of oldFields) {
      const current = newFields.get(name);
      if (previous !== current) rows.push({ name, previous, current });
    }
    for (const [name, current] of newFields) {
      if (!oldFields.has(name)) rows.push({ name, current });
    }
    return rows;
  }

  window.__SCHANORA_ENGINEERING_TOOLS__ = { dimensions, convert, compareFields };
})();
