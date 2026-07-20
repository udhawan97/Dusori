import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/pages');
const siteBuild = resolve(root, 'apps/site/dist');
const appBuild = resolve(root, 'apps/app/build');

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'app'), { recursive: true });
await cp(siteBuild, output, { recursive: true });
await cp(appBuild, resolve(output, 'app'), { recursive: true });
await writeFile(resolve(output, '.nojekyll'), '');

const fallback = resolve(output, '404.html');
await cp(resolve(output, 'index.html'), fallback);
