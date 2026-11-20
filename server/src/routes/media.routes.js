import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { config } from '../config/index.js';
import { auth, instructor } from '../middleware/auth.js';
import { fail, canAccess, canEdit } from '../services/learning.service.js';
import { getVideoQueue } from '../jobs/queue.js';
import { videoManifest, mediaLocation, withinUploads } from '../services/media-paths.js';
import { createMediaDelivery } from '../services/cloudfront.service.js';

export function createRouter(
  db,
  {
    uploads = config.uploads,
    queueProvider = getVideoQueue,
    demo = config.demo,
    delivery: injectedDelivery,
  } = {},
) {
  const app = Router();
  let cachedDelivery;
  const delivery = () =>
    injectedDelivery || (cachedDelivery ||= createMediaDelivery({ root: config.root }));
  const upload = multer({
    dest: path.join(uploads, 'raw'),
    limits: { fileSize: 500 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) =>
      cb(null, ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.mimetype)),
  });
  app.post(
    '/api/studio/lessons/:lessonId/video',
    auth,
    instructor,
    async (req, res, next) => {
      const lesson = await db.get('lesson', req.params.lessonId);
      if (!lesson) fail(404, 'Lesson not found');
      await canEdit(db, req.user, lesson.courseId);
      if (demo)
        fail(
          503,
          'Video conversion requires PostgreSQL, Redis, and the FFmpeg worker. Use the media setup in the README.',
        );
      if (['QUEUED', 'PROCESSING'].includes(lesson.videoStatus))
        fail(409, 'This lesson already has a video processing job');
      // Check Redis before accepting a potentially large file.
      req.videoQueue = await queueProvider();
      await mkdir(path.join(uploads, 'raw'), { recursive: true });
      next();
    },
    upload.single('video'),
    async (req, res) => {
      if (!req.file) fail(400, 'Upload an MP4, WebM, or MOV video (maximum 500 MB)');
      const jobId = randomUUID();
      const manifest = videoManifest(req.params.lessonId, jobId);
      let previous;
      let reserved = false;
      try {
        await db.atomic(async (tx) => {
          const user = await tx.get('user', req.user.id);
          if (
            !user ||
            (user.role !== 'ADMIN' &&
              (user.role !== 'INSTRUCTOR' || user.instructorApproved !== true))
          )
            fail(403, 'Admin teaching approval is required to upload videos');
          const lesson = await tx.get('lesson', req.params.lessonId);
          if (!lesson) fail(404, 'Lesson not found');
          await canEdit(tx, user, lesson.courseId);
          if (['QUEUED', 'PROCESSING'].includes(lesson.videoStatus))
            fail(409, 'This lesson already has a video processing job');
          previous = { videoStatus: lesson.videoStatus, videoPath: lesson.videoPath };
          await tx.patch('lesson', lesson.id, { videoStatus: 'QUEUED', videoPath: manifest });
        });
        reserved = true;
        await req.videoQueue.add(
          'transcode',
          { lessonId: req.params.lessonId, filename: req.file.filename },
          {
            jobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 3000 },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      } catch (error) {
        let running = false;
        if (reserved)
          await db.atomic(async (tx) => {
            const current = await tx.get('lesson', req.params.lessonId);
            if (current?.videoPath !== manifest) return;
            if (['PROCESSING', 'READY'].includes(current.videoStatus)) running = true;
            else await tx.patch('lesson', current.id, previous);
          });
        // If an enqueue acknowledgement was lost but the worker started, retain its input.
        if (running) return res.status(202).json({ status: 'QUEUED', jobId });
        await unlink(req.file.path).catch(() => {});
        if (reserved && !error.status)
          fail(503, 'Video uploads are temporarily unavailable. Please try again shortly.');
        throw error;
      }
      res.status(202).json({ status: 'QUEUED', jobId });
    },
  );
  app.get('/api/lessons/:lessonId/playback', auth, async (req, res) => {
    const lesson = await db.get('lesson', req.params.lessonId);
    if (!lesson) fail(404, 'Lesson not found');
    await canAccess(db, req.user, lesson.courseId);
    if (lesson.videoStatus !== 'READY')
      return res.json({
        url: lesson.videoStatus === 'EMPTY' ? lesson.sampleVideo || null : null,
        status:
          lesson.videoStatus === 'EMPTY' && lesson.sampleVideo ? 'SAMPLE' : lesson.videoStatus,
      });
    const { version } = mediaLocation(lesson);
    res.set('Cache-Control', 'private, no-store');
    if (delivery().enabled) return res.json(delivery().playback(lesson, res));
    res.json({
      url: '/api/media/' + lesson.id + '/' + (version ? version + '/' : '') + 'index.m3u8',
      status: 'READY',
    });
  });
  app.get('/api/lessons/:lessonId/hls/:version/index.m3u8', auth, async (req, res) => {
    const lesson = await db.get('lesson', req.params.lessonId);
    if (!lesson) fail(404, 'Lesson not found');
    await canAccess(db, req.user, lesson.courseId);
    if (lesson.videoStatus !== 'READY' || mediaLocation(lesson).version !== req.params.version)
      fail(404, 'Video version is not available');
    const cdn = delivery();
    if (!cdn.enabled || cdn.mode !== 'urls') fail(404, 'Cloud playlist is not available');
    res.set('Cache-Control', 'private, no-store');
    res.type('application/vnd.apple.mpegurl').send(await cdn.playlist(lesson));
  });
  app.get(
    ['/api/media/:lessonId/:version/:asset', '/api/media/:lessonId/:asset'],
    auth,
    async (req, res) => {
      const lesson = await db.get('lesson', req.params.lessonId);
      if (!lesson) fail(404, 'Lesson not found');
      await canAccess(db, req.user, lesson.courseId);
      if (lesson.videoStatus !== 'READY') fail(404, 'Video is not ready');
      const { directory, version } = mediaLocation(lesson);
      if (
        (req.params.version || null) !== version ||
        !/^(index\.m3u8|segment\d+\.ts)$/.test(req.params.asset)
      )
        fail(404, 'Media asset not found');
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.type(req.params.asset.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
      res.sendFile(withinUploads(uploads, directory + '/' + req.params.asset));
    },
  );
  return app;
}
