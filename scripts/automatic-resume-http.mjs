// Fixture transport only: never replay an ambiguous write or substitute another host.
export async function fetchCapturedResource(origin, resource, options = {}, fetcher = fetch) {
  const target = new URL(resource, origin);
  if (target.origin !== new URL(origin).origin || target.hostname !== '127.0.0.1') throw Error('Captured loopback origin required');
  const headers = new Headers(options.headers);
  // Subprocess probes can outlive the server's idle timeout. Do not retain pooled
  // sockets across that boundary; each completed response closes its connection.
  headers.set('connection', 'close');
  try {
    return await fetcher(target.href, { ...options, headers, signal: options.signal ?? AbortSignal.timeout(15000) });
  } catch (cause) {
    const code = cause.cause?.code ?? cause.code ?? cause.name;
    const error = new Error(`Captured HTTP ${options.method ?? 'GET'} ${target.href} failed (${code}); request not replayed`, { cause });
    error.code = code;
    throw error;
  }
}
