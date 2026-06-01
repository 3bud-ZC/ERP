'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiGet, apiGetList } from '@/lib/api/fetcher';
import { asArray } from '@/lib/api/safe-array';
import { ProductForm, type ProductExisting } from '@/components/products/ProductForm';
import { ErrorBanner } from '@/components/ui/patterns';
import type { ProductInventoryKind } from '@/components/inventory/ProductInventoryPage';

const BASE: Record<ProductInventoryKind, string> = {
  raw_material: '/inventory/raw-materials',
  finished_product: '/inventory/finished-products',
};

export function EditProductInventoryPage({ kind }: { kind: ProductInventoryKind }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ProductExisting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const basePath = BASE[kind];

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiGetList<ProductExisting>(`/api/products?type=${kind}`)
      .then(list => {
        if (!active) return;
        const found = asArray<ProductExisting>(list).find((p) => p.id === id);
        if (found) setData(found);
        else setError('الصنف غير موجود');
      })
      .catch((e: Error) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id, kind]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64 text-slate-500" dir="rtl">
        جاري التحميل…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6" dir="rtl">
        <ErrorBanner message={error} onRetry={() => router.refresh()} />
      </div>
    );
  }
  if (!data) return null;

  return (
    <ProductForm
      mode="edit"
      existing={data}
      lockedType={kind}
      backHref={basePath}
      listHref={basePath}
    />
  );
}
