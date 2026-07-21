import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const tokenSource = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function token(name: string, mode: 'light' | 'dark'): [number, number, number] {
  const match = tokenSource.match(
    new RegExp(`--${name}-${mode}:\\s*oklch\\(([0-9.]+)%\\s+([0-9.]+)\\s+([0-9.]+)\\)`, 'u'),
  );
  if (!match) throw new Error(`Missing ${mode} OKLCH token: ${name}`);
  return [Number(match[1]) / 100, Number(match[2]), Number(match[3])];
}

function linearSrgb([lightness, chroma, hue]: [number, number, number]): [number, number, number] {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  return [
    Math.min(1, Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    Math.min(1, Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    Math.min(1, Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

function luminance(color: [number, number, number]): number {
  const [red, green, blue] = linearSrgb(color);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: [number, number, number], second: [number, number, number]): number {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('quiet editorial utility tokens', () => {
  const expectations: Array<[string, number]> = [
    ['ink', 7],
    ['muted', 4.5],
    ['accent-text', 4.5],
    ['focus', 3],
    ['border', 3],
    ['accent', 3],
  ];

  for (const mode of ['light', 'dark'] as const) {
    const paper = token('paper', mode);
    for (const [name, minimum] of expectations) {
      it(`${mode} ${name} has at least ${minimum}:1 contrast on paper`, () => {
        expect(contrast(token(name, mode), paper)).toBeGreaterThanOrEqual(minimum);
      });
    }
  }
});
