import { isAbsolute, resolve } from 'node:path';

type Policy = Record<string, any>;

function samePath(first: string, second: string): boolean {
  const normalize = (path: string) =>
    process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  return normalize(first) === normalize(second);
}

function managedRoot(policy: Policy): string | null {
  const marker = policy.n3zuuiWorkspacePolicy;
  if (
    marker?.version !== 1 ||
    marker.mode !== 'managed' ||
    typeof marker.root !== 'string' ||
    !isAbsolute(marker.root) ||
    !Array.isArray(policy.allowedDirectories) ||
    !policy.allowedDirectories.some((path: string) => samePath(path, marker.root))
  )
    return null;
  return marker.root;
}

function replaceRoot(directories: string[], oldRoot: string, nextRoot: string): string[] {
  const result: string[] = [];
  for (const path of directories) {
    const next = samePath(path, oldRoot) ? nextRoot : path;
    if (!result.some((existing) => samePath(existing, next))) result.push(next);
  }
  return result;
}

/** Only Setup-owned grants move automatically; explicit/custom policies stay authoritative. */
export function updateManagedWorkspacePolicy(
  policy: Policy,
  workspace: string,
  standardPolicyFile: boolean,
): Policy {
  if (!standardPolicyFile || policy.n3zuuiWorkspacePolicy?.mode === 'custom') return policy;
  let root = managedRoot(policy);
  if (!root && !policy.n3zuuiWorkspacePolicy) {
    // Recognize the unmodified policy created by older Setup versions, even when
    // its saved root is older than config.workspace. Do not guess for custom files.
    const generated = Object.keys(policy).every((key) =>
      ['allowedDirectories', 'defaultShell', 'telemetryEnabled'].includes(key),
    );
    if (generated && policy.allowedDirectories?.length === 1) root = policy.allowedDirectories[0];
  }
  if (!root) return policy;
  return {
    ...policy,
    allowedDirectories: replaceRoot(policy.allowedDirectories, root, workspace),
    n3zuuiWorkspacePolicy: { version: 1, mode: 'managed', root: workspace },
  };
}

export function workerAllowedDirectories(policy: Policy, workspace: string): string[] {
  const root = managedRoot(policy);
  return root
    ? replaceRoot(policy.allowedDirectories, root, workspace)
    : (policy.allowedDirectories ?? [workspace]);
}
