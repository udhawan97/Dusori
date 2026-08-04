import { describe, expect, it } from 'vitest';

import { createLatestRequestGate } from './latest-request';

describe('createLatestRequestGate', () => {
  it('rejects a slower completion after a newer request has begun', async () => {
    const gate = createLatestRequestGate();
    const applied: string[] = [];
    let finishSlow!: (value: string) => void;
    let finishFast!: (value: string) => void;
    const slowValue = new Promise<string>((resolve) => (finishSlow = resolve));
    const fastValue = new Promise<string>((resolve) => (finishFast = resolve));

    const apply = async (request: number, value: Promise<string>): Promise<void> => {
      const resolved = await value;
      if (gate.isCurrent(request)) applied.push(resolved);
    };
    const slow = apply(gate.begin(), slowValue);
    const fast = apply(gate.begin(), fastValue);

    finishFast('new');
    await fast;
    finishSlow('old');
    await slow;

    expect(applied).toEqual(['new']);
  });
});
