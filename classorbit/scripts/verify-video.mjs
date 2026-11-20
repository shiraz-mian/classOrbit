import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { config } from '../server/src/config/index.js';
import { createApp } from '../server/src/app.js';
import { createPrismaRepository } from '../server/src/repositories/prisma.js';
import { getVideoQueue, closeVideoQueue } from '../server/src/jobs/queue.js';
import { withinUploads } from '../server/src/services/media-paths.js';

if (config.demo || config.production)
  throw new Error('Use DEMO_MODE=false and a development database.');
if (process.env.S3_BUCKET || process.env.CLOUDFRONT_URL)
  throw new Error(
    'This check verifies local media storage. Use a development environment without S3/CloudFront configured.',
  );
const execute = promisify(execFile);
const runId = randomUUID();
const artifactDir = path.join(config.root, '.data', 'video-verification', runId);
const fixtureDirectory = withinUploads(config.uploads, '.verification/' + runId);
const containerFixture = '/app/uploads/.verification/' + runId + '/source.mp4';
const userIds = Array.from({ length: 3 }, () => randomUUID());
const password = randomBytes(24).toString('base64url');
const prisma = new PrismaClient({ log: [] });
const db = createPrismaRepository(prisma);
const jobs = [];
let queue, courseId, lessonId;
const report = {
  runId,
  startedAt: new Date().toISOString(),
  checks: [],
  storage: 'local HLS',
  database: 'PostgreSQL',
};
await mkdir(artifactDir, { recursive: true });
async function docker(args) {
  return execute(
    process.env.DOCKER_BIN || 'docker',
    ['compose', '-f', 'compose.media.yaml', ...args],
    { cwd: config.root, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 },
  );
}
async function check(name, fn) {
  await fn();
  report.checks.push({ name, passed: true });
  console.log('PASS ' + name);
}
async function call(agent, method, url, body, expected = 200) {
  let operation = agent[method](url).timeout({ response: 45000, deadline: 60000 });
  if (body !== undefined) operation = operation.send(body);
  const response = await operation;
  assert.equal(
    response.status,
    expected,
    method.toUpperCase() + ' ' + url + ' returned ' + response.status + ', expected ' + expected,
  );
  return response;
}
async function waitForJob(id, expected) {
  const started = Date.now();
  const observed = [];
  while (Date.now() - started < 120000) {
    const job = await queue.getJob(id);
    assert.ok(job, 'Queued job must exist');
    const state = await job.getState();
    if (!observed.includes(state)) observed.push(state);
    if (['failed', 'completed'].includes(state)) {
      report.jobs ||= [];
      report.jobs.push({
        id,
        expected,
        state,
        attemptsMade: job.attemptsMade,
        observed,
        elapsedMs: Date.now() - started,
      });
      assert.equal(state, expected, 'Unexpected conversion result');
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw Object.assign(new Error('Conversion did not finish within two minutes'), {
    code: 'VIDEO_TIMEOUT',
  });
}
async function upload(agent, file) {
  const response = await agent
    .post('/api/studio/lessons/' + lessonId + '/video')
    .attach('video', file, { filename: 'test-video.mp4', contentType: 'video/mp4' })
    .timeout({ response: 45000, deadline: 60000 });
  assert.equal(response.status, 202, 'Video upload should be queued');
  jobs.push(response.body.jobId);
  return response.body.jobId;
}
const binary = (response, callback) => {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
};
try {
  await check('Redis, live worker, and Neon are available', async () => {
    queue = await getVideoQueue();
    assert.ok((await queue.getWorkersCount()) > 0, 'Start npm run media:up first');
    await prisma.$queryRawUnsafe('SELECT 1');
    report.existing = { users: await prisma.user.count(), courses: await prisma.course.count() };
  });
  await check(
    'FFmpeg generates a 13-second video with audio in the shared upload folder',
    async () => {
      const code =
        'const fs=require("node:fs");const cp=require("node:child_process");fs.mkdirSync(' +
        JSON.stringify(path.posix.dirname(containerFixture)) +
        ',{recursive:true});cp.execFileSync("ffmpeg",["-y","-hide_banner","-loglevel","error","-f","lavfi","-i","testsrc2=size=320x180:rate=24","-f","lavfi","-i","sine=frequency=440:sample_rate=48000","-t","13","-c:v","libx264","-preset","ultrafast","-pix_fmt","yuv420p","-c:a","aac",' +
        JSON.stringify(containerFixture) +
        '],{stdio:"inherit"});';
      await docker(['exec', '-T', 'worker', 'node', '-e', code]);
      const source = await readFile(path.join(fixtureDirectory, 'source.mp4'));
      assert.ok(source.length > 10000);
      report.sourceBytes = source.length;
    },
  );
  const app = await createApp(db);
  const admin = request.agent(app),
    teacher = request.agent(app),
    student = request.agent(app);
  await check('Isolated instructor needs admin approval before any video upload', async () => {
    const hash = await bcrypt.hash(password, 12);
    for (const [index, role] of ['ADMIN', 'INSTRUCTOR', 'STUDENT'].entries()) {
      const email = role.toLowerCase() + '.' + runId + '@classorbit.test';
      await prisma.user.create({
        data: {
          id: userIds[index],
          name: 'Video Verification ' + role,
          email,
          role,
          instructorApproved: false,
          passwordHash: hash,
        },
      });
      await call([admin, teacher, student][index], 'post', '/api/auth/login', { email, password });
    }
    await call(teacher, 'post', '/api/studio/lessons/no-lesson/video', {}, 403);
    await call(admin, 'patch', '/api/admin/users/' + userIds[1] + '/instructor-access', {
      approved: true,
    });
  });
  await check('Approved instructor authors a free course and lesson', async () => {
    const course = await call(
      teacher,
      'post',
      '/api/studio/courses',
      {
        title: 'Temporary video verification course',
        description: 'Isolated course for testing the ClassOrbit video processing pipeline.',
        category: 'Development',
        level: 'Beginner',
        price: 0,
        color: 'mint',
      },
      201,
    );
    courseId = course.body.id;
    const lesson = await call(
      teacher,
      'post',
      '/api/studio/courses/' + courseId + '/lessons',
      {
        title: 'Generated streaming test clip',
        content: 'An automatically generated test video with audio.',
        duration: 1,
      },
      201,
    );
    lessonId = lesson.body.id;
    await call(teacher, 'patch', '/api/studio/courses/' + courseId, { status: 'PUBLISHED' });
  });
  let firstUrl;
  await check(
    'MP4 upload crosses Windows/Linux and finishes real BullMQ/FFmpeg conversion',
    async () => {
      const id = await upload(teacher, path.join(fixtureDirectory, 'source.mp4'));
      await waitForJob(id, 'completed');
      const lesson = await prisma.lesson.findUniqueOrThrow({ where: { id: lessonId } });
      assert.equal(lesson.videoStatus, 'READY');
      assert.ok(lesson.videoPath.includes(id));
      const playback = await call(teacher, 'get', '/api/lessons/' + lessonId + '/playback');
      firstUrl = playback.body.url;
      assert.equal(playback.body.status, 'READY');
    },
  );
  await check(
    'Anonymous and unenrolled playback is denied, including direct segments',
    async () => {
      await call(request(app), 'get', firstUrl, undefined, 401);
      await call(student, 'get', firstUrl, undefined, 403);
      await call(student, 'get', firstUrl.replace('index.m3u8', 'segment0000.ts'), undefined, 403);
      await call(student, 'post', '/api/courses/' + courseId + '/enroll', {});
    },
  );
  await check(
    'Enrolled student receives a VOD playlist, every segment, and HTTP byte ranges',
    async () => {
      const playlist = await call(student, 'get', firstUrl);
      assert.match(playlist.headers['content-type'], /application\/vnd.apple.mpegurl/);
      const text = playlist.text || playlist.body.toString();
      assert.match(text, /#EXT-X-ENDLIST/);
      const segments = text.split(/\r?\n/).filter((line) => /^segment\d+\.ts$/.test(line));
      assert.ok(segments.length >= 2);
      report.segmentCount = segments.length;
      for (const segment of segments) {
        const response = await student
          .get(firstUrl.replace('index.m3u8', segment))
          .buffer(true)
          .parse(binary)
          .expect(200);
        assert.match(response.headers['content-type'], /video\/mp2t/);
        assert.ok(response.body.length > 188);
        assert.equal(response.body[0], 0x47);
      }
      await student
        .get(firstUrl.replace('index.m3u8', segments[0]))
        .set('Range', 'bytes=0-187')
        .expect(206)
        .expect('Content-Length', '188');
      const lesson = await prisma.lesson.findUniqueOrThrow({ where: { id: lessonId } });
      await docker([
        'exec',
        '-T',
        'worker',
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        '/app/uploads/' + lesson.videoPath,
        '-f',
        'null',
        '-',
      ]);
    },
  );
  await check(
    'Invalid media exhausts retries, becomes FAILED, and cannot serve partial output',
    async () => {
      const id = await upload(
        teacher,
        Buffer.from(
          [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-TARGETDURATION:13',
            '#EXT-X-MEDIA-SEQUENCE:0',
            '#EXTINF:13.0,',
            containerFixture,
            '#EXT-X-ENDLIST',
            '',
          ].join('\n'),
        ),
      );
      const job = await waitForJob(id, 'failed');
      assert.equal(job.attemptsMade, 3);
      assert.equal(
        (await prisma.lesson.findUniqueOrThrow({ where: { id: lessonId } })).videoStatus,
        'FAILED',
      );
      const playback = await call(teacher, 'get', '/api/lessons/' + lessonId + '/playback');
      assert.equal(playback.body.url, null);
      await call(
        student,
        'get',
        '/api/media/' + lessonId + '/' + id + '/index.m3u8',
        undefined,
        404,
      );
    },
  );
  await check(
    'A fresh upload recovers after failure and old-version URLs stay inaccessible',
    async () => {
      const id = await upload(teacher, path.join(fixtureDirectory, 'source.mp4'));
      await waitForJob(id, 'completed');
      const playback = await call(student, 'get', '/api/lessons/' + lessonId + '/playback');
      assert.notEqual(playback.body.url, firstUrl);
      await call(student, 'get', playback.body.url);
      await call(student, 'get', firstUrl, undefined, 404);
      await call(
        student,
        'get',
        playback.body.url.replace('index.m3u8', '..%5C..%5C.env'),
        undefined,
        404,
      );
    },
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = {
    type: error.name,
    code: error.code || null,
    message:
      error.name === 'AssertionError'
        ? error.message
        : 'Video verification stopped; inspect the last completed check and worker logs.',
  };
  console.error('FAIL ' + report.failure.message);
  process.exitCode = 1;
} finally {
  try {
    const filenames = [];
    for (const id of jobs) {
      const job = await queue.getJob(id);
      if (!job) continue;
      assert.notEqual(
        await job.getState(),
        'active',
        'Active conversion retained for safe recovery',
      );
      if (/^[a-f0-9]{32}$/.test(job.data.filename || '')) filenames.push(job.data.filename);
      await job.remove();
    }
    await prisma.$transaction([
      prisma.enrollment.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.course.deleteMany({ where: { instructorId: userIds[1] } }),
      prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    ]);
    for (const name of filenames)
      await unlink(withinUploads(config.uploads, 'raw/' + name)).catch(() => {});
    if (lessonId)
      await rm(withinUploads(config.uploads, 'media/' + lessonId), {
        recursive: true,
        force: true,
      });
    await rm(fixtureDirectory, { recursive: true, force: true });
    report.cleanup = 'completed';
    console.log('Removed only this run’s database fixtures, queue jobs, and media files.');
  } catch {
    report.cleanup = 'failed';
    report.passed = false;
    process.exitCode = 1;
    console.error('Some temporary fixtures were retained for safe recovery.');
  }
  await closeVideoQueue();
  await db.close();
  report.fixtures = { userIds, courseId, lessonId, jobIds: jobs };
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report: ' + path.relative(config.root, path.join(artifactDir, 'report.json')));
  console.log(report.checks.length + ' video-pipeline checks passed.');
}
