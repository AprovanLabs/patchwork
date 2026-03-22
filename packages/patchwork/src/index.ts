export * from "./types";

export type { CacheConfig, ServiceResult } from "./services/types.js";

// Services
export {
  createProxy,
  callProcedure,
  batchCall,
  configureCacheTtl,
  invalidateCache,
  getCacheStats,
  setServiceBackend,
  type ServiceBackend,
} from "./services/index.js";
