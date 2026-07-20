import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { appBasePath } from '../../../config/site.mjs';

const packageRoot = resolve(import.meta.dirname, '..');
const source = resolve(packageRoot, '../../apps/app/build');
const destination = resolve(packageRoot, `public${appBasePath}`);

await rm(resolve(packageRoot, 'public'), { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
