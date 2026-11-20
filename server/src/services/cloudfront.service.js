import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPrivateKey } from 'node:crypto';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl, getSignedCookies } from '@aws-sdk/cloudfront-signer';
import { fail } from './learning.service.js';
import { mediaLocation } from './media-paths.js';

const maxPlaylistBytes = 256 * 1024;
export function createMediaDelivery({
  env = process.env,
  root = process.cwd(),
  s3,
  now = Date.now,
} = {}) {
  if (!env.CLOUDFRONT_URL) return { enabled: false };
  const required = ['S3_BUCKET', 'AWS_REGION', 'CLOUDFRONT_KEY_PAIR_ID'];
  for (const name of required)
    if (!env[name]) fail(503, name + ' is required for CloudFront delivery');
  let base;
  try {
    base = new URL(env.CLOUDFRONT_URL);
  } catch {
    fail(503, 'CLOUDFRONT_URL must be an HTTPS origin');
  }
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/'
  )
    fail(503, 'CLOUDFRONT_URL must be an HTTPS origin without a path or query');
  const mode = env.CLOUDFRONT_AUTH_MODE || 'urls';
  if (!['urls', 'cookies'].includes(mode))
    fail(503, 'CLOUDFRONT_AUTH_MODE must be urls or cookies');
  const ttl = Number(env.CLOUDFRONT_URL_TTL || 900);
  if (!Number.isInteger(ttl) || ttl < 120 || ttl > 3600)
    fail(503, 'CLOUDFRONT_URL_TTL must be 120–3600 seconds');
  let privateKey;
  try {
    const pem =
      env.CLOUDFRONT_PRIVATE_KEY?.replace(/\\n/g, '\n') ||
      readFileSync(path.resolve(root, env.CLOUDFRONT_PRIVATE_KEY_FILE || ''), 'utf8');
    privateKey = createPrivateKey(pem);
    if (
      privateKey.asymmetricKeyType !== 'rsa' ||
      privateKey.asymmetricKeyDetails?.modulusLength !== 2048
    )
      throw new Error('RSA 2048 required');
  } catch {
    fail(503, 'Configure a valid RSA-2048 CloudFront private key or private-key file');
  }
  const signingKey = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const credentials = {
    keyPairId: env.CLOUDFRONT_KEY_PAIR_ID,
    privateKey: signingKey,
    algorithm: 'SHA256',
  };
  const client = s3 || new S3Client({ region: env.AWS_REGION });
  let cookieDomain;
  if (mode === 'cookies') {
    cookieDomain = env.CDN_COOKIE_DOMAIN?.replace(/^\./, '').toLowerCase();
    let app;
    try {
      app = new URL(env.APP_URL);
    } catch {
      fail(503, 'A valid APP_URL is required for signed cookies');
    }
    const matches = (host) => host === cookieDomain || host.endsWith('.' + cookieDomain);
    if (
      !cookieDomain ||
      !cookieDomain.includes('.') ||
      app.protocol !== 'https:' ||
      !matches(app.hostname) ||
      !matches(base.hostname)
    )
      fail(
        503,
        'Signed cookies need HTTPS app/CDN hosts under the same cookie domain; use urls mode without a domain',
      );
  }
  const assetUrl = (lesson, asset) => {
    const { directory } = mediaLocation(lesson);
    if (!/^(index\.m3u8|segment\d+\.ts)$/.test(asset)) fail(503, 'Unsupported streaming asset');
    return base.origin + '/' + directory + '/' + asset;
  };
  const expires = () => Math.floor(now() / 1000) + ttl;
  const sign = (lesson, asset, until) =>
    getSignedUrl({
      ...credentials,
      url: assetUrl(lesson, asset),
      dateLessThan: new Date(until * 1000),
    });
  async function manifest(lesson) {
    let object;
    try {
      object = await client.send(
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: lesson.videoPath }),
      );
    } catch {
      fail(
        503,
        'Cloud video is not available yet. The current lesson version must be uploaded to S3.',
      );
    }
    if (object.ContentLength > maxPlaylistBytes) fail(503, 'Streaming playlist is too large');
    let content;
    try {
      content = await object.Body.transformToString('utf-8');
      if (Buffer.byteLength(content) > maxPlaylistBytes) throw new Error('Too large');
    } catch {
      fail(503, 'Streaming playlist could not be read');
    }
    return content;
  }
  return {
    enabled: true,
    mode,
    bucket: env.S3_BUCKET,
    region: env.AWS_REGION,
    playback(lesson, res) {
      const until = expires();
      if (mode === 'cookies') {
        const { directory } = mediaLocation(lesson);
        const policy = JSON.stringify({
          Statement: [
            {
              Resource: base.origin + '/' + directory + '/*',
              Condition: { DateLessThan: { 'AWS:EpochTime': until } },
            },
          ],
        });
        const cookies = getSignedCookies({ ...credentials, policy });
        for (const [name, value] of Object.entries(cookies))
          res.cookie(name, value, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            domain: cookieDomain,
            path: '/' + directory + '/',
            maxAge: ttl * 1000,
          });
        return {
          url: assetUrl(lesson, 'index.m3u8'),
          status: 'READY',
          credentials: 'include',
          expiresAt: new Date(until * 1000).toISOString(),
          delivery: 'cloudfront',
        };
      }
      const { version } = mediaLocation(lesson);
      if (!version) fail(503, 'Versioned video output is required for CloudFront URL delivery');
      return {
        url: '/api/lessons/' + lesson.id + '/hls/' + version + '/index.m3u8?renew=' + until,
        status: 'READY',
        credentials: 'omit',
        expiresAt: new Date(until * 1000).toISOString(),
        delivery: 'cloudfront',
      };
    },
    async playlist(lesson) {
      const content = await manifest(lesson),
        until = expires();
      if (!content.startsWith('#EXTM3U') || !content.includes('#EXT-X-ENDLIST'))
        fail(503, 'Streaming playlist is invalid');
      let segments = 0;
      const lines = content.split(/\r?\n/).map((line) => {
        if (!line.trim()) return '';
        if (line.startsWith('#')) {
          if (/\bURI\s*=/i.test(line)) fail(503, 'Unsupported streaming playlist reference');
          return line;
        }
        if (!/^segment\d+\.ts$/.test(line)) fail(503, 'Unsupported streaming playlist reference');
        segments++;
        return sign(lesson, line, until);
      });
      if (!segments) fail(503, 'Streaming playlist contains no segments');
      return lines.join('\n');
    },
  };
}
