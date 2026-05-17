import { describe, it, expect } from 'vitest';
import {
  formatEntityCode,
  parseSequenceFromCode,
} from '../code-sequence.service';

describe('code-sequence.service', () => {
  it('formats standard codes with 6-digit padding', () => {
    expect(formatEntityCode('CUS', 2026, 1)).toBe('CUS-2026-000001');
    expect(formatEntityCode('INV', 2026, 42)).toBe('INV-2026-000042');
  });

  it('parses standard and legacy purchase prefixes', () => {
    expect(parseSequenceFromCode('PINV-2026-000010', ['PINV', 'PI'], 2026)).toBe(10);
    expect(parseSequenceFromCode('PI-2026-000005', ['PINV', 'PI'], 2026)).toBe(5);
    expect(parseSequenceFromCode('PO-2026-0001', ['PO'], 2026)).toBe(1);
  });

  it('parses legacy journal format', () => {
    expect(parseSequenceFromCode('JE2026000123', ['JE'], 2026)).toBe(123);
  });
});
