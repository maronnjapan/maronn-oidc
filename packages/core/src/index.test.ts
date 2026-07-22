import { describe, it, expect } from 'vitest';
import { version } from './index.js';

describe('Core Package', () => {
  it('should export version', () => {
    expect(version).toEqual('0.0.1');
  });
});
