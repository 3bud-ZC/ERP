export const MANUAL_PAYMENT_CATEGORIES = [
  { value: 'rent', label: 'إيجار' },
  { value: 'electricity', label: 'شحن كهرباء' },
  { value: 'production_cost', label: 'تكلفة إنتاج' },
  { value: 'wages', label: 'دفع عمالة / رواتب' },
  { value: 'maintenance', label: 'مصاريف صيانة' },
  { value: 'colors_grease', label: 'مصاريف ألوان وشحوم' },
  { value: 'papers_solitaire', label: 'مصاريف أوراق وسوليتب' },
  { value: 'expense', label: 'مصروف تشغيلي' },
  { value: 'contractor', label: 'سداد طرف خارجي' },
  { value: 'other', label: 'سبب آخر' },
] as const;

export const MANUAL_CATEGORY_EXPENSE_ACCOUNT: Record<string, string> = {
  rent: '5030',
  electricity: '5040',
  production_cost: '5060',
  wages: '5020',
  maintenance: '5060',
  colors_grease: '5060',
  papers_solitaire: '5060',
  expense: '5060',
  contractor: '5060',
  other: '5060',
};

export const MANUAL_CATEGORY_LABEL: Record<string, string> = MANUAL_PAYMENT_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.value]: c.label }),
  {} as Record<string, string>,
);
