import type { FSProvider } from "../core/types.js";

export interface ContentChecksums {
  local?: string;
  remote?: string;
}

export function hashContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash =
      (hash +
        (hash << 1) +
        (hash << 4) +
        (hash << 7) +
        (hash << 8) +
        (hash << 24)) >>>
      0;
  }
  return hash.toString(16).padStart(8, "0");
}

export async function readChecksum(
  provider: FSProvider,
  path: string,
): Promise<string | undefined> {
  try {
    const content = await provider.readFile(path);
    return hashContent(content);
  } catch {
    return undefined;
  }
}

export async function readChecksums(
  local: FSProvider,
  localPath: string,
  remote: FSProvider,
  remotePath: string,
): Promise<ContentChecksums> {
  const [localChecksum, remoteChecksum] = await Promise.all([
    readChecksum(local, localPath),
    readChecksum(remote, remotePath),
  ]);
  return { local: localChecksum, remote: remoteChecksum };
}
