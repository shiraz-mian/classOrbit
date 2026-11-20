import { spawn } from 'node:child_process';
const api = spawn(process.execPath, ['--watch', 'server/src/index.js'], {
  stdio: 'inherit',
  env: process.env,
});
const web = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    '--config',
    'client/vite.config.js',
    '--host',
    '0.0.0.0',
    'client',
  ],
  { stdio: 'inherit', env: process.env },
);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  api.kill();
  web.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', stop);
web.on('exit', stop);
