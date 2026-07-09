import { NextResponse } from 'next/server';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getKoreaDate } from '@/lib/date';
import { isAdminOrManagerRole } from '@/lib/auth';

function addMinutesToTimeString(time: string | null | undefined, minutesToAdd: number) {
  if (!time) return null;
  const [hourRaw, minuteRaw] = time.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  const totalMinutes = hour * 60 + minute + minutesToAdd;
  const normalizedMinutes = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const nextHour = Math.floor(normalizedMinutes / 60);
  const nextMinute = normalizedMinutes % 60;
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}:00`;
}

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseServerClient();
    const adminSupabase = await getFilteredAdminClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!isAdminOrManagerRole((profile as any)?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const targetDate = body.date || getKoreaDate();

    // 1. Fetch today's scheduled matches
    const { data: schedules, error: schedulesError } = await adminSupabase
      .from('match_schedules')
      .select('id, generated_match_id, court_number, description, scheduled_time, start_time')
      .eq('match_date', targetDate)
      .eq('status', 'scheduled');

    if (schedulesError) throw schedulesError;
    if (!schedules || schedules.length === 0) {
      return NextResponse.json({ message: 'No matches to optimize' });
    }

    // 2. Fetch corresponding generated_matches to get players
    const generatedMatchIds = schedules
      .map((s) => s.generated_match_id)
      .filter((id): id is number => typeof id === 'number');

    const { data: generatedMatches, error: generatedError } = await adminSupabase
      .from('generated_matches')
      .select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id')
      .in('id', generatedMatchIds);

    if (generatedError) throw generatedError;

    const matchMap = new Map<number, { id: number; team1_player1_id: string | null; team1_player2_id: string | null; team2_player1_id: string | null; team2_player2_id: string | null; }>();
    generatedMatches?.forEach((gm) => matchMap.set(gm.id, gm));

    // 3. Fetch today's attendances
    const { data: attendances, error: attendanceError } = await adminSupabase
      .from('attendances')
      .select('user_id, status')
      .eq('attended_at', targetDate);

    if (attendanceError) throw attendanceError;

    const presentUserIds = new Set(
      (attendances || [])
        .filter((a) => a.status === 'present' || a.status === 'lesson')
        .map((a) => a.user_id)
    );

    // 4. Determine latecomers
    const schedulesWithLatecomers = schedules.map((schedule) => {
      const gm = schedule.generated_match_id ? matchMap.get(schedule.generated_match_id) : null;
      let hasLatecomer = false;

      if (gm) {
        const players = [
          gm.team1_player1_id,
          gm.team1_player2_id,
          gm.team2_player1_id,
          gm.team2_player2_id,
        ].filter((id): id is string => Boolean(id));

        hasLatecomer = players.some((playerId) => !presentUserIds.has(playerId));
      }

      return {
        ...schedule,
        hasLatecomer,
      };
    });

    const normalMatches = schedulesWithLatecomers.filter(m => !m.hasLatecomer);
    const latecomerMatches = schedulesWithLatecomers.filter(m => m.hasLatecomer);

    // 5. Slot-based Match Assigner (no court grouping, linear slots)
    const orderedMatches: Array<{ match: typeof schedulesWithLatecomers[0]; slotIdx: number }> = [];
    const playerLastSlot = new Map<string, number>();

    // Pre-populate playerLastSlot with completed and in_progress matches
    const { data: allTodaySchedules } = await adminSupabase
      .from('match_schedules')
      .select('id, generated_match_id, status, scheduled_time, start_time')
      .eq('match_date', targetDate)
      .order('scheduled_time', { ascending: true })
      .order('start_time', { ascending: true });

    const fixedMatches = (allTodaySchedules || []).filter(s => s.status === 'completed' || s.status === 'in_progress');
    const fixedGeneratedMatchIds = fixedMatches
      .map(s => s.generated_match_id)
      .filter((id): id is number => typeof id === 'number');

    if (fixedGeneratedMatchIds.length > 0) {
      const { data: fixedGeneratedMatches } = await adminSupabase
        .from('generated_matches')
        .select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id')
        .in('id', fixedGeneratedMatchIds);

      const fixedMatchMap = new Map<number, any>();
      fixedGeneratedMatches?.forEach(gm => fixedMatchMap.set(gm.id, gm));

      fixedMatches.forEach((match, idx) => {
         const slot = idx - fixedMatches.length; // -N to -1
         const gm = match.generated_match_id ? fixedMatchMap.get(match.generated_match_id) : null;
         if (gm) {
            const players = [
              gm.team1_player1_id, gm.team1_player2_id,
              gm.team2_player1_id, gm.team2_player2_id,
            ].filter(Boolean) as string[];
            players.forEach(p => playerLastSlot.set(p, slot));
         }
      });
    }

    let currentSlot = 0;

    const assignMatches = (matchesToAssign: typeof schedulesWithLatecomers) => {
       const unassigned = [...matchesToAssign];
       
       while (unassigned.length > 0) {
          let bestMatchIdx = -1;
          let bestScore = -Infinity;
          
          for (let i = 0; i < unassigned.length; i++) {
             const match = unassigned[i];
             let minDistance = 10000;
             let score = 0;
             
             const gm = match.generated_match_id ? matchMap.get(match.generated_match_id) : null;
             if (gm) {
                const players = [
                  gm.team1_player1_id, gm.team1_player2_id,
                  gm.team2_player1_id, gm.team2_player2_id,
                ].filter(Boolean) as string[];
                
                for (const p of players) {
                   const lastSlot = playerLastSlot.get(p);
                   if (lastSlot !== undefined) {
                      const distance = currentSlot - lastSlot;
                      if (distance < minDistance) {
                          minDistance = distance;
                      }
                      score += distance; // Prioritize those who rested longer overall
                   } else {
                      score += 1000; // Hasn't played yet
                   }
                }
             }
             
             // Maximize minDistance. If tied, use score (total rest sum).
             // 1000000 ensures minDistance is the absolute primary sort key.
             const combinedScore = minDistance * 1000000 + score;
             
             if (combinedScore > bestScore) {
                bestScore = combinedScore;
                bestMatchIdx = i;
             }
          }
          
          const selectedMatch = unassigned.splice(bestMatchIdx, 1)[0];
          orderedMatches.push({ match: selectedMatch, slotIdx: currentSlot });
          
          const gm = selectedMatch.generated_match_id ? matchMap.get(selectedMatch.generated_match_id) : null;
          if (gm) {
             const players = [
               gm.team1_player1_id, gm.team1_player2_id,
               gm.team2_player1_id, gm.team2_player2_id,
             ].filter(Boolean) as string[];
             players.forEach(p => playerLastSlot.set(p, currentSlot));
          }
          
          currentSlot++;
       }
    };

    assignMatches(normalMatches);
    assignMatches(latecomerMatches);

    const existingTimes = schedulesWithLatecomers
      .map(s => s.scheduled_time || s.start_time)
      .filter((t): t is string => Boolean(t && t.trim() !== ''))
      .sort();

    const baseTime = existingTimes[0] || "17:00:00";

    // 7. Build updates — use slotIdx for time so all courts in the same round share the same time
    // This ensures a player CANNOT be in two different courts at the same time
    const allResults = orderedMatches;
    
    const updates = allResults.map(({ match: schedule, slotIdx }) => {
      const matchTime = addMinutesToTimeString(baseTime, slotIdx * 5);

      return {
        id: schedule.id,
        scheduled_time: matchTime,
      };
    });

    // 8. Update match_schedules.scheduled_time only
    for (const update of updates) {
      const { error: updateError } = await adminSupabase
        .from('match_schedules')
        .update({ scheduled_time: update.scheduled_time })
        .eq('id', update.id);
      if (updateError) throw updateError;
    }

    return NextResponse.json({ success: true, count: updates.length });
  } catch (error) {
    console.error('Match optimize order error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
