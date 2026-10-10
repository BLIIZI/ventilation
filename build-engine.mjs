// Сборка расчётного ядра в один браузерный скрипт: снять типы TypeScript, убрать import/export, склеить по порядку зависимостей.
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const order = ['norms', 'physics', 'network', 'balance', 'sim', 'demo-network', 'scenario', 'scenario4'];
const names = [];
let out = '// Расчётное ядро vent-sim (собрано из src/engine/*.ts). Не редактировать вручную.\n(function(){\n"use strict";\n';
for (const f of order) {
  let js = stripTypeScriptTypes(readFileSync(`src/engine/${f}.ts`, 'utf8'));
  js = js.replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  js = js.replace(/^export\s+(const|function|let|class)\s+([A-Za-z0-9_]+)/gm, (_, k, n) => { names.push(n); return `${k} ${n}`; });
  if (/^\s*export\b/m.test(js)) throw new Error('осталось export в ' + f);
  out += `\n// ---- ${f}.ts\n${js}\n`;
}
out += `\nwindow.Engine = { ${names.join(', ')} };\n})();\n`;
writeFileSync('web/engine.js', out);
console.log('exports:', names.join(', '), '| bytes:', out.length);
