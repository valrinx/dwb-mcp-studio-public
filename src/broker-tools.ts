// Returned by controlTool when the name is not a broker control tool, so a
// control tool that legitimately returns a falsy result is not mistaken for
// "unhandled" and forwarded to the Desktop Commander worker.
export const NOT_A_CONTROL_TOOL = Symbol('dwb.notAControlTool');

export const brokerTools = [
  {
    name: 'dwb_bridge_status',
    description: 'Show singleton DWB broker health plus the current MCP session.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'dwb_broker_status',
    description: 'Show global DWB broker, worker-pool, queue and lock status.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'dwb_session_status',
    description: 'Show the current MCP session and sticky Desktop Commander worker status.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'dwb_restart_worker',
    description: 'Restart only the current MCP session Desktop Commander worker.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'dwb_list_sessions',
    description: 'List all attached and detached local MCP sessions known to the broker.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'dwb_list_detached_sessions',
    description: 'List detached sessions that may be resumed after a chat/context disconnect.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'dwb_resume_session',
    description: 'Replace the current fresh MCP session with a detached DWB session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Detached DWB session ID to resume.' },
      },
      required: ['session_id'],
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'workspace',
    description:
      'When the user gives a working directory, immediately call action=bind with path=<absolute directory>. This registers or reuses that exact folder and binds it to this chat in one step, without asking the user to create a workspace separately. The worker starts in the bound directory; an idle worker is replaced on directory changes. Other chats keep their bindings. This does not expand filesystem policy. Do not infer the workspace from arbitrary file paths.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Workspace operation: list, status, register, bind, resolve, unbind.',
        },
        workspace: { type: 'string', description: 'Workspace ID, name, alias, or absolute path.' },
        workspace_id: { type: 'string' },
        query: { type: 'string' },
        path: { type: 'string' },
        root: { type: 'string' },
        name: { type: 'string' },
        aliases: { type: 'array', items: { type: 'string' } },
      },
      required: ['action'],
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'dwb_agent',
    description:
      'Register and inspect an agent working in the current bound workspace. Multiple agents can share one workspace while using separate tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Agent operation: register, heartbeat, status, list.',
        },
        name: { type: 'string', description: 'Human-readable agent name.' },
        role: {
          type: 'string',
          description: 'Optional agent role such as backend, frontend, or tester.',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Capabilities this agent can perform, for example typescript or api.',
        },
      },
      required: ['action'],
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'dwb_task',
    description:
      'Coordinate separate tasks for agents in the current workspace. Claiming a task reserves its file scopes and prevents overlapping active tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            'Task operation: create, list, claim, dispatch, complete, handoff, release, block, cancel, reopen, history.',
        },
        title: { type: 'string' },
        description: { type: 'string' },
        file_scopes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Relative workspace paths or globs reserved by this task, for example src/api/**.',
        },
        depends_on: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs that must be done before this task can be claimed.',
        },
        required_role: { type: 'string', description: 'Role required for automatic dispatch.' },
        required_capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Capabilities required for automatic dispatch.',
        },
        priority: { type: 'integer', description: 'Higher priority tasks dispatch first.' },
        task_id: { type: 'string' },
        reason: { type: 'string', description: 'Reason for blocking a task.' },
        result: { description: 'Optional JSON result saved when completing a task.' },
        summary: { type: 'string', description: 'Completion summary for the next agent.' },
        changed_files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Workspace-relative files changed by the completing agent.',
        },
        test_result: { description: 'Optional JSON test result for the next agent.' },
        status: {
          type: 'string',
          description: 'Optional list filter: queued, doing, done, blocked, cancelled.',
        },
      },
      required: ['action'],
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
] as const;

export function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}
