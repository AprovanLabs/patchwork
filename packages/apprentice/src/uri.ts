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

  return { scheme, path, fragment: frag, version: ver };
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
  const { version: _version, ...rest } = parsed;
  return formatUri(rest);
}

export function getScheme(uri: string): string | null {
  const parsed = parseUri(uri);
  return parsed?.scheme ?? null;
}

export function createFileUri(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `file:${normalized}`;
}

export function createEventUri(eventId: string): string {
  return `event:${eventId}`;
}

export function isFileUri(uri: string): boolean {
  return getScheme(uri) === "file";
}

export function isEventUri(uri: string): boolean {
  return getScheme(uri) === "event";
}
