import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createDatabase } from '../server/src/repositories/database.js';
import { config } from '../server/src/config/index.js';
import { mediaLocation, withinUploads } from '../server/src/services/media-paths.js';
import { awsContext } from './lib/aws-context.mjs';
const args = process.argv.slice(2),
  value = (flag) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--apply') continue;
  if (!['--lesson', '--bucket', '--credentials-env', '--region'].includes(args[i]) || !args[++i])
    throw new Error(
      'Use --apply, --lesson <id>, --bucket <name>, --credentials-env <file>, --region <region>.',
    );
}
if (config.demo) throw new Error('Use PostgreSQL mode for CDN publishing.');
const bucket = value('--bucket') || process.env.S3_BUCKET;
if (!bucket) throw new Error('Set S3_BUCKET or pass --bucket from the ClassOrbit stack outputs.');
const apply = args.includes('--apply'),
  db = await createDatabase({ demo: false });
try {
  const lessons = (await db.all('lesson')).filter(
    (l) => l.videoStatus === 'READY' && (!value('--lesson') || l.id === value('--lesson')),
  );
  if (!lessons.length) throw new Error('No matching READY lessons.');
  const plans = [];
  for (const lesson of lessons) {
    const { directory, version } = mediaLocation(lesson);
    if (!version)
      throw new Error('Re-upload legacy unversioned video before CDN publishing: ' + lesson.id);
    const folder = withinUploads(config.uploads, directory);
    const files = (await readdir(folder)).filter((f) => /^(index\.m3u8|segment\d+\.ts)$/.test(f));
    if (!files.includes('index.m3u8')) throw new Error('Local playlist missing: ' + lesson.id);
    const playlist = await readFile(path.join(folder, 'index.m3u8'), 'utf8');
    const segments = playlist.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    if (
      !playlist.startsWith('#EXTM3U') ||
      !playlist.includes('#EXT-X-ENDLIST') ||
      !segments.length ||
      segments.some((s) => !/^segment\d+\.ts$/.test(s) || !files.includes(s))
    )
      throw new Error('Local HLS output is incomplete: ' + lesson.id);
    const selected = [...new Set(segments), 'index.m3u8'];
    for (const file of selected)
      if (!(await lstat(path.join(folder, file))).isFile())
        throw new Error('Only regular HLS files may be published.');
    plans.push({ lessonId: lesson.id, directory, folder, files: selected });
  }
  console.log(
    JSON.stringify({
      apply,
      bucket,
      lessons: plans.map((p) => ({ lessonId: p.lessonId, objects: p.files.length })),
      deletes: false,
    }),
  );
  if (!apply) {
    console.log('Preview only. Add --apply to upload these files, with each playlist last.');
  } else {
    const s3 = new S3Client(await awsContext(args));
    for (const plan of plans) {
      for (const file of plan.files)
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: plan.directory + '/' + file,
            Body: await readFile(path.join(plan.folder, file)),
            ContentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
            CacheControl: file.endsWith('.m3u8')
              ? 'public, max-age=0, s-maxage=86400'
              : 'public, max-age=60, s-maxage=31536000, immutable',
          }),
        );
      console.log('Published ' + plan.lessonId);
    }
  }
} finally {
  await db.close();
}
