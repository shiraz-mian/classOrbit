import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/repositories/database.js';
import { seed } from '../src/db/seed.js';
import { videoManifest, withinUploads } from '../src/services/media-paths.js';
import { createVideoProcessor, cleanFailedVideo } from '../src/jobs/video.processor.js';
let db, directory, app, teacher, student;
let provider;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'classorbit-media-'));
  db = await createDatabase({ demo: true, file: null });
  await seed(db);
  provider = async () => ({ add: async () => {} });
  app = await createApp(db, {
    media: { uploads: directory, demo: false, queueProvider: () => provider() },
  });
  teacher = request.agent(app);
  student = request.agent(app);
  await teacher.post('/api/auth/demo').send({ role: 'INSTRUCTOR' }).expect(200);
  await student.post('/api/auth/demo').send({ role: 'STUDENT' }).expect(200);
});
afterEach(async () => {
  await db.close();
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(directory, { recursive: true, force: true });
});

test('queue outages reject uploads before writing a raw file', async () => {
  provider = async () => {
    throw Object.assign(new Error('Uploads unavailable'), { status: 503 });
  };
  await teacher
    .post('/api/studio/lessons/react-foundations-lesson-0/video')
    .attach('video', Buffer.from('not video'), { filename: 'clip.mp4', contentType: 'video/mp4' })
    .expect(503);
  assert.deepEqual(await readdir(path.join(directory, 'raw')), []);
  assert.equal((await db.get('lesson', 'react-foundations-lesson-0')).videoStatus, 'EMPTY');
});

test('a failed enqueue restores the previous video and removes the new raw upload', async () => {
  const lessonId = 'react-foundations-lesson-0';
  const previous = videoManifest(lessonId, randomUUID());
  await db.patch('lesson', lessonId, { videoStatus: 'READY', videoPath: previous });
  provider = async () => ({
    add: async () => {
      throw new Error('Redis disconnected');
    },
  });
  await teacher
    .post('/api/studio/lessons/' + lessonId + '/video')
    .attach('video', Buffer.from('not video'), { filename: 'clip.mp4', contentType: 'video/mp4' })
    .expect(503);
  const lesson = await db.get('lesson', lessonId);
  assert.equal(lesson.videoStatus, 'READY');
  assert.equal(lesson.videoPath, previous);
  assert.deepEqual(await readdir(path.join(directory, 'raw')), []);
});

test('uploads queue portable file identities and reject overlapping lesson jobs', async () => {
  let captured;
  provider = async () => ({
    add: async (...args) => {
      captured = args;
    },
  });
  const lessonId = 'react-foundations-lesson-0';
  const result = await teacher
    .post('/api/studio/lessons/' + lessonId + '/video')
    .attach('video', Buffer.from('fixture'), { filename: 'clip.mp4', contentType: 'video/mp4' })
    .expect(202);
  assert.equal(captured[0], 'transcode');
  assert.match(captured[1].filename, /^[a-f0-9]{32}$/);
  assert.equal(captured[1].input, undefined);
  assert.equal(captured[2].jobId, result.body.jobId);
  assert.equal(
    (await db.get('lesson', lessonId)).videoPath,
    videoManifest(lessonId, result.body.jobId),
  );
  await teacher
    .post('/api/studio/lessons/' + lessonId + '/video')
    .attach('video', Buffer.from('second'), { filename: 'clip.mp4', contentType: 'video/mp4' })
    .expect(409);
  assert.equal((await readdir(path.join(directory, 'raw'))).length, 1);
});

test('only ready current-version HLS is served to enrolled users, with MIME and range support', async () => {
  const lessonId = 'react-foundations-lesson-0';
  const version = randomUUID();
  const manifest = videoManifest(lessonId, version);
  const output = withinUploads(directory, path.posix.dirname(manifest));
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'index.m3u8'),
    '#EXTM3U\n#EXTINF:6,\nsegment0000.ts\n#EXT-X-ENDLIST\n',
  );
  await writeFile(path.join(output, 'segment0000.ts'), Buffer.alloc(376, 0x47));
  await db.patch('lesson', lessonId, { videoStatus: 'PROCESSING', videoPath: manifest });
  const url = '/api/media/' + lessonId + '/' + version;
  await student.get(url + '/index.m3u8').expect(404);
  await db.patch('lesson', lessonId, { videoStatus: 'READY' });
  const playlist = await student.get(url + '/index.m3u8').expect(200);
  assert.match(playlist.headers['content-type'], /application\/vnd.apple.mpegurl/);
  const segment = await student
    .get(url + '/segment0000.ts')
    .set('Range', 'bytes=0-187')
    .expect(206);
  assert.match(segment.headers['content-type'], /video\/mp2t/);
  assert.equal(segment.headers['content-length'], '188');
  await request(app)
    .get(url + '/index.m3u8')
    .expect(401);
  await student.get('/api/media/' + lessonId + '/' + randomUUID() + '/index.m3u8').expect(404);
  await student.get(url + '/..%5C..%5C.env').expect(404);
  await student.get('/api/media/' + lessonId + '/index.m3u8').expect(404);
  const playback = await student.get('/api/lessons/' + lessonId + '/playback').expect(200);
  assert.equal(playback.body.url, url + '/index.m3u8');
  assert.throws(() => withinUploads(directory, '../outside'));
});

test('conversion retries stay queued until the final failure and clean only their own files', async () => {
  const lessonId = 'react-foundations-lesson-0';
  const version = randomUUID();
  const filename = 'a'.repeat(32);
  await db.patch('lesson', lessonId, {
    videoStatus: 'QUEUED',
    videoPath: videoManifest(lessonId, version),
  });
  await writeFile(path.join(directory, 'raw', filename), 'invalid video');
  const processor = createVideoProcessor(db, {
    uploads: directory,
    exec: async () => {
      throw new Error('Invalid media');
    },
  });
  const job = { id: version, data: { lessonId, filename }, opts: { attempts: 3 }, attemptsMade: 0 };
  await assert.rejects(processor(job));
  assert.equal((await db.get('lesson', lessonId)).videoStatus, 'QUEUED');
  await assert.rejects(processor({ ...job, attemptsMade: 2 }));
  assert.equal((await db.get('lesson', lessonId)).videoStatus, 'FAILED');
  // Cleanup waits until BullMQ confirms terminal failure, so a stalled attempt can retry.
  assert.equal((await readdir(path.join(directory, 'raw'))).length, 1);
  await cleanFailedVideo({ ...job, attemptsMade: 3 }, { uploads: directory });
  assert.deepEqual(await readdir(path.join(directory, 'raw')), []);
  assert.deepEqual(await readdir(path.join(directory, 'media', lessonId)), []);
});
