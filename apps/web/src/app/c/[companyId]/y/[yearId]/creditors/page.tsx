'use client';

import { use } from 'react';

import { SubledgerPage } from '@/components/subledger-page';

export default function CreditorsPage({
  params,
}: {
  params: Promise<{ companyId: string; yearId: string }>;
}) {
  const { companyId, yearId } = use(params);
  return <SubledgerPage companyId={companyId} yearId={yearId} type="CREDITOR" />;
}
