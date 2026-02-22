import type { ConflictRecord, ConflictStrategy } from "../core/types.js";

export interface ConflictResolutionInput {
  path: string;
  changeMtime: Date;
  remoteMtime: Date;
  localChecksum?: string;
  remoteChecksum?: string;
  strategy: ConflictStrategy;
}

export function resolveConflict(
  input: ConflictResolutionInput,
): ConflictRecord | null {
  if (input.remoteMtime <= input.changeMtime) return null;
  if (
    input.localChecksum &&
    input.remoteChecksum &&
    input.localChecksum === input.remoteChecksum
  ) {
    return null;
  }

  const conflict: ConflictRecord = {
    path: input.path,
    localMtime: input.changeMtime,
    remoteMtime: input.remoteMtime,
  };

  switch (input.strategy) {
    case "local-wins":
      conflict.resolved = "local";
      break;
    case "remote-wins":
      conflict.resolved = "remote";
      break;
    case "newest-wins":
      conflict.resolved =
        input.remoteMtime > input.changeMtime ? "remote" : "local";
      break;
    case "manual":
      break;
  }

  return conflict;
}
