import { readFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { config } from '../../server/src/config/index.js';
export async function awsContext(args = process.argv.slice(2)) {
  const value = (flag) => {
    const at = args.indexOf(flag);
    return at < 0 ? undefined : args[at + 1];
  };
  const file = value('--credentials-env');
  const source = file
    ? dotenv.parse(await readFile(path.resolve(config.root, file), 'utf8'))
    : process.env;
  const region =
    value('--region') || (file ? source.AWS_REGION : process.env.AWS_REGION) || 'us-east-1';
  if (Boolean(source.AWS_ACCESS_KEY_ID) !== Boolean(source.AWS_SECRET_ACCESS_KEY))
    throw new Error('Both AWS access key fields are required.');
  return {
    region,
    ...(source.AWS_ACCESS_KEY_ID
      ? {
          credentials: {
            accessKeyId: source.AWS_ACCESS_KEY_ID,
            secretAccessKey: source.AWS_SECRET_ACCESS_KEY,
            ...(source.AWS_SESSION_TOKEN ? { sessionToken: source.AWS_SESSION_TOKEN } : {}),
          },
        }
      : {}),
  };
}
