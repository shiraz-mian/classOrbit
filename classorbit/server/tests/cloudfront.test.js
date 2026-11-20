import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import request from 'supertest';
import { createMediaDelivery } from '../src/services/cloudfront.service.js';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/repositories/database.js';
import { seed } from '../src/db/seed.js';
import { videoManifest } from '../src/services/media-paths.js';
import { createVideoProcessor } from '../src/jobs/video.processor.js';
const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const env = {
  CLOUDFRONT_URL: 'https://example.cloudfront.net',
  S3_BUCKET: 'isolated-test-bucket',
  AWS_REGION: 'ap-southeast-2',
  CLOUDFRONT_KEY_PAIR_ID: 'TESTKEY',
  CLOUDFRONT_PRIVATE_KEY: pair.privateKey,
  APP_URL: 'http://localhost:5173',
};
const version = randomUUID();
const lesson = {
  id: 'react-foundations-lesson-0',
  courseId: 'react-foundations',
  videoStatus: 'READY',
  videoPath: videoManifest('react-foundations-lesson-0', version),
};
const manifest =
  '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nsegment0000.ts\n#EXTINF:6.0,\nsegment0001.ts\n#EXT-X-ENDLIST\n';
const unescapeCF = (text) =>
  Buffer.from(text.replaceAll('-', '+').replaceAll('_', '=').replaceAll('~', '/'), 'base64');
const delivery = (content = manifest, overrides = {}) =>
  createMediaDelivery({
    env: { ...env, ...overrides },
    now: () => 1700000000000,
    s3: {
      send: async (command) => {
        assert.equal(command.input.Key, lesson.videoPath);
        return {
          ContentLength: Buffer.byteLength(content),
          Body: { transformToString: async () => content },
        };
      },
    },
  });

test('signed URL delivery works without a domain and signatures cover individual versioned segments', async () => {
  const cdn = delivery();
  const playback = cdn.playback(lesson, {});
  assert.equal(playback.credentials, 'omit');
  assert.equal(playback.delivery, 'cloudfront');
  assert.match(playback.url, new RegExp('/hls/' + version + '/index.m3u8'));
  assert.equal(playback.expiresAt, '2023-11-14T22:28:20.000Z');
  const playlist = await cdn.playlist(lesson);
  const urls = playlist.split('\n').filter((line) => line.startsWith('https:'));
  assert.equal(urls.length, 2);
  for (const [i, value] of urls.entries()) {
    const url = new URL(value);
    const resource =
      env.CLOUDFRONT_URL + '/media/' + lesson.id + '/' + version + '/segment000' + i + '.ts';
    assert.equal(url.origin + url.pathname, resource);
    assert.equal(url.searchParams.get('Hash-Algorithm'), 'SHA256');
    assert.equal(url.searchParams.get('Key-Pair-Id'), 'TESTKEY');
    const policy = JSON.stringify({
      Statement: [
        {
          Resource: resource,
          Condition: { DateLessThan: { 'AWS:EpochTime': Number(url.searchParams.get('Expires')) } },
        },
      ],
    });
    assert.equal(
      verify(
        'RSA-SHA256',
        Buffer.from(policy),
        pair.publicKey,
        unescapeCF(url.searchParams.get('Signature')),
      ),
      true,
    );
    assert.equal(
      verify(
        'RSA-SHA256',
        Buffer.from(policy.replace('segment000', 'segment999')),
        pair.publicKey,
        unescapeCF(url.searchParams.get('Signature')),
      ),
      false,
    );
  }
});

test('playlist rewriting rejects external, traversing, encrypted and incomplete references', async () => {
  for (const reference of [
    '../segment0000.ts',
    'https://attacker.test/clip.ts',
    'segment0000.ts?extra=1',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://attacker.test/key"',
  ])
    await assert.rejects(
      delivery(manifest.replace('segment0000.ts', reference)).playlist(lesson),
      /Unsupported/,
    );
  await assert.rejects(
    delivery(manifest.replace('#EXT-X-ENDLIST', '')).playlist(lesson),
    /invalid/,
  );
  await assert.rejects(delivery(manifest + ' '.repeat(262144)).playlist(lesson), /too large/);
});

test('CloudFront configuration fails clearly for partial keys, invalid origins and cookie-domain mismatch', () => {
  assert.equal(createMediaDelivery({ env: {} }).enabled, false);
  for (const overrides of [
    { S3_BUCKET: '' },
    { AWS_REGION: '' },
    { CLOUDFRONT_PRIVATE_KEY: 'invalid' },
    { CLOUDFRONT_URL: 'http://example.cloudfront.net' },
    { CLOUDFRONT_URL: 'https://example.cloudfront.net/media' },
    { CLOUDFRONT_URL_TTL: '0' },
    { CLOUDFRONT_AUTH_MODE: 'other' },
    { CLOUDFRONT_AUTH_MODE: 'cookies', CDN_COOKIE_DOMAIN: '.example.com' },
  ])
    assert.throws(() => delivery(manifest, overrides));
  assert.doesNotThrow(() =>
    delivery(manifest, { CLOUDFRONT_PRIVATE_KEY: pair.privateKey.replaceAll('\n', '\\n') }),
  );
});

test('shared-domain cookie mode scopes signed cookies to only the current lesson version', () => {
  const cookies = [];
  const cdn = delivery(manifest, {
    CLOUDFRONT_AUTH_MODE: 'cookies',
    CLOUDFRONT_URL: 'https://media.example.com',
    APP_URL: 'https://app.example.com',
    CDN_COOKIE_DOMAIN: '.example.com',
  });
  const result = cdn.playback(lesson, { cookie: (...args) => cookies.push(args) });
  assert.equal(result.credentials, 'include');
  assert.ok(cookies.length >= 3);
  for (const [name, value, options] of cookies) {
    assert.ok(name.startsWith('CloudFront-'));
    assert.equal(options.domain, 'example.com');
    assert.equal(options.secure, true);
    assert.equal(options.httpOnly, true);
    assert.equal(options.path, '/media/' + lesson.id + '/' + version + '/');
  }
  const policy = JSON.parse(unescapeCF(cookies.find((c) => c[0] === 'CloudFront-Policy')[1]));
  assert.equal(
    policy.Statement[0].Resource,
    'https://media.example.com/media/' + lesson.id + '/' + version + '/*',
  );
});

test('CloudFront playlist and metadata require enrollment and reject stale versions', async (t) => {
  const db = await createDatabase({ demo: true, file: null });
  t.after(() => db.close());
  await seed(db);
  await db.patch('lesson', lesson.id, lesson);
  const app = await createApp(db, { media: { delivery: delivery() } }),
    student = request.agent(app);
  await student.post('/api/auth/demo').send({ role: 'STUDENT' }).expect(200);
  const response = await student.get('/api/lessons/' + lesson.id + '/playback').expect(200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers['set-cookie'], undefined);
  const playlist = await student.get(response.body.url).expect(200);
  assert.match(playlist.text, /Signature=/);
  assert.match(playlist.headers['content-type'], /application\/vnd.apple.mpegurl/);
  await request(app).get(response.body.url).expect(401);
  await student.get(response.body.url.replace(version, randomUUID())).expect(404);
  const outsider = request.agent(app);
  await outsider
    .post('/api/auth/register')
    .send({
      name: 'Unenrolled Learner',
      email: 'cdn-outsider@test.local',
      password: 'Password12345!',
    })
    .expect(201);
  await outsider.get(response.body.url).expect(403);
  await outsider.get('/api/lessons/' + lesson.id + '/playback').expect(403);
  await db.patch('lesson', lesson.id, { videoStatus: 'PROCESSING' });
  await student.get(response.body.url).expect(404);
});

test('S3 publication uploads segments before the playlist and cannot mark a failed publication READY', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'classorbit-cdn-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(directory, { recursive: true, force: true });
  });
  const db = await createDatabase({ demo: true, file: null });
  t.after(() => db.close());
  await seed(db);
  const uploadVersion = randomUUID(),
    filename = 'b'.repeat(32);
  await db.patch('lesson', lesson.id, {
    videoStatus: 'QUEUED',
    videoPath: videoManifest(lesson.id, uploadVersion),
  });
  await mkdir(path.join(directory, 'raw'), { recursive: true });
  await writeFile(path.join(directory, 'raw', filename), 'source fixture');
  const uploaded = [];
  let rejectManifest = true;
  const processor = createVideoProcessor(db, {
    uploads: directory,
    bucket: 'test-bucket',
    exec: async (exe, args) => {
      const output = args.at(-1);
      await writeFile(output, manifest);
      await writeFile(path.join(path.dirname(output), 'segment0000.ts'), 'segment');
      await writeFile(path.join(path.dirname(output), 'segment0001.ts'), 'segment');
    },
    s3: {
      send: async (command) => {
        uploaded.push(command.input);
        if (rejectManifest && command.input.Key.endsWith('.m3u8'))
          throw new Error('S3 write failure');
      },
    },
  });
  const job = {
    id: uploadVersion,
    data: { lessonId: lesson.id, filename },
    attemptsMade: 0,
    opts: { attempts: 3 },
  };
  await assert.rejects(processor(job));
  assert.equal((await db.get('lesson', lesson.id)).videoStatus, 'QUEUED');
  rejectManifest = false;
  uploaded.length = 0;
  await processor({ ...job, attemptsMade: 1 });
  assert.equal((await db.get('lesson', lesson.id)).videoStatus, 'READY');
  assert.equal(uploaded.length, 3);
  assert.ok(uploaded.at(-1).Key.endsWith('/index.m3u8'));
  assert.ok(uploaded[0].CacheControl.includes('immutable'));
  assert.equal(uploaded.at(-1).ContentType, 'application/vnd.apple.mpegurl');
});

test('the AWS template keeps the S3 origin private and requires signed CloudFront requests', async () => {
  const { readFile } = await import('node:fs/promises');
  const template = JSON.parse(
    await readFile(new URL('../../infra/aws/media-stack.json', import.meta.url), 'utf8'),
  );
  const resources = template.Resources;
  assert.equal(resources.MediaBucket.DeletionPolicy, 'Retain');
  assert.ok(
    Object.values(resources.MediaBucket.Properties.PublicAccessBlockConfiguration).every(Boolean),
  );
  const distribution = resources.MediaDistribution.Properties.DistributionConfig;
  assert.equal(distribution.ViewerCertificate.CloudFrontDefaultCertificate, true);
  assert.equal(distribution.Aliases, undefined);
  assert.ok(distribution.DefaultCacheBehavior.TrustedKeyGroups.length);
  assert.equal(distribution.DefaultCacheBehavior.ViewerProtocolPolicy, 'https-only');
  assert.equal(resources.MediaOAC.Properties.OriginAccessControlConfig.SigningBehavior, 'always');
  assert.ok(
    resources.MediaBucketPolicy.Properties.PolicyDocument.Statement[0].Condition.StringEquals[
      'AWS:SourceArn'
    ],
  );
  assert.equal(
    resources.MediaCachePolicy.Properties.CachePolicyConfig.ParametersInCacheKeyAndForwardedToOrigin
      .QueryStringsConfig.QueryStringBehavior,
    'none',
  );
});
