import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, readFile, unlink, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { UnrecoverableError } from 'bullmq';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/index.js';
import { videoManifest, withinUploads } from '../services/media-paths.js';
const execute = promisify(execFile);
export function createVideoProcessor(
  db,
  {
    uploads = config.uploads,
    ffmpeg = config.ffmpeg,
    s3 = null,
    bucket = process.env.S3_BUCKET,
    exec = execute,
  } = {},
) {
  return async (job) => {
    const { lessonId, filename } = job.data;
    if (!/^[0-9a-f]{32}$/.test(filename || ''))
      throw new UnrecoverableError('Invalid upload filename');
    const manifest = videoManifest(lessonId, job.id);
    const input = withinUploads(uploads, 'raw/' + filename);
    const output = withinUploads(uploads, path.posix.dirname(manifest));
    const lesson = await db.get('lesson', lessonId);
    if (!lesson || lesson.videoPath !== manifest) {
      await unlink(input).catch(() => {});
      throw new UnrecoverableError('Video upload was superseded or its lesson was removed');
    }
    if (
      lesson.videoStatus === 'READY' &&
      (await access(path.join(output, 'index.m3u8')).then(
        () => true,
        () => false,
      ))
    ) {
      await unlink(input).catch(() => {});
      return { manifest };
    }
    const update = async (data) =>
      db.atomic(async (tx) => {
        const current = await tx.get('lesson', lessonId);
        if (!current || current.videoPath !== manifest)
          throw new UnrecoverableError('Video upload was superseded');
        return tx.patch('lesson', lessonId, data);
      });
    await update({ videoStatus: 'PROCESSING' });
    try {
      await mkdir(output, { recursive: true });
      await exec(
        ffmpeg,
        [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-format_whitelist',
          'mov,matroska,webm',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          input,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-vf',
          "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '23',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-force_key_frames',
          'expr:gte(t,n_forced*6)',
          '-hls_time',
          '6',
          '-hls_playlist_type',
          'vod',
          '-hls_flags',
          'independent_segments+temp_file',
          '-hls_segment_filename',
          path.join(output, 'segment%04d.ts'),
          path.join(output, 'index.m3u8'),
        ],
        { timeout: 1800000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      );
      const files = (await readdir(output)).filter((file) =>
        /^(index\.m3u8|segment\d+\.ts)$/.test(file),
      );
      if (!files.includes('index.m3u8') || !files.some((file) => file.endsWith('.ts')))
        throw new Error('No HLS video output was produced');
      if (s3) {
        files.sort((a, b) => Number(a.endsWith('.m3u8')) - Number(b.endsWith('.m3u8')));
        for (const file of files)
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: path.posix.dirname(manifest) + '/' + file,
              Body: await readFile(path.join(output, file)),
              ContentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
              CacheControl: file.endsWith('.m3u8')
                ? 'public, max-age=0, s-maxage=86400'
                : 'public, max-age=60, s-maxage=31536000, immutable',
            }),
          );
      }
      await update({ videoStatus: 'READY' });
      await unlink(input).catch(() => {});
      return { manifest };
    } catch (error) {
      const retrying =
        !(error instanceof UnrecoverableError) && job.attemptsMade + 1 < (job.opts.attempts || 1);
      const current = await db.get('lesson', lessonId);
      if (current?.videoPath === manifest)
        await update({ videoStatus: retrying ? 'QUEUED' : 'FAILED' });
      throw error;
    }
  };
}

export async function cleanFailedVideo(job, { uploads = config.uploads } = {}) {
  if (
    !job ||
    (job.attemptsMade < (job.opts.attempts || 1) &&
      !(job.failedReason || '').includes('superseded'))
  )
    return;
  const { lessonId, filename } = job.data;
  if (!/^[0-9a-f]{32}$/.test(filename || '')) return;
  const output = withinUploads(uploads, path.posix.dirname(videoManifest(lessonId, job.id)));
  await unlink(withinUploads(uploads, 'raw/' + filename)).catch(() => {});
  await rm(output, { recursive: true, force: true });
}
