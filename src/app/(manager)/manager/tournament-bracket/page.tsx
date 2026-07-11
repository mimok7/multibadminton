import { Suspense } from 'react';
import TournamentBracketView from '@/components/tournament/TournamentBracketView';

export default function AdminTournamentBracketPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <TournamentBracketView adminMode homeHref="/manager" />
    </Suspense>
  );
}
