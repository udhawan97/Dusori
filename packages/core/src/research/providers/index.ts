import { msLearnProvider } from './mslearn.js';
import { wikipediaProvider } from './wikipedia.js';

export * from './mslearn.js';
export * from './wikipedia.js';

export const researchProviders = [msLearnProvider, wikipediaProvider] as const;
