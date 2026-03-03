import type { ParsedUri } from "./types.js";

const URI_REGEX = /^([a-z][a-z0-9+.-]*):(.+?)(?:#([^@]+))?(?:@(.+))?$/;

export function parseUri(uri: string): ParsedUri | null {
  const match = uri.match(URI_REGEX);
  if (!match) return null;

  const [, scheme, pathPart, fragment, version] = match;
  if (!scheme || !pathPart) return null;

  let path = pathPart;
  let frag = fragment;
  let ver = version;

  if (!frag && pathPart.includes("#")) {
    const hashIndex = pathPart.indexOf("#");
    path = pathPart.slice(0, hashIndex);
    const rest = pathPart.slice(hashIndex + 1);
    const atIndex = rest.indexOf("@");
    if (atIndex >= 0) {
      frag = rest.slice(0, atIndex);
      ver = rest.slice(atIndex + 1);
    } else {
      frag = rest;
    }
  }

  return {
    scheme,
    path,
    fragment: frag,
    version: ver,
  };
}

export function formatUri(parsed: ParsedUri): string {
  let uri = `${parsed.scheme}:${parsed.path}`;
  if (parsed.fragment) {
    uri += `#${parsed.fragment}`;
  }
  if (parsed.version) {
    uri += `@${parsed.version}`;
  }
  return uri;
}

export function normalizeUri(uri: string): string {
  const parsed = parseUri(uri);
  if (!parsed) return uri;
  const { version, ...rest } = parsed;
  return formatUri(rest);
}

export function getUriScheme(uri: string): string | null {
  const parsed = parseUri(uri);
  return parsed?.scheme ?? null;
}

export function matchUriPattern(uri: string, pattern: string): boolean {
  const uriParsed = parseUri(uri);
  const patternParsed = parseUri(pattern);

  if (!uriParsed || !patternParsed) return false;

  if (uriParsed.scheme !== patternParsed.scheme) return false;

  if (patternParsed.path === "*") return true;

  if (patternParsed.path.endsWith("/*")) {
    const prefix = patternParsed.path.slice(0, -2);
    return uriParsed.path.startsWith(prefix);
  }

  if (patternParsed.path.endsWith("*")) {
    const prefix = patternParsed.path.slice(0, -1);
    return uriParsed.path.startsWith(prefix);
  }

  if (uriParsed.path !== patternParsed.path) return false;

  if (patternParsed.fragment === "*") return true;

  if (patternParsed.fragment && uriParsed.fragment !== patternParsed.fragment) {
    return false;
  }

  return true;
}

export interface UriExtractorConfig {
  scheme: string;
  pattern: RegExp;
  buildUri: (match: RegExpExecArray) => string | null;
}

class UriPatternRegistryImpl {
  private extractors: Map<string, UriExtractorConfig[]> = new Map();

  register(config: UriExtractorConfig): void {
    const existing = this.extractors.get(config.scheme) ?? [];
    existing.push(config);
    this.extractors.set(config.scheme, existing);
  }

  unregister(scheme: string): void {
    this.extractors.delete(scheme);
  }

  getExtractors(scheme?: string): UriExtractorConfig[] {
    if (scheme) {
      return this.extractors.get(scheme) ?? [];
    }
    return Array.from(this.extractors.values()).flat();
  }

  extractAll(content: string): string[] {
    const uris = new Set<string>();
    
    for (const configs of this.extractors.values()) {
      for (const config of configs) {
        const regex = new RegExp(config.pattern.source, config.pattern.flags);
        let match;
        while ((match = regex.exec(content)) !== null) {
          const uri = config.buildUri(match);
          if (uri) {
            uris.add(uri);
          }
        }
      }
    }

    return Array.from(uris);
  }

  listSchemes(): string[] {
    return Array.from(this.extractors.keys());
  }
}

export const UriPatternRegistry = new UriPatternRegistryImpl();
