import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
const root = fileURLToPath(new URL('../../../', import.meta.url));
dotenv.config({ path: path.join(root, '.env'), quiet: true });
export const config = {
  root,
  demo:
    process.env.DEMO_MODE === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE !== 'false'),
  port: Number(process.env.PORT || 4000),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  secret: process.env.JWT_SECRET || randomBytes(48).toString('hex'),
  uploads: path.resolve(root, process.env.UPLOAD_DIR || 'uploads'),
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  videoQueuePrefix: process.env.VIDEO_QUEUE_PREFIX || 'bull',
  production: process.env.NODE_ENV === 'production',
};
if (!config.demo && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32))
  throw new Error('Set JWT_SECRET to at least 32 characters.');
if (process.env.RAZORPAY_KEY_ID && !/^rzp_test_[A-Za-z0-9]+$/.test(process.env.RAZORPAY_KEY_ID))
  throw new Error('ClassOrbit accepts Razorpay test keys only.');
