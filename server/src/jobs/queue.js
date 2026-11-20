import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';
export const videoQueueName = 'classorbit-video';
export function createWorkerConnection() {
  const connection = new IORedis(config.redis, {
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
  });
  let reported = false;
  connection.on('error', () => {
    if (!reported) console.error('Video worker: Redis unavailable; reconnecting.');
    reported = true;
  });
  connection.on('ready', () => {
    reported = false;
  });
  return connection;
}
export function createVideoQueue({ redis = config.redis, prefix = config.videoQueuePrefix } = {}) {
  const connection = new IORedis(redis, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    commandTimeout: 5000,
  });
  connection.on('error', () => {});
  const queue = new Queue(videoQueueName, { connection, prefix });
  queue.on('error', () => {});
  return {
    queue,
    connection,
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
}
let producer;
export async function getVideoQueue() {
  producer ||= createVideoQueue();
  let timer;
  try {
    await Promise.race([
      producer.queue.waitUntilReady(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Queue unavailable')), 3500);
      }),
    ]);
    await producer.connection.ping();
    return producer.queue;
  } catch {
    const error = new Error('Video uploads are temporarily unavailable. Please try again shortly.');
    error.status = 503;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export async function closeVideoQueue() {
  if (producer) {
    await producer.close();
    producer = null;
  }
}
