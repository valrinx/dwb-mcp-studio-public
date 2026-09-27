import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { dataDir } from './paths.js';
import { EventLog } from './event-log.js';

export type PayloadArchiveMode = 'off' | 'redacted' | 'raw';

export type PayloadGuardConfig = {
  enabled: boolean;
  maxBytes: number;
  warnBytes: number;
  previewBytes: number;
  archiveOversized: boolean;
  archiveMode: PayloadArchiveMode;
  archiveRetentionDays: number;
  archiveMaxFiles: number;
  archiveDir: string;
};

export type PayloadGuardStatus = PayloadGuardConfig & {
  guardedCount: number;
  guardedOriginalBytes: number;
  guardedForwardedBytes: number;
  lastGuardedAt: string | null;
  lastGuardedTool: string | null;
};

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}
function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function defaultConfig(): PayloadGuardConfig {
  const maxBytes = envInt('DWB_PAYLOAD_MAX_BYTES', 256 * 1024);
  const archiveEnabled = envBool('DWB_PAYLOAD_ARCHIVE', true);
  const requestedMode = String(process.env.DWB_PAYLOAD_ARCHIVE_MODE || 'redacted').toLowerCase();
  const archiveMode: PayloadArchiveMode = !archiveEnabled
    ? 'off'
    : requestedMode === 'raw'
      ? 'raw'
      : requestedMode === 'off'
        ? 'off'
        : 'redacted';
  return {
    enabled: envBool('DWB_PAYLOAD_GUARD_ENABLED', true),
    maxBytes,
    warnBytes: Math.min(envInt('DWB_PAYLOAD_WARN_BYTES', 128 * 1024), maxBytes),
    previewBytes: Math.min(envInt('DWB_PAYLOAD_PREVIEW_BYTES', 24 * 1024), maxBytes / 2),
    archiveOversized: archiveMode !== 'off',
    archiveMode,
    archiveRetentionDays: envInt('DWB_PAYLOAD_ARCHIVE_RETENTION_DAYS', 7),
    archiveMaxFiles: envInt('DWB_PAYLOAD_ARCHIVE_MAX_FILES', 200),
    archiveDir: process.env.DWB_PAYLOAD_ARCHIVE_DIR
      ? resolve(process.env.DWB_PAYLOAD_ARCHIVE_DIR)
      : resolve(dataDir(), 'logs', 'payloads'),
  };
}

function safeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80);
}

function sourceHints(params: Record<string, unknown>): string[] {
  const hints: string[] = [];
  for (const key of ['path', 'file_path', 'filePath']) {
    const value = params[key];
    if (typeof value === 'string') hints.push(value);
  }
  if (Array.isArray(params.paths)) {
    for (const value of params.paths) if (typeof value === 'string') hints.push(value);
  }
  return hints.slice(0, 20);
}
type ContentSummary = {
  textItems: number;
  imageItems: number;
  audioItems: number;
  resourceItems: number;
  resourceLinks: number;
  binaryBase64Chars: number;
};

function summarizeContent(result: Record<string, any>): ContentSummary {
  const summary: ContentSummary = {
    textItems: 0,
    imageItems: 0,
    audioItems: 0,
    resourceItems: 0,
    resourceLinks: 0,
    binaryBase64Chars: 0,
  };
  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'text') summary.textItems += 1;
    if (item.type === 'image') {
      summary.imageItems += 1;
      if (typeof item.data === 'string') summary.binaryBase64Chars += item.data.length;
    }
    if (item.type === 'audio') {
      summary.audioItems += 1;
      if (typeof item.data === 'string') summary.binaryBase64Chars += item.data.length;
    }
    if (item.type === 'resource') {
      summary.resourceItems += 1;
      if (typeof item.resource?.blob === 'string')
        summary.binaryBase64Chars += item.resource.blob.length;
    }
    if (item.type === 'resource_link') summary.resourceLinks += 1;
  }
  return summary;
}
// Truncates at a UTF-8 character boundary so multi-byte text (Thai, CJK, emoji)
// never ends in a replacement character.
function sliceUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= maxBytes) return value;
  let end = maxBytes;
  // A continuation byte is 0b10xxxxxx; walk back to the start of its sequence.
  while (end > 0 && (buffer[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
  return buffer.subarray(0, end).toString('utf8');
}

function collectTextPreview(result: Record<string, any>, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  let preview = '';
  const append = (value: string) => {
    if (!value || Buffer.byteLength(preview, 'utf8') >= maxBytes) return;
    const remaining = maxBytes - Buffer.byteLength(preview, 'utf8');
    preview += sliceUtf8(value, remaining);
  };

  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'text' && typeof item.text === 'string') {
      append(item.text + '\n');
    } else if (item.type === 'resource' && typeof item.resource?.text === 'string') {
      append(item.resource.text + '\n');
    }
  }
  return preview.trimEnd();
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

const secretKey =
  /(password|passwd|secret|token|authorization|cookie|api[_-]?key|client[_-]?secret)/i;

// Keys whose value is personal data under PDPA even when the value carries no
// recognisable pattern of its own (a name, an address, a date of birth).
const piiKey =
  /(citizen[_-]?id|national[_-]?id|id[_-]?card|passport|ssn|tax[_-]?id|phone|mobile|tel(?:ephone)?|email|address|birth|dob|salary|bank[_-]?account|เลขบัตร|บัตรประชาชน|หนังสือเดินทาง|เบอร์โทร|ที่อยู่)/i;

// PDPA-sensitive value patterns. Redaction is deliberately eager: this archive
// exists to explain an oversized payload, not to retain its contents. Use
// DWB_PAYLOAD_ARCHIVE_MODE=raw for an explicit, local-only unredacted copy.
// Personal data that has no value-level pattern (a name, an address) is only
// recognisable by the key it sits under. This catches the embedded case too,
// where a read_file result carries JSON/YAML/CSV text rather than real objects.
// Bare `name` is excluded on purpose: MCP results are full of tool/field names,
// and redacting those would make an archive useless for debugging.
const piiTextKey =
  /^(?:full[_-]?name|first[_-]?name|last[_-]?name|sur[_-]?name|student[_-]?name|employee[_-]?name|citizen[_-]?id|national[_-]?id|id[_-]?card|passport|ssn|tax[_-]?id|date[_-]?of[_-]?birth|birth[_-]?date|dob|home[_-]?address|address|salary|bank[_-]?account|\u0e0a\u0e37\u0e48\u0e2d|\u0e19\u0e32\u0e21\u0e2a\u0e01\u0e38\u0e25|\u0e40\u0e25\u0e02\u0e1a\u0e31\u0e15\u0e23|\u0e1a\u0e31\u0e15\u0e23\u0e1b\u0e23\u0e30\u0e0a\u0e32\u0e0a\u0e19|\u0e2b\u0e19\u0e31\u0e07\u0e2a\u0e37\u0e2d\u0e40\u0e14\u0e34\u0e19\u0e17\u0e32\u0e07|\u0e17\u0e35\u0e48\u0e2d\u0e22\u0e39\u0e48|\u0e27\u0e31\u0e19\u0e40\u0e01\u0e34\u0e14|\u0e40\u0e07\u0e34\u0e19\u0e40\u0e14\u0e37\u0e2d\u0e19)$/i;

// Every quantifier below is bounded and unambiguous. An unbounded `key*` around
// an alternation makes this quadratic per start position, which turns a large
// text payload into a multi-minute stall rather than an archive write.
const piiKeyValue =
  /(["']?)([\w\u0E00-\u0E7F-]{1,60})\1(\s*[:=]\s*)("[^"\n]{0,4096}"|'[^'\n]{0,4096}'|[^\s,;}\]]{1,512})/g;

function redactPiiKeyValues(value: string): string {
  // Matching any key and testing it afterwards keeps the scan linear; encoding
  // the key alternation into the pattern itself does not.
  return value.replace(piiKeyValue, (all, quote, key, separator) =>
    piiTextKey.test(key) ? `${quote}${key}${quote}${separator}"[REDACTED_PII]"` : all,
  );
}

// PDPA-sensitive value patterns. Redaction is deliberately eager: this archive
// exists to explain an oversized payload, not to retain its contents. Use
// DWB_PAYLOAD_ARCHIVE_MODE=raw for an explicit, local-only unredacted copy.
function redactPii(value: string): string {
  return (
    redactPiiKeyValues(value)
      // Thai national ID: 13 digits, plain or as x-xxxx-xxxxx-xx-x.
      .replace(/\b\d-\d{4}-\d{5}-\d{2}-\d\b/g, '[REDACTED_NATIONAL_ID]')
      .replace(/\b\d{13}\b/g, '[REDACTED_NATIONAL_ID]')
      // Payment cards, grouped or plain. Fixed groups rather than a
      // `(?:\d[ -]?){13,19}` repeat: same matches, but the group boundaries are
      // explicit and there is no optional separator to backtrack over.
      .replace(/\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}\b/g, '[REDACTED_CARD]')
      .replace(/\b\d{14,19}\b/g, '[REDACTED_CARD]')
      // Passport: 1-2 letters followed by 6-7 digits.
      .replace(/\b[A-Z]{1,2}\d{6,7}\b/g, '[REDACTED_PASSPORT]')
      .replace(/\b[\w.+-]{1,64}@[\w-]{1,63}\.[\w.-]{2,32}\b/g, '[REDACTED_EMAIL]')
      .replace(/(?:\+66|\b0)[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{3,4}\b/g, '[REDACTED_PHONE]')
  );
}

function redactText(value: string): string {
  return redactPii(
    value
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{12,}/gi, 'Bearer [REDACTED]')
      .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_TOKEN]')
      .replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]'),
  );
}

function redactArchiveValue(value: any, key = ''): any {
  if (secretKey.test(key)) return '[REDACTED]';
  if (piiKey.test(key)) return '[REDACTED_PII]';
  if (typeof value === 'string') {
    if ((key === 'data' || key === 'blob') && value.length > 4096)
      return `[OMITTED_BINARY:${value.length}_chars]`;
    return redactText(value);
  }
  if (Array.isArray(value)) return value.map((item) => redactArchiveValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactArchiveValue(v, k)]));
  }
  return value;
}

export type GuardApplication<T> = {
  result: T;
  guarded: boolean;
  originalBytes: number;
  forwardedBytes: number;
  archivePath?: string;
};
export class PayloadGuard {
  private readonly config: PayloadGuardConfig;
  private guardedCount = 0;
  private guardedOriginalBytes = 0;
  private guardedForwardedBytes = 0;
  private lastGuardedAt: string | null = null;
  private lastGuardedTool: string | null = null;

  constructor(
    private readonly log: EventLog,
    config: Partial<PayloadGuardConfig> = {},
  ) {
    this.config = { ...defaultConfig(), ...config };
  }

  get status(): PayloadGuardStatus {
    return {
      ...this.config,
      guardedCount: this.guardedCount,
      guardedOriginalBytes: this.guardedOriginalBytes,
      guardedForwardedBytes: this.guardedForwardedBytes,
      lastGuardedAt: this.lastGuardedAt,
      lastGuardedTool: this.lastGuardedTool,
    };
  }

  private async pruneArchives(): Promise<void> {
    await mkdir(this.config.archiveDir, { recursive: true });
    const now = Date.now();
    const cutoff = now - this.config.archiveRetentionDays * 86_400_000;
    const entries = [] as Array<{ path: string; mtimeMs: number }>;
    for (const name of await readdir(this.config.archiveDir)) {
      if (!name.endsWith('.json')) continue;
      const path = resolve(this.config.archiveDir, name);
      try {
        const info = await stat(path);
        if (info.mtimeMs < cutoff) {
          await unlink(path).catch(() => {});
          continue;
        }
        entries.push({ path, mtimeMs: info.mtimeMs });
      } catch {}
    }
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const old of entries.slice(this.config.archiveMaxFiles))
      await unlink(old.path).catch(() => {});
  }

  private async archive(tool: string, serialized: string): Promise<string | undefined> {
    if (!this.config.archiveOversized || this.config.archiveMode === 'off') return undefined;
    const hash = createHash('sha256').update(serialized).digest('hex').slice(0, 12);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = resolve(this.config.archiveDir, `${stamp}-${safeToolName(tool)}-${hash}.json`);
    await this.pruneArchives();
    let archiveText = serialized;
    if (this.config.archiveMode === 'redacted') {
      try {
        archiveText = JSON.stringify(redactArchiveValue(JSON.parse(serialized)), null, 2);
      } catch {
        archiveText = redactText(serialized);
      }
    }
    await writeFile(path, archiveText, 'utf8');
    await this.pruneArchives();
    return path;
  }
  async apply<T extends Record<string, any>>(
    tool: string,
    params: Record<string, unknown>,
    result: T,
  ): Promise<GuardApplication<T>> {
    const serialized = JSON.stringify(result);
    const originalBytes = Buffer.byteLength(serialized, 'utf8');
    if (!this.config.enabled || originalBytes <= this.config.maxBytes) {
      if (this.config.enabled && originalBytes >= this.config.warnBytes) {
        await this.log.write({
          type: 'payload_near_limit',
          tool,
          bytes: originalBytes,
          details: { maxBytes: this.config.maxBytes },
        });
      }
      return { result, guarded: false, originalBytes, forwardedBytes: originalBytes };
    }

    let archivePath: string | undefined;
    try {
      archivePath = await this.archive(tool, serialized);
    } catch (error) {
      await this.log.write({
        type: 'payload_archive_failed',
        tool,
        bytes: originalBytes,
        details: { error: String(error) },
      });
    }

    const summary = summarizeContent(result);
    const hints = sourceHints(params);
    const structuredBytes =
      result.structuredContent === undefined
        ? 0
        : Buffer.byteLength(JSON.stringify(result.structuredContent), 'utf8');
    const reserveBytes = 12 * 1024;
    const keepStructured =
      structuredBytes > 0 &&
      structuredBytes <=
        Math.max(0, this.config.maxBytes - reserveBytes - this.config.previewBytes);
    const previewBudget = Math.max(
      0,
      Math.min(
        this.config.previewBytes,
        this.config.maxBytes - reserveBytes - (keepStructured ? structuredBytes : 0),
      ),
    );
    const preview = collectTextPreview(result, previewBudget);

    const archiveLine = !archivePath
      ? 'Oversized result was not archived.'
      : this.config.archiveMode === 'raw'
        ? `Raw MCP result archived locally: ${archivePath}`
        : `Redacted MCP result archived locally: ${archivePath}`;
    const lines = [
      'N3zuui Payload Guard intercepted an oversized MCP response.',
      `Tool: ${tool}`,
      `Original: ${humanBytes(originalBytes)}; forward budget: ${humanBytes(this.config.maxBytes)}.`,
      archiveLine,
      `Content: ${summary.textItems} text, ${summary.imageItems} image, ${summary.audioItems} audio, ${summary.resourceItems} resource; base64 chars: ${summary.binaryBase64Chars}.`,
    ];
    if (hints.length) lines.push(`Original source path(s): ${hints.join(' | ')}`);
    if (tool === 'read_multiple_files') {
      lines.push('Next action: read only the specific file needed, one at a time.');
    } else if (tool === 'read_file' || tool === 'read_process_output') {
      lines.push('Next action: request a narrower offset/length or inspect one item at a time.');
    } else {
      lines.push('Next action: make a narrower request before fetching the full result again.');
    }
    if (structuredBytes > 0 && !keepStructured) {
      lines.push(
        'Structured output alone exceeded the safe budget; this guarded response is marked as an error so schema validation remains explicit.',
      );
    }
    const text = preview
      ? `${lines.join('\n')}\n\nText preview (${humanBytes(Buffer.byteLength(preview, 'utf8'))}):\n${preview}`
      : lines.join('\n');

    let guardedResult: Record<string, any> = {
      content: [{ type: 'text', text }],
      _meta: {
        'dwb/payload_guard': {
          guarded: true,
          originalBytes,
          maxBytes: this.config.maxBytes,
          archivePath,
        },
      },
    };
    if (keepStructured) guardedResult.structuredContent = result.structuredContent;
    if (result.isError || (structuredBytes > 0 && !keepStructured)) guardedResult.isError = true;

    let forwardedBytes = Buffer.byteLength(JSON.stringify(guardedResult), 'utf8');
    if (forwardedBytes > this.config.maxBytes) {
      guardedResult = {
        content: [{ type: 'text', text: lines.join('\n') }],
        isError: structuredBytes > 0 ? true : result.isError,
        _meta: {
          'dwb/payload_guard': {
            guarded: true,
            originalBytes,
            maxBytes: this.config.maxBytes,
            archivePath,
          },
        },
      };
      forwardedBytes = Buffer.byteLength(JSON.stringify(guardedResult), 'utf8');
    }

    this.guardedCount += 1;
    this.guardedOriginalBytes += originalBytes;
    this.guardedForwardedBytes += forwardedBytes;
    this.lastGuardedAt = new Date().toISOString();
    this.lastGuardedTool = tool;
    await this.log.write({
      type: 'payload_guarded',
      tool,
      bytes: originalBytes,
      ok: true,
      details: {
        originalBytes,
        forwardedBytes,
        archivePath,
        archiveMode: this.config.archiveMode,
        maxBytes: this.config.maxBytes,
        structuredBytes,
        contentSummary: summary,
        sourceHints: hints,
      },
    });

    return {
      result: guardedResult as T,
      guarded: true,
      originalBytes,
      forwardedBytes,
      archivePath,
    };
  }
}
