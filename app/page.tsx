'use client';

import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { IntakeScreen } from '@/components/IntakeScreen';
import { RecommendationScreen } from '@/components/RecommendationScreen';
import { ChallengeScreen } from '@/components/ChallengeScreen';
import { DealOnAPage } from '@/components/DealOnAPage';
import { useStore } from '@/lib/store';

export default function Page() {
  const step = useStore((s) => s.step);

  // The store rehydrates from localStorage, so the first client render can differ
  // from the server's. Wait one tick rather than ship a hydration mismatch.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  return (
    <Shell>
      {!ready ? (
        <div className="py-24 text-center text-[0.8125rem] text-faint">Loading pricing book…</div>
      ) : step === 'intake' ? (
        <IntakeScreen />
      ) : step === 'recommendation' ? (
        <RecommendationScreen />
      ) : step === 'challenge' ? (
        <ChallengeScreen />
      ) : (
        <DealOnAPage />
      )}
    </Shell>
  );
}
