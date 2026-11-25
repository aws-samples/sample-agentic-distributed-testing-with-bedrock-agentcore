// The keys that switch off OpenCode's shell and file tools (`tools` and `permission` in opencode.json)
// are checked against the OpenCode version both runtimes pin. Without a binary only the pin is checked;
// with one, OpenCode itself resolves the agent and says which tools are denied:
//   npm install -g opencode-ai@<pinned version> && OPENCODE_BIN=opencode npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DISABLED_BUILTIN_TOOLS, DENIED_PERMISSIONS } from '../src/db-util.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const pins = ['../Dockerfile', '../../agent-runtime-agentcore/app/Dockerfile'].map(f => {
  const t = read(f);
  const arg = /^ARG OPENCODE_VERSION=(\d+\.\d+\.\d+)$/m.exec(t)?.[1];
  assert.ok(/npm install -g opencode-ai@\$\{OPENCODE_VERSION\}/.test(t), `${f} installs the pinned version`);
  return arg;
});

test('both runtime images install the same exact OpenCode version (not @latest)', () => {
  assert.ok(pins[0], 'ARG OPENCODE_VERSION=x.y.z in the local Dockerfile');
  assert.equal(pins[0], pins[1]);
});

const bin = process.env.OPENCODE_BIN;
test('the pinned OpenCode denies the agent its shell, file and web tools', { skip: !bin && 'set OPENCODE_BIN to an installed OpenCode to run' }, () => {
  assert.equal(execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim(), pins[0], 'installed OpenCode is the pinned version');
  const home = mkdtempSync(join(tmpdir(), 'ocperm-'));
  const resolve = (cfg) => {
    const file = join(home, 'opencode.json');
    writeFileSync(file, JSON.stringify(cfg));
    const out = execFileSync(bin, ['debug', 'agent', 'build'], {
      cwd: home, encoding: 'utf8', env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home, XDG_STATE_HOME: home, OPENCODE_CONFIG: file },
    });
    const agent = JSON.parse(out.slice(out.indexOf('{')));
    // The last matching rule wins.
    return (name) => agent.permission.filter(r => (r.permission === name || r.permission === '*') && r.pattern === '*').pop()?.action;
  };
  const free = resolve({});
  for (const t of ['bash', 'edit', 'read', 'grep', 'glob', 'list', 'webfetch']) assert.equal(free(t), 'allow', `${t} is allowed by default (the check can fail)`);
  // The same config the runtimes generate while connections exist.
  const locked = resolve({ tools: { 'chrome-devtools_new_page': false, ...DISABLED_BUILTIN_TOOLS }, permission: DENIED_PERMISSIONS });
  for (const t of ['bash', 'edit', 'read', 'grep', 'glob', 'list', 'webfetch', 'websearch', 'external_directory', 'task', 'skill', 'lsp']) {
    assert.equal(locked(t), 'deny', `${t} is denied`);
  }
  // `write` and `patch` are covered by `edit`.
  assert.equal(Object.keys(DISABLED_BUILTIN_TOOLS).includes('write'), true);
  // Permission keys alone are enough too (so dropping the deprecated `tools` later is safe).
  const only = resolve({ permission: DENIED_PERMISSIONS });
  for (const t of ['bash', 'edit', 'read', 'grep', 'glob', 'list', 'webfetch']) assert.equal(only(t), 'deny', `${t} (permission only)`);
});
