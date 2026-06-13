'use client';

import { useParams } from 'next/navigation';
import { PartyDebtDetailsPage } from '@/components/parties/PartyDebtDetailsPage';

export default function CustomerDetailsPage() {
  const { id } = useParams<{ id: string }>();
  return <PartyDebtDetailsPage partyType="customer" partyId={id} />;
}
