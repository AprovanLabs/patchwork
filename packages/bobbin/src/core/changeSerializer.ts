import type { Change, Annotation, BobbinChangeset } from '../types';

export function serializeChangesToYAML(
  changes: Change[],
  annotations: Annotation[] = [],
): string {
  const changeset: BobbinChangeset = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    changeCount: changes.length + annotations.length,
    changes: changes.map((change) => {
      const base = {
        type: change.type,
        target: change.target.path,
        xpath: change.target.xpath,
      };

      switch (change.type) {
        case 'style':
          return {
            ...base,
            property: (change.before as { property: string }).property,
            before: (change.before as { value: string }).value,
            after: (change.after as { value: string }).value,
          };
        case 'text':
          return {
            ...base,
            before: change.before as string,
            after: change.after as string,
          };
        case 'move':
          return {
            ...base,
            before: `${(change.before as { parent: string }).parent}[${
              (change.before as { index: number }).index
            }]`,
            after: `${(change.after as { parent: string }).parent}[${
              (change.after as { index: number }).index
            }]`,
          };
        default:
          return {
            ...base,
            before: JSON.stringify(change.before),
            after: JSON.stringify(change.after),
          };
      }
    }),
    annotations: annotations.map((a) => ({
      type: 'annotation',
      target: a.elementPath,
      xpath: a.elementXpath,
      note: a.content,
    })),
  };

  return toYAML(changeset);
}

function toYAML(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);

  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'boolean') return obj ? 'true' : 'false';
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'string') {
    // Escape strings that need quoting
    if (/[\n:{}[\],&*#?|\-<>=!%@`]/.test(obj) || obj.trim() !== obj) {
      return `"${obj.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return obj || '""';
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj
      .map((item) => {
        const itemYaml = toYAML(item, indent + 1);
        if (typeof item === 'object' && item !== null) {
          return `${spaces}- ${itemYaml.trimStart()}`;
        }
        return `${spaces}- ${itemYaml}`;
      })
      .join('\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, value]) => {
        const valueYaml = toYAML(value, indent + 1);
        if (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value)
        ) {
          return `${spaces}${key}:\n${valueYaml}`;
        }
        if (Array.isArray(value) && value.length > 0) {
          return `${spaces}${key}:\n${valueYaml}`;
        }
        return `${spaces}${key}: ${valueYaml}`;
      })
      .join('\n');
  }

  return String(obj);
}

export function parseYAMLChangeset(yaml: string): BobbinChangeset {
  // Basic YAML parser for the changeset format
  // For production, consider using js-yaml
  const lines = yaml.split('\n');
  const result: BobbinChangeset = {
    version: '1.0',
    timestamp: '',
    changeCount: 0,
    changes: [],
    annotations: [],
  };

  // Simplified parser - in production use js-yaml
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('version:')) {
      const parts = trimmed.split(':');
      result.version = (parts[1]?.trim() ?? '1.0') as '1.0';
    } else if (trimmed.startsWith('timestamp:')) {
      result.timestamp = trimmed.split(':').slice(1).join(':').trim();
    } else if (trimmed.startsWith('changeCount:')) {
      const parts = trimmed.split(':');
      result.changeCount = parseInt(parts[1]?.trim() ?? '0', 10);
    }
  }

  return result;
}
