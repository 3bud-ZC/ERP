'use client';

import { useParams } from 'next/navigation';
import { PartyDebtDetailsPage } from '@/components/parties/PartyDebtDetailsPage';

export default function SupplierDetailsPage() {
  const { id } = useParams<{ id: string }>();
  return <PartyDebtDetailsPage partyType="supplier" partyId={id} />;
}
