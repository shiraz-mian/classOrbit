import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { createMediaDelivery } from '../server/src/services/cloudfront.service.js';
import { createDatabase } from '../server/src/repositories/database.js';
import { config } from '../server/src/config/index.js';
import { awsContext } from './lib/aws-context.mjs';
const args = process.argv.slice(2),
  value = (flag) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
for (let i = 0; i < args.length; i += 2)
  if (!['--lesson', '--credentials-env', '--region'].includes(args[i]) || !args[i + 1])
    throw new Error('Use --lesson <id>, --credentials-env <file>, --region <region>.');
if (config.demo) throw new Error('Use PostgreSQL mode for cloud verification.');
const context = await awsContext(args),
  s3 = new S3Client(context),
  env = { ...process.env, AWS_REGION: context.region };
const delivery = createMediaDelivery({ env, root: config.root, s3 });
if (!delivery.enabled)
  throw new Error('Configure the ClassOrbit CloudFront stack and signing key first.');
const directory = path.join(config.root, '.data/cdn-verification', randomUUID());
await mkdir(directory, { recursive: true });
const report = { startedAt: new Date().toISOString(), checks: [], mutations: false };
const db = await createDatabase({ demo: false });
const get = (url, headers = {}) => fetch(url, { headers, signal: AbortSignal.timeout(30000) });
const check = async (name, fn) => {
  await fn();
  report.checks.push({ name, passed: true });
  console.log('PASS ' + name);
};
try {
  const lesson = (await db.all('lesson')).find(
    (l) => l.videoStatus === 'READY' && (!value('--lesson') || l.id === value('--lesson')),
  );
  assert.ok(lesson, 'A READY lesson is required');
  report.lessonId = lesson.id;
  const playlist = await delivery.playlist(lesson),
    urls = playlist.split(/\r?\n/).filter((l) => l.startsWith('https://'));
  assert.ok(urls.length);
  const signed = urls[0],
    unsigned = new URL(signed);
  unsigned.search = '';
  await check('Unsigned CloudFront asset is denied even if cached', async () =>
    assert.equal((await get(unsigned)).status, 403),
  );
  await check(
    'Signed segment is delivered with correct CORS and transport-stream data',
    async () => {
      const r = await get(signed, { Origin: config.appUrl });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('access-control-allow-origin'), config.appUrl);
      assert.match(r.headers.get('content-type'), /video\/mp2t/);
      assert.equal(new Uint8Array(await r.arrayBuffer())[0], 0x47);
    },
  );
  await check('CloudFront byte-range retrieval works', async () => {
    const r = await get(signed, { Range: 'bytes=0-187', Origin: config.appUrl });
    assert.equal(r.status, 206);
    assert.equal((await r.arrayBuffer()).byteLength, 188);
  });
  await check('Expired signed asset is denied', async () => {
    const expired = createMediaDelivery({
      env,
      root: config.root,
      s3,
      now: () => Date.now() - 7200000,
    });
    const url = (await expired.playlist(lesson))
      .split(/\r?\n/)
      .find((l) => l.startsWith('https://'));
    assert.equal((await get(url)).status, 403);
  });
  await check('Tampered segment path is denied', async () => {
    const url = new URL(signed);
    url.pathname = url.pathname.replace(/segment\d+\.ts$/, 'segment999999.ts');
    assert.equal((await get(url)).status, 403);
  });
  await check('Unsigned direct S3 access is denied', async () =>
    assert.equal(
      (
        await get(
          'https://' +
            env.S3_BUCKET +
            '.s3.' +
            context.region +
            '.amazonaws.com/' +
            lesson.videoPath,
        )
      ).status,
      403,
    ),
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  await db.close();
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report: ' + path.join(directory, 'report.json'));
}
