'use client';

import { ProductForm } from '@/components/products/ProductForm';

export default function NewRawMaterialPage() {
  return (
    <ProductForm
      mode="create"
      lockedType="raw_material"
      backHref="/inventory/raw-materials"
      listHref="/inventory/raw-materials"
    />
  );
}
