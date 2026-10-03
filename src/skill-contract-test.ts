import assert from 'node:assert/strict';
import { brokerTools } from './broker-tools.js';

assert.ok(
  brokerTools.some((tool) => tool.name === 'skills'),
  'the broker must expose the Agent Skills control tool without replacing existing controls',
);
for (const existing of ['dwb_external_mcp_list_tools', 'dwb_agent', 'dwb_task'])
  assert.ok(
    brokerTools.some((tool) => tool.name === existing),
    `${existing} must remain available`,
  );
console.log('SKILL_CONTRACT_PASS: broker exposes Agent Skills alongside existing controls');
