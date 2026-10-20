export const TERM_VERSION = '1';
/** Retrieval hints only. These terms never establish support. */
export const DISCOVERY_TERMS: Readonly<Record<string, readonly string[]>> = {
  backend: ['backend', 'back-end', 'server-side', 'request handler', 'database queries', 'api'],
  production: ['production', 'deployed', 'real users', 'customers', 'live service', 'shipped'],
};
