import path from 'node:path';
const safeId = /^[a-zA-Z0-9_-]+$/;
const versionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function videoManifest(lessonId, version) {
  if (!safeId.test(lessonId) || !versionPattern.test(version))
    throw new Error('Invalid media identity');
  return 'media/' + lessonId + '/' + version + '/index.m3u8';
}
export function mediaLocation(lesson) {
  if (!lesson.videoPath || !safeId.test(lesson.id)) throw new Error('Invalid media path');
  const parts = lesson.videoPath.split('/');
  if (
    parts[0] !== 'media' ||
    parts[1] !== lesson.id ||
    parts.at(-1) !== 'index.m3u8' ||
    ![3, 4].includes(parts.length) ||
    (parts.length === 4 && !versionPattern.test(parts[2]))
  )
    throw new Error('Invalid media path');
  return { directory: parts.slice(0, -1).join('/'), version: parts.length === 4 ? parts[2] : null };
}
export function withinUploads(uploads, relative) {
  const directory = path.resolve(uploads);
  const target = path.resolve(directory, relative);
  if (!target.startsWith(directory + path.sep)) throw new Error('Media path is outside uploads');
  return target;
}
