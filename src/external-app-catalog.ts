export type ExternalAppCatalogKind = 'official-remote' | 'community-local';
export type ExternalAppCatalogAuth = 'oauth' | 'api-key' | 'local-uv' | 'client-setup';

export type ExternalAppCatalogEntry = {
  id: string;
  name: string;
  category: string;
  description: string;
  kind: ExternalAppCatalogKind;
  official: boolean;
  auth: ExternalAppCatalogAuth;
  endpoint?: string;
  sourceUrl: string;
  setupUrl: string;
  capabilities: string;
  warning?: string;
};

/**
 * App integrations are intentionally separate from the npm reference-server catalog.
 * Most official entries are hosted MCP endpoints: they require the user's OAuth/API
 * approval and must not be treated as local package installs. Community entries keep
 * their source and setup requirements visible instead of being presented as official.
 */
export const externalAppCatalog: readonly ExternalAppCatalogEntry[] = [
  {
    id: 'figma',
    name: 'Figma',
    category: 'Design',
    description: 'เชื่อมต่อไฟล์และบริบทงานออกแบบ Figma ผ่าน official remote MCP.',
    kind: 'official-remote',
    official: true,
    auth: 'oauth',
    endpoint: 'https://mcp.figma.com/mcp',
    sourceUrl: 'https://www.figma.com/mcp-catalog/',
    setupUrl: 'https://developers.figma.com/docs/figma-mcp-server/',
    capabilities: 'อ่านบริบทไฟล์, คอมโพเนนต์ และข้อมูลสำหรับงานออกแบบ',
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'Code',
    description: 'เครื่องมือ repository, issue, pull request และ code search ของ GitHub.',
    kind: 'official-remote',
    official: true,
    auth: 'oauth',
    endpoint: 'https://api.githubcopilot.com/mcp/',
    sourceUrl: 'https://github.com/github/github-mcp-server',
    setupUrl: 'https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md',
    capabilities: 'จัดการ repository, issues, pull requests และการค้นหาโค้ด',
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'Project management',
    description: 'จัดการ issue และ workflow ของทีมผ่าน official Linear MCP.',
    kind: 'official-remote',
    official: true,
    auth: 'oauth',
    endpoint: 'https://mcp.linear.app/mcp',
    sourceUrl: 'https://linear.app/docs/mcp',
    setupUrl: 'https://linear.app/docs/mcp',
    capabilities: 'ค้นหาและจัดการ issues, projects, teams และสถานะงาน',
  },
  {
    id: 'atlassian',
    name: 'Atlassian',
    category: 'Project management',
    description: 'เชื่อมต่อ Jira, Confluence และบริการ Atlassian ผ่าน official remote MCP.',
    kind: 'official-remote',
    official: true,
    auth: 'oauth',
    endpoint: 'https://mcp.atlassian.com/v2/mcp',
    sourceUrl: 'https://atlassian.github.io/atlassian-mcp-server/',
    setupUrl: 'https://atlassian.github.io/atlassian-mcp-server/',
    capabilities: 'ค้นหาและจัดการ Jira, Confluence, Bitbucket และบริการที่รองรับ',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'Backend',
    description: 'จัดการโปรเจกต์, schema และข้อมูล Supabase ผ่าน official remote MCP.',
    kind: 'official-remote',
    official: true,
    auth: 'oauth',
    endpoint: 'https://mcp.supabase.com/mcp',
    sourceUrl: 'https://supabase.com/docs/guides/ai-tools/mcp',
    setupUrl: 'https://supabase.com/docs/guides/ai-tools/mcp',
    capabilities: 'ตรวจสอบ schema, migration, query และการตั้งค่าโปรเจกต์',
    warning: 'ควรจำกัด project scope และเปิด read-only เมื่อไม่ต้องการให้แก้ข้อมูล',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'Deployment',
    description: 'ดู deployment และโปรเจกต์ Vercel ผ่าน official remote MCP.',
    kind: 'official-remote',
    official: true,
    auth: 'oauth',
    endpoint: 'https://mcp.vercel.com',
    sourceUrl: 'https://vercel.com/docs/agent-resources/vercel-mcp',
    setupUrl: 'https://vercel.com/docs/agent-resources/vercel-mcp',
    capabilities: 'ตรวจสอบโปรเจกต์, deployment, domains และ logs ที่รองรับ',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'Infrastructure',
    description: 'เครื่องมือ Cloudflare สำหรับ workers และบริการ edge ผ่าน official MCP.',
    kind: 'official-remote',
    official: true,
    auth: 'oauth',
    endpoint: 'https://mcp.cloudflare.com/mcp',
    sourceUrl:
      'https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/',
    setupUrl:
      'https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/',
    capabilities: 'ดูและจัดการ Workers, bindings, zones และผลิตภัณฑ์ Cloudflare ที่รองรับ',
  },
  {
    id: 'canva',
    name: 'Canva',
    category: 'Design',
    description: 'เชื่อมต่อ Canva ผ่าน first-party MCP/AI connector ตามสิทธิ์บัญชี.',
    kind: 'official-remote',
    official: true,
    auth: 'client-setup',
    sourceUrl: 'https://www.canva.dev/solutions/mcp/',
    setupUrl: 'https://www.canva.dev/solutions/mcp/',
    capabilities: 'ค้นหาและใช้งานบริบทงานออกแบบ Canva ที่ connector รองรับ',
    warning: 'ความพร้อมใช้งานอาจขึ้นกับบัญชีและ MCP client ที่ใช้',
  },
  {
    id: 'capcut',
    name: 'CapCut',
    category: 'Video',
    description:
      'สะพาน MCP สำหรับ CapCut Desktop จากชุมชน ไม่ใช่ integration ที่ยืนยันจาก ByteDance.',
    kind: 'community-local',
    official: false,
    auth: 'local-uv',
    sourceUrl: 'https://github.com/bchenner/capcut-mcp',
    setupUrl: 'https://github.com/bchenner/capcut-mcp#readme',
    capabilities: 'ควบคุม timeline, captions, audio และการ export ตามความสามารถของ bridge',
    warning: 'ต้องติดตั้ง CapCut Desktop และ runtime ของชุมชนเอง; ตรวจ source ก่อนรันเสมอ',
  },
];

export function listExternalAppCatalog(): ExternalAppCatalogEntry[] {
  return externalAppCatalog.map((entry) => ({ ...entry }));
}
