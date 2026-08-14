const COMMON_EXACT_PATHS = new Set([
  "memory.md",
  "schema.md",
  "readme.md",
  "wiki/index.md",
  "wiki/log.md",
  "wiki/readme.md",
]);

const COMMON_PATH_PREFIXES = [
  "wiki/common/",
  "wiki/testing/",
  "wiki/agent-tools/",
  "wiki/codex/",
  "skills/",
  "templates/",
  "tools/local-wiki-mcp/",
];

export function resolveProjectScope(options = {}) {
  if (options.projectScope) return options.projectScope;
  const requested = options.scope;
  if (requested !== undefined && !new Set(["global", "project"]).has(requested)) {
    throw new Error("scope must be either global or project.");
  }

  const rawProjects = [
    ...(options.project === undefined ? [] : [options.project]),
    ...(options.projects === undefined ? [] : requireStringArray(options.projects, "projects")),
  ];
  const projectGroups = normalizeProjectGroups(options.projectGroups);
  const projects = [...new Set(rawProjects
    .map((value) => canonicalProjectId(normalizeProjectId(value), projectGroups))
    .filter(Boolean))];
  const mode = requested ?? (projects.length ? "project" : "global");
  if (mode === "project" && projects.length === 0) {
    throw new Error("project scope requires at least one project.");
  }

  return {
    mode,
    projects: mode === "project" ? projects : [],
    matchProjects: mode === "project" ? expandProjectGroups(projects, projectGroups) : [],
    scopeRoots: normalizeScopeRoots(options.scopeRoots),
    includeCommon: mode === "project"
      ? optionalBoolean(options.include_common ?? options.includeCommon, true, "include_common")
      : false,
  };
}

export function publicProjectScope(scope) {
  if (scope.mode === "global") return { mode: "global" };
  return {
    mode: "project",
    projects: [...scope.projects],
    include_common: scope.includeCommon,
  };
}

export function matchesProjectScope(chunk, scope) {
  if (!scope || scope.mode === "global") return true;
  const normalizedPath = normalizePath(chunk.path);
  const matchProjects = scope.matchProjects ?? scope.projects;
  const scopeRoots = normalizeScopeRoots(scope.scopeRoots);
  const personalPath = pathInsideScopeRoot(normalizedPath, "agent-memory");
  if (personalPath?.startsWith("wiki/")) return scope.includeCommon && isCommonPath(personalPath);
  const scopedPaths = scopeRoots.map((scopeRoot) => pathInsideScopeRoot(normalizedPath, scopeRoot));
  if (personalPath !== null && !scope.includeCommon && !personalPath.startsWith("wiki/")) return false;
  if (scopedPaths.some((scopedPath) => matchProjects.some(
    (project) => isProjectWikiPath(scopedPath, project),
  ))) return true;
  if (scopedPaths.some((scopedPath) => scopedPath?.startsWith("wiki/"))) {
    return scope.includeCommon && scopedPaths.some((scopedPath) => isCommonPath(scopedPath));
  }
  if (matchesProjectMetadata(chunk.text, matchProjects)) return true;
  return scope.includeCommon && scopedPaths.some((scopedPath) => isCommonPath(scopedPath));
}

export function normalizeScopeRoots(value) {
  if (!Array.isArray(value)) return ["."];
  const roots = [...new Set(value
    .filter((entry) => typeof entry === "string" && entry.trim())
    .map((entry) => normalizePath(entry).replace(/\/$/, "") || "."))];
  return roots.length ? roots : ["."];
}

export function normalizeProjectGroups(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const groups = Object.fromEntries(Object.entries(value)
    .filter(([group, members]) => typeof group === "string" && group.trim() && Array.isArray(members))
    .map(([group, members]) => {
      const canonical = normalizeProjectId(group);
      return [canonical, [...new Set(members
        .filter((member) => typeof member === "string" && member.trim())
        .map((member) => normalizeProjectId(member))
        .filter((member) => member !== canonical))]];
    }));
  const owners = new Map(Object.keys(groups).map((group) => [group, group]));
  for (const [group, members] of Object.entries(groups)) {
    for (const member of members) {
      const owner = owners.get(member);
      if (owner && owner !== group) {
        throw new Error(`projectGroups member ${member} belongs to multiple groups.`);
      }
      owners.set(member, group);
    }
  }
  return groups;
}

export function normalizeProjectId(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("project must be a non-empty string.");
  }
  return value
    .trim()
    .toLowerCase()
    .replaceAll("\\", "/")
    .replace(/^wiki\//, "")
    .replace(/\/$/, "")
    .replace(/[\s_]+/g, "-");
}

function isProjectWikiPath(normalizedPath, project) {
  if (normalizedPath === null) return false;
  const prefix = `wiki/${project}`;
  return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
}

function canonicalProjectId(project, projectGroups) {
  if (project in projectGroups) return project;
  return Object.entries(projectGroups).find(([, members]) => members.includes(project))?.[0] ?? project;
}

function expandProjectGroups(projects, projectGroups) {
  return [...new Set(projects.flatMap((project) => [project, ...(projectGroups[project] ?? [])]))];
}

function isCommonPath(normalizedPath) {
  if (normalizedPath === null) return false;
  return COMMON_EXACT_PATHS.has(normalizedPath)
    || COMMON_PATH_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));
}

function pathInsideScopeRoot(normalizedPath, scopeRoot) {
  if (scopeRoot === ".") return normalizedPath;
  if (normalizedPath === scopeRoot) return "";
  return normalizedPath.startsWith(`${scopeRoot}/`)
    ? normalizedPath.slice(scopeRoot.length + 1)
    : null;
}

function matchesProjectMetadata(text, projects) {
  const values = [...String(text ?? "").matchAll(
    /^(?:-\s*)?(?:项目(?:·|\s*)模块|project|projects):\s*([^\r\n]+)/gim,
  )].map((match) => normalizeMetadata(match[1]));
  return projects.some((project) => values.some((value) => value.includes(project)));
}

function normalizeMetadata(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function requireStringArray(value, name) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${name} must be an array of non-empty strings.`);
  }
  return value;
}

function optionalBoolean(value, fallback, name) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
  return value;
}
