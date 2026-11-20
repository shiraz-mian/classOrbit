import { config } from '../server/src/config/index.js';
import { PrismaClient } from '@prisma/client';

if (config.demo) {
  console.error('The app is in JSON demo mode. Set DEMO_MODE=false in .env to check PostgreSQL.');
  process.exit(1);
}
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  const value = process.env[key];
  if (!value || value.startsWith('PASTE_') || !/^postgres(?:ql)?:\/\//.test(value)) {
    console.error(
      'Set ' + key + ' to the PostgreSQL connection string from Neon in the root .env file.',
    );
    process.exit(1);
  }
}
const db = new PrismaClient({ log: [] });
try {
  await db.$queryRawUnsafe('SELECT 1');
  await db.checkoutOrder.count();
  console.log('PostgreSQL connection succeeded.');
  const [users, courses] = await Promise.all([db.user.count(), db.course.count()]);
  console.log('ClassOrbit tables are available: ' + users + ' users, ' + courses + ' courses.');
  const roles = await db.user.groupBy({ by: ['role'], _count: { _all: true } });
  console.log(
    'Account roles: ' +
      ['STUDENT', 'INSTRUCTOR', 'ADMIN']
        .map((role) => role + '=' + (roles.find((entry) => entry.role === role)?._count._all || 0))
        .join(', '),
  );
} catch (error) {
  if (error.code === 'P2021')
    console.error('Connected, but ClassOrbit tables are missing. Run npm run db:migrate.');
  else
    console.error(
      'Database check failed' +
        (error.code ? ' (' + error.code + ')' : '') +
        '. Check the URLs, credentials, TLS settings, and network access.',
    );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
