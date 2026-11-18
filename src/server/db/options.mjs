/** Shared pure driver configuration; never logs or reads environment variables. */
export function databaseOptions(value) {
  let url;
  try { url = new URL(value); }
  catch { const error = new Error('Invalid database URL'); error.code = 'DATABASE_URL_INVALID'; throw error; }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    const error = new Error('Invalid database protocol'); error.code = 'DATABASE_URL_INVALID'; throw error;
  }
  // Explicitly preserve pg 8's certificate/hostname verification semantics.
  // This removes the deprecation warning without disabling TLS verification.
  if (['prefer', 'require', 'verify-ca'].includes(url.searchParams.get('sslmode')) && url.searchParams.get('uselibpqcompat') !== 'true')
    url.searchParams.set('sslmode', 'verify-full');
  return { connectionString: url.toString(), connectionTimeoutMillis: 15000 };
}
export function databaseDiagnostic(error, phase = 'database operation') {
  const errors = [], queue = [error];
  while (queue.length && errors.length < 12) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || errors.includes(item)) continue;
    errors.push(item); queue.push(item.cause, ...(Array.isArray(item.errors) ? item.errors.slice(0, 6) : []));
  }
  const codes = errors.map(e => e.code).filter(c => typeof c === 'string');
  let code = codes.find(c => /^[A-Z0-9_]{1,40}$/.test(c)) || 'UNKNOWN';
  let advice = 'Check database availability and configuration. Run npm run db:check for a read-only connectivity check.';
  if (codes.includes('DATABASE_URL_INVALID')) { code = 'DATABASE_URL_INVALID'; advice = 'Set DATABASE_URL to the PostgreSQL connection URL from the intended Neon project.'; }
  else if (codes.some(c => ['EAI_AGAIN','ENOTFOUND'].includes(c))) advice = 'Database DNS lookup failed. Check the configured hostname, network and DNS, then retry explicitly.';
  else if (codes.some(c => ['ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','ECONNRESET'].includes(c))) advice = 'Database network connection failed. Check network/VPN/firewall access and database availability.';
  else if (errors.some(e => /certificate|TLS|SSL/i.test(e.message || ''))) { code = codes.find(c => /CERT|TLS|SSL/.test(c)) || 'TLS_VERIFICATION'; advice = 'Certificate verification failed. Check the hostname and trusted CA/network proxy configuration; do not disable certificate verification.'; }
  else if (errors.some(e => /timeout|timed out/i.test(e.message || '')) || codes.includes('ETIMEDOUT')) { code = 'TIMEOUT'; advice = 'Database connection or query timed out. Check network access and Neon availability; a sleeping compute may need time to wake. Retry explicitly.'; }
  else if (codes.includes('28P01') || codes.includes('28000')) advice = 'Database authentication failed. Replace DATABASE_URL with the correct existing project connection string.';
  else if (codes.includes('42501')) advice = 'The database role lacks permission for this operation. Review its privileges for the intended database.';
  else if (codes.includes('42P07')) advice = 'A migration table already exists without the expected migration history. Review the existing schema; do not drop tables blindly.';
  else if (codes.includes('MIGRATION_CHECKSUM')) advice = 'An applied migration has changed. Restore its original contents and add a new migration instead.';
  // Never return raw messages, causes, stacks, URLs, hosts, database names or SQL details.
  return `${phase} failed (${code}). ${advice}`;
}
