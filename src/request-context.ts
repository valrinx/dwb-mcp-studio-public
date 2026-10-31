import { createHash } from 'node:crypto';

export type LogicalRequestContext = {
  key: string;
  source: string;
  preview: string;
  metaKeys: string[];
};

type IdentifierKind = 'conversation' | 'chat' | 'thread' | 'workflow' | 'context' | 'agent';
type Candidate = { score: number; source: string; value: string; kind: IdentifierKind };
const openAiConversationKey = /(?:^|\.)openai\/session$/i;
const unstableKey =
  /(request[_-]?id|run[_-]?id|trace|span|progress|nonce|timestamp|locale|user.?agent|location)/i;

function identifierKind(path: string): IdentifierKind | null {
  // A changing request identifier is never a chat identifier, even inside conversation.*.
  if (unstableKey.test(path)) return null;
  if (openAiConversationKey.test(path)) return 'conversation';
  const parts = path.split(/[./]/).map((part) => part.replace(/[_-]/g, '').toLowerCase());
  const leaf = parts.at(-1);
  const parent = parts.at(-2);
  const kind = leaf === 'id' ? parent : leaf?.replace(/id$/, '');
  if (leaf !== 'id' && !leaf?.endsWith('id')) return null;
  if (kind === 'subagent') return 'agent';
  if (
    kind === 'conversation' ||
    kind === 'chat' ||
    kind === 'thread' ||
    kind === 'workflow' ||
    kind === 'context' ||
    kind === 'agent'
  )
    return kind;
  return null;
}

const identifierScores: Record<IdentifierKind, number> = {
  conversation: 140,
  chat: 130,
  thread: 130,
  workflow: 120,
  context: 100,
  agent: 90,
};

function scalar(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length >= 6 && text.length <= 512 ? text : null;
}

function walk(value: unknown, path: string, out: Candidate[], keys: Set<string>, depth = 0): void {
  if (!value || typeof value !== 'object' || depth > 4) return;
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? `${path}.${name}` : name;
    keys.add(next);
    const text = scalar(child);
    if (text) {
      const kind = identifierKind(next);
      if (kind) {
        const score = openAiConversationKey.test(next) ? 250 : identifierScores[kind];
        out.push({ score, source: next, value: text, kind });
      }
    } else if (child && typeof child === 'object') walk(child, next, out, keys, depth + 1);
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function resolveLogicalRequestContext(
  meta: unknown,
  envelope?: unknown,
): LogicalRequestContext | null {
  const candidates: Candidate[] = [],
    keys = new Set<string>();
  walk(meta, 'meta', candidates, keys);
  walk(envelope, 'envelope', candidates, keys);
  candidates.sort((a, b) => b.score - a.score || a.source.localeCompare(b.source));
  const best = candidates[0];
  if (!best) return null;
  // A host may multiplex several agent threads within one conversation/transport.
  // Scope by stable thread/agent IDs as well; request/run IDs never enter identity.
  const identity = [best];
  for (const kind of ['thread', 'agent'] as const) {
    const scope = candidates.find((candidate) => candidate.kind === kind);
    if (scope && scope !== best) identity.push(scope);
  }
  const source = identity.map((candidate) => candidate.source).join('+');
  const valueDigest = digest(
    identity.length === 1
      ? best.value
      : JSON.stringify(identity.map(({ kind, value }) => [kind, value])),
  );
  return {
    key: `${source}:sha256:${valueDigest}`,
    source,
    preview: `${source.replace(/^meta\./, '')}#${valueDigest}`,
    metaKeys: [...keys].sort().slice(0, 40),
  };
}

export function contextDiagnostic(meta: unknown, envelope?: unknown) {
  const keys = new Set<string>();
  walk(meta, 'meta', [], keys);
  walk(envelope, 'envelope', [], keys);
  return { keys: [...keys].sort().slice(0, 80) };
}
