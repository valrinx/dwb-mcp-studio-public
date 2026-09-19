import { tmpdir, userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import { dataDir } from './paths.js';
import { resolve } from 'node:path';

export const BROKER_PROTOCOL_VERSION = 1;

export function brokerEndpoint(): string {
  if (process.env.DWB_BROKER_PIPE) return process.env.DWB_BROKER_PIPE;
  const identity = `${userInfo().username}:${dataDir().toLowerCase()}`;
  const id = createHash('sha256').update(identity).digest('hex').slice(0, 20);
  if (process.platform === 'win32') return `\\\\.\\pipe\\dwb-mcp-studio-core-v1-${id}`;
  return resolve(tmpdir(), `dwb-mcp-studio-core-${id}.sock`);
}

export type BrokerLogicalContext = {
  key: string;
  source: string;
  preview?: string;
  metaKeys?: string[];
};

export type BrokerRequest = {
  id: string;
  method:
    | 'hello'
    | 'list_tools'
    | 'call_tool'
    | 'list_resources'
    | 'list_resource_templates'
    | 'read_resource'
    | 'ping'
    | 'inspect'
    | 'shutdown'
    | 'cancel'
    | 'prepare_upgrade';
  deadline?: number;
  params?: Record<string, unknown>;
};

export type BrokerResponse = {
  id: string;
  ok: boolean;
  // Current transport root after operations such as resume; not an upstream tool result.
  sessionId?: string;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
};

export type BrokerNotification = {
  method: 'notifications/agent_message';
  params: { message: unknown };
};
