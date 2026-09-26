import {
  normalizeExternalMcpDefinitions,
  type ExternalMcpDefinition,
  ExternalMcpManager,
} from './external-mcp-manager.js';
import { ExternalMcpStore } from './external-mcp-store.js';
import type { ExternalMcpInstaller } from './external-mcp-installer.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('MCP management request must be an object');
  return value as Record<string, unknown>;
}

/** Local broker control plane used by the Dashboard's named-pipe client. */
export class ExternalMcpController {
  constructor(
    private readonly store: ExternalMcpStore,
    private readonly manager: ExternalMcpManager,
    private readonly installer?: Pick<ExternalMcpInstaller, 'removeInstallation'>,
  ) {}

  async handle(params: unknown): Promise<{
    servers: ExternalMcpDefinition[];
    status: ReturnType<ExternalMcpManager['getStatus']>;
  }> {
    const request = object(params);
    if (request.action === 'list') return this.snapshot();
    if (request.action === 'save') {
      const definitions = normalizeExternalMcpDefinitions(request.servers);
      await this.replace(definitions);
      return this.snapshot();
    }
    if (request.action === 'remove') {
      if (typeof request.id !== 'string') throw new Error('MCP server ID is required');
      const definitions = await this.store.load();
      const removed = definitions.find((definition) => definition.id === request.id);
      if (!removed) throw new Error(`Unknown MCP server: ${request.id}`);
      await this.replace(definitions.filter((definition) => definition.id !== request.id));
      try {
        if (removed.source === 'catalog' || removed.source === 'github') {
          if (!this.installer)
            throw new Error('Managed MCP installation removal is unavailable in this process');
          await this.installer.removeInstallation(removed);
        }
      } catch (error) {
        await this.replace(definitions).catch(() => {});
        throw error;
      }
      return this.snapshot();
    }
    throw new Error('MCP management action must be list, save, or remove');
  }

  private async replace(definitions: ExternalMcpDefinition[]): Promise<void> {
    const previous = await this.store.load();
    try {
      await this.store.save(definitions);
      await this.manager.updateDefinitions(definitions);
    } catch (error) {
      await this.store.save(previous).catch(() => {});
      await this.manager.updateDefinitions(previous).catch(() => {});
      throw error;
    }
  }

  private async snapshot(): Promise<{
    servers: ExternalMcpDefinition[];
    status: ReturnType<ExternalMcpManager['getStatus']>;
  }> {
    const servers = await this.store.load();
    return { servers, status: this.manager.getStatus() };
  }
}
