import { readFile, stat, readdir } from "node:fs/promises";
import { join, dirname, basename, relative } from "node:path";
import matter from "gray-matter";
import type {
  SkillDefinition,
  SkillMetadata,
  SkillResource,
  SkillTrigger,
} from "./types.js";

export interface ScanOptions {
  basePath: string;
  include?: string[];
  exclude?: string[];
}

export async function scanSkills(options: ScanOptions): Promise<SkillDefinition[]> {
  const { basePath, exclude = ["node_modules", ".git", "dist"] } = options;
  const skills: SkillDefinition[] = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(basePath, fullPath);

      if (exclude.some((p) => relativePath.includes(p))) {
        continue;
      }

      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.name === "SKILL.md") {
        const skill = await parseSkillFile(fullPath, basePath);
        if (skill) {
          skills.push(skill);
        }
      }
    }
  }

  await scanDir(basePath);
  return skills;
}

export async function parseSkillFile(
  filePath: string,
  basePath: string
): Promise<SkillDefinition | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const { data, content: instructions } = matter(content);
    const metadata = data as SkillMetadata;

    const skillDir = dirname(filePath);
    const relativePath = relative(basePath, filePath);
    const id = dirname(relativePath).replace(/[/\\]/g, "-") || basename(skillDir);

    const resources = await scanSkillResources(skillDir, filePath);
    const version = await getGitVersion(filePath);

    const triggers: SkillTrigger[] = (metadata.triggers ?? []).map((t) => ({
      eventFilter: {
        types: t.types,
        sources: t.sources,
        subjects: t.subjects,
      },
      condition: t.condition,
      priority: t.priority,
    }));

    return {
      id,
      uri: `skill:${relativePath}`,
      name: metadata.name ?? id,
      description: metadata.description ?? extractDescription(instructions),
      instructions: instructions.trim(),
      resources,
      triggers: triggers.length > 0 ? triggers : undefined,
      tools: metadata.tools,
      model: metadata.model
        ? {
            provider: metadata.model.provider ?? "anthropic",
            model: metadata.model.model ?? "claude-sonnet-4-20250514",
            temperature: metadata.model.temperature,
            maxTokens: metadata.model.maxTokens,
          }
        : undefined,
      version,
    };
  } catch (error) {
    console.error(`Failed to parse skill file ${filePath}:`, error);
    return null;
  }
}

async function scanSkillResources(
  skillDir: string,
  skillFile: string
): Promise<SkillResource[]> {
  const resources: SkillResource[] = [];

  try {
    const entries = await readdir(skillDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = join(skillDir, entry.name);
      if (fullPath === skillFile) continue;

      const ext = entry.name.split(".").pop()?.toLowerCase();
      let type: SkillResource["type"] = "other";

      if (ext === "md") type = "markdown";
      else if (["sh", "bash", "py", "js", "ts"].includes(ext ?? "")) type = "script";
      else if (["json", "yaml", "yml", "toml"].includes(ext ?? "")) type = "config";

      resources.push({
        path: entry.name,
        type,
      });
    }
  } catch {
    // Ignore errors reading directory
  }

  return resources;
}

async function getGitVersion(filePath: string): Promise<string | undefined> {
  try {
    const { execSync } = await import("node:child_process");
    const version = execSync(`git log -1 --format=%H -- "${filePath}"`, {
      encoding: "utf-8",
      cwd: dirname(filePath),
    }).trim();
    return version || undefined;
  } catch {
    return undefined;
  }
}

function extractDescription(content: string): string {
  const lines = content.trim().split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("-")) {
      return trimmed.slice(0, 200);
    }
  }
  return "";
}

export async function loadSkillContent(skill: SkillDefinition, basePath: string): Promise<SkillDefinition> {
  const skillDir = join(basePath, dirname(skill.uri.replace("skill:", "")));

  const loadedResources: SkillResource[] = [];
  for (const resource of skill.resources) {
    try {
      const content = await readFile(join(skillDir, resource.path), "utf-8");
      loadedResources.push({ ...resource, content });
    } catch {
      loadedResources.push(resource);
    }
  }

  return { ...skill, resources: loadedResources };
}
