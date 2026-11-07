import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const exports = {};
const js = ts.transpileModule(readFileSync(new URL('../src/core/diagnosticsExport.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInNewContext(js, { exports, require: () => ({ sourceRefreshTrace: { read: () => ({ active: null, completed: [] }) } }) });

test('shareable diagnostics redact addresses and credentials in errors and extra fields', () => {
  const report = exports.formatDiagnosticsExport({
    diagnostics: { channels: 123, epgError: 'Redirect failed: http://example.test/live/private-user/private-password/123.ts' },
    extras: { rawError: 'token=secret-value password=private-value Bearer abc123.xyz', escaped: 'https:\\/\\/example.test/private-path', bufferMs: 3200 },
  });
  for (const sensitive of ['example.test', 'private-user', 'private-password', 'secret-value', 'private-value', 'abc123.xyz', 'private-path']) {
    assert.equal(report.includes(sensitive), false, sensitive);
  }
  assert.match(report, /channels=123/);
  assert.match(report, /bufferMs=3200/);
  assert.match(report, /provider address hidden/);
});
