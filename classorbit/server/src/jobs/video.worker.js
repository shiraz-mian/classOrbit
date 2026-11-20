import { Worker } from 'bullmq';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { S3Client } from '@aws-sdk/client-s3';
import { createDatabase } from '../repositories/database.js';
import { createWorkerConnection, videoQueueName } from './queue.js';
import { createVideoProcessor, cleanFailedVideo } from './video.processor.js';
import { config } from '../config/index.js';
if (config.demo) throw new Error('Run the worker with DEMO_MODE=false and configure PostgreSQL.');
await promisify(execFile)(config.ffmpeg, ['-version'], { windowsHide: true });
const db = await createDatabase({ demo: false });
await db.get('lesson', '__worker_startup_check__');
const connection = createWorkerConnection();
const s3 = process.env.S3_BUCKET
  ? new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
  : null;
const worker = new Worker(videoQueueName, createVideoProcessor(db, { s3 }), {
  connection,
  prefix: config.videoQueuePrefix,
  concurrency: 1,
  lockDuration: 60000,
});
const pendingCleanup = new Set();
worker.on('error', (error) => console.error('Video worker error:', error.message));
worker.on('completed', (job) => console.log('Video ready:', job.data.lessonId));
worker.on('failed', (job) => {
  console.error('Video conversion attempt failed:', job?.id, 'attempts:', job?.attemptsMade);
  if (!job || job.attemptsMade < (job.opts.attempts || 1)) return;
  const cleanup = cleanFailedVideo(job)
    .catch(() => console.error('Failed video cleanup needs attention:', job.id))
    .finally(() => pendingCleanup.delete(cleanup));
  pendingCleanup.add(cleanup);
});
await worker.waitUntilReady();
console.log('ClassOrbit video worker ready (Redis + PostgreSQL + FFmpeg).');
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await worker.close();
  await Promise.allSettled([...pendingCleanup]);
  connection.disconnect();
  await db.close();
};
process.on('SIGINT', () => stop().catch(() => process.exit(1)));
process.on('SIGTERM', () => stop().catch(() => process.exit(1)));
