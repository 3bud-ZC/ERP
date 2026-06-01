'use client';

import { Field } from '@/components/ui/modal';

/** Read-only code display — codes are generated on the server only. */
export function AutoCodeField({
  label = 'الرمز',
  mode,
  value,
}: {
  label?: string;
  mode: 'create' | 'edit';
  value?: string;
}) {
  if (mode === 'create') {
    return (
      <Field
        label={label}
        value=""
        readOnly
        disabled
        placeholder="يُولَّد تلقائياً عند الحفظ (مثال: CUS-2026-00001)"
        onChange={() => {}}
      />
    );
  }

  return (
    <Field
      label={label}
      value={value ?? ''}
      readOnly
      disabled
      placeholder="—"
      onChange={() => {}}
    />
  );
}
