export * from './types';

export type { CacheConfig, ServiceResult } from './services/types.js';

// Services
export {
  createServiceProxy,
  callProcedure,
  batchCall,
  configureCacheTtl,
  invalidateCache,
  getCacheStats,
  setServiceBackend,
  type ServiceBackend,
} from './services/index.js';
