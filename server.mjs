import { createServer } from 'node:http';
import { config } from './src/config.mjs';
import { createMemoryStore } from './src/store/memory-store.mjs';
import { createPostgresStore } from './src/store/pg-store.mjs';
import { createAuth, createMemoryAuthStore, createPostgresAuthStore } from './src/auth/auth.mjs';
import { createMetrics } from './src/metrics.mjs';
import { createHandler } from './src/http/handler.mjs';

// Entry point: choose the storage, build the services, start listening. All request logic lives in src/http.
const store = config.databaseUrl
  ? await createPostgresStore({ connectionString: config.databaseUrl, maxRecords: config.maxRecords })
  : createMemoryStore({ maxRecords: config.maxRecords });
const storeKind = config.databaseUrl ? 'postgres' : 'memory';
const auth = createAuth({ db: store._pool ? await createPostgresAuthStore(store._pool) : createMemoryAuthStore() });
const metrics = createMetrics();

const server = createServer(createHandler({ store, storeKind, auth, metrics, config }));

setInterval(() => auth.sweep().catch(() => {}), 600_000).unref();
if (config.isProduction && storeKind === 'memory') console.warn('Warning: DATABASE_URL is not set, so data lives in memory and is lost on every restart.');
// When the host stops the app, finish open requests and close the database pool cleanly.
process.on('SIGTERM', () => server.close(async () => { try { await store._pool?.end(); } catch { /* already closed */ } process.exit(0); }));
server.listen(config.port, () => console.log(`RecoverFlow ready at http://localhost:${config.port} (${storeKind}, auth: ${config.authOn ? 'accounts' : 'OFF (demo)'})`));
