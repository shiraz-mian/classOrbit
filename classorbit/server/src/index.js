import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createDatabase } from './repositories/database.js';
import { seed } from './db/seed.js';
import { attachRealtime } from './sockets/classroom.js';
import { config } from './config/index.js';
import { closeVideoQueue } from './jobs/queue.js';
const db = await createDatabase();
if (config.demo) await seed(db);
const app = await createApp(db);
const server = createServer(app);
const io = attachRealtime(server, db);
server.listen(config.port, '0.0.0.0', () =>
  console.log(
    'ClassOrbit API: http://localhost:' +
      config.port +
      ' (' +
      (config.demo ? 'local demo' : 'PostgreSQL') +
      ')',
  ),
);
const shutdown = () => {
  io.close();
  server.close(async () => {
    await closeVideoQueue();
    await db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
