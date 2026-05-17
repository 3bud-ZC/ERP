import { describe, it, expect } from 'vitest';
import {
  buildRawMaterialConsumptionLines,
  buildManufacturingLaborLines,
  buildProductionCompletionLines,
} from '@/lib/services/production-accounting.service';
import type { PostingProfile } from '@/lib/services/accounting-posting-profile.service';

const profile: PostingProfile = {
  cash: '1001',
  ar: '1020',
  ap: '2010',
  inventory: '1030',
  revenue: '4010',
  cogs: '5010',
  taxPayable: '2030',
  taxInput: '2030',
  adjustment: '5070',
  wip: '6001',
  laborExpense: '5020',
  overheadExpense: '5060',
};

describe('Phase 6A — production journal builders', () => {
  it('balances raw material consumption entry', () => {
    const lines = buildRawMaterialConsumptionLines(500, 't1', profile);
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBe(500);
    expect(credit).toBe(500);
    expect(lines.find(l => l.accountCode === '6001')?.debit).toBe(500);
  });

  it('balances labor entry', () => {
    const lines = buildManufacturingLaborLines(100, 't1', profile);
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(100);
    expect(lines.reduce((s, l) => s + l.credit, 0)).toBe(100);
  });

  it('balances completion entry', () => {
    const lines = buildProductionCompletionLines(600, 't1', profile);
    expect(lines.find(l => l.accountCode === '1030')?.debit).toBe(600);
    expect(lines.find(l => l.accountCode === '6001')?.credit).toBe(600);
  });
});
