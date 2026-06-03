export const MANUAL_PAYMENT_CATEGORIES = [
  { value: 'production_cost', label: 'تكلفة إنتاج' },
  { value: 'wages', label: 'دفع عمالة / رواتب' },
  { value: 'expense', label: 'مصروف تشغيلي' },
  { value: 'contractor', label: 'سداد طرف خارجي' },
  { value: 'other', label: 'سبب آخر' },
] as const;

export const MANUAL_CATEGORY_LABEL: Record<string, string> = MANUAL_PAYMENT_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.value]: c.label }),
  {} as Record<string, string>,
);
