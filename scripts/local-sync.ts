import { runSync } from '../src/lib/sync';
process.env.LOCAL_BLOBS_DIR ??= '.data';
const r = await runSync({ force: process.argv.includes('--force') });
console.log(r);
