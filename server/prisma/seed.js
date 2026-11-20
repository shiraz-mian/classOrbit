import { createDatabase } from '../src/repositories/database.js';
import { seed } from '../src/db/seed.js';
const db = await createDatabase({ demo: false });
try {
  await seed(db);
  console.log('ClassOrbit sample content is ready.');
} finally {
  await db.close();
}
