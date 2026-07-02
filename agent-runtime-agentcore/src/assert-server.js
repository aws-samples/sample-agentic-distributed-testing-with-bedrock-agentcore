#!/usr/bin/env node
/**
 * Minimal MCP stdio server exposing assert_pass / assert_fail tools.
 * Writes verdict JSON to ASSERT_RESULT_FILE env var path so the parent
 * process can read it after opencode exits.
 *
 * MCP protocol: newline-delimited JSON over stdin/stdout.
 */
import { writeFileSync } from 'fs';
import { createInterface } from 'readline';

const RESULT_FILE = process.env.ASSERT_RESULT_FILE;

const rl = createInterface({ input: process.stdin, terminal: false });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

const TOOLS = [
  {
    name: 'assert_pass',
    description: 'Mark the current test case as PASSED with a reason.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Why the test passed' } },
      required: ['reason'],
    },
  },
  {
    name: 'assert_fail',
    description: 'Mark the current test case as FAILED with a reason.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Why the test failed' } },
      required: ['reason'],
    },
  },
];

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const { id, method, params } = msg;

  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'assert-server', version: '1.0.0' } } });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name === 'assert_pass' || name === 'assert_fail') {
      const verdict = { passed: name === 'assert_pass', reason: args.reason || '' };
      if (RESULT_FILE) {
        try { writeFileSync(RESULT_FILE, JSON.stringify(verdict)); } catch { /* ignore */ }
      }
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(verdict) }] } });
      return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown tool' } });
    return;
  }

  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
