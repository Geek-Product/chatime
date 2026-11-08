import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const envPath = path.resolve(import.meta.dirname, '../../.env');
let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

if (/^VAPID_PUBLIC_KEY=./m.test(env)) {
  console.log('VAPID keys already present in .env');
  process.exit(0);
}

const keys = webpush.generateVAPIDKeys();
const setVar = (name: string, value: string) => {
  const line = `${name}=${value}`;
  env = new RegExp(`^${name}=.*$`, 'm').test(env)
    ? env.replace(new RegExp(`^${name}=.*$`, 'm'), line)
    : `${env.replace(/\n?$/, '\n')}${line}\n`;
};
setVar('VAPID_PUBLIC_KEY', keys.publicKey);
setVar('VAPID_PRIVATE_KEY', keys.privateKey);
writeFileSync(envPath, env);
console.log('Wrote VAPID keys to .env');
