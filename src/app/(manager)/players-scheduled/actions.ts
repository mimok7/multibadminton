'use server';

import { getProfileByUserId } from '@/lib/auth';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';

export async function fetchAdminMatchSessions() {
  const adminSupabase = await getFilteredAdminClient();
  const serverSupabase = await getSupabaseServerClient();

  const { data: { user }, error: authError } = await serverSupabase.auth.getUser();
  if (authError || !user) throw new Error('Unauthorized');

  const profile = await getProfileByUserId(adminSupabase, user.id);
  if (profile?.role !== 'admin' && profile?.role !== 'manager') {
    throw new Error('Forbidden');
  }

  const { data: sessions, error } = await adminSupabase
    .from('match_sessions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return sessions || [];
}

export async function fetchAdminMatchResults(filters: { dateFilter: string; statusFilter: string }) {
  const adminSupabase = await getFilteredAdminClient();
  const serverSupabase = await getSupabaseServerClient();

  const { data: { user }, error: authError } = await serverSupabase.auth.getUser();
  if (authError || !user) throw new Error('Unauthorized');

  const profile = await getProfileByUserId(adminSupabase, user.id);
  if (profile?.role !== 'admin' && profile?.role !== 'manager') {
    throw new Error('Forbidden');
  }

  let query = adminSupabase
    .from('match_schedules')
    .select(`
      id,
      generated_match_id,
      match_date,
      start_time,
      end_time,
      location,
      status,
      description,
      max_participants,
      current_participants
    `)
    .not('generated_match_id', 'is', null)
    .order('match_date', { ascending: false })
    .order('start_time', { ascending: true });

  if (filters.dateFilter !== 'all') {
    const today = new Date().toISOString().split('T')[0];
    if (filters.dateFilter === 'today') query = query.eq('match_date', today);
    else if (filters.dateFilter === 'upcoming') query = query.gte('match_date', today);
    else if (filters.dateFilter === 'past') query = query.lt('match_date', today);
  }

  if (filters.statusFilter !== 'all') {
    query = query.eq('status', filters.statusFilter);
  }

  const { data: schedules, error } = await query;
  if (error) throw error;
  if (!schedules || schedules.length === 0) return [];

  const generatedMatchIds = Array.from(
    new Set(
      schedules
        .map((s) => s.generated_match_id)
        .filter((id): id is number => typeof id === 'number')
    )
  );

  const { data: genMatches } = await adminSupabase
    .from('generated_matches')
    .select(`
      id,
      match_number,
      session_id,
      status,
      completed_at,
      match_result,
      team1_player1_id,
      team1_player2_id,
      team2_player1_id,
      team2_player2_id
    `)
    .in('id', generatedMatchIds);

  const generatedMatchesById = new Map();
  (genMatches || []).forEach((match) => generatedMatchesById.set(match.id, match));

  const allPlayerIds = new Set<string>();
  const allSessionIds = new Set<string>();

  (genMatches || []).forEach((match) => {
    if (match.team1_player1_id) allPlayerIds.add(match.team1_player1_id);
    if (match.team1_player2_id) allPlayerIds.add(match.team1_player2_id);
    if (match.team2_player1_id) allPlayerIds.add(match.team2_player1_id);
    if (match.team2_player2_id) allPlayerIds.add(match.team2_player2_id);
    if (match.session_id) allSessionIds.add(match.session_id);
  });

  const playersById = new Map();
  const sessionsById = new Map();

  const playersPromise = allPlayerIds.size > 0 
    ? adminSupabase.from('profiles').select('id, username, full_name, skill_level').in('id', Array.from(allPlayerIds))
    : Promise.resolve({ data: [] });

  const sessionsPromise = allSessionIds.size > 0
    ? adminSupabase.from('match_sessions').select('id, session_name, session_date').in('id', Array.from(allSessionIds))
    : Promise.resolve({ data: [] });

  const [playersRes, sessionsRes] = await Promise.all([playersPromise, sessionsPromise]);

  (playersRes.data || []).forEach((p) => playersById.set(p.id, p));
  (sessionsRes.data || []).forEach((s) => sessionsById.set(s.id, s));

  const matchesWithDetails = [];
  
  for (const match of schedules) {
    if (!match.generated_match_id) continue;

    const generatedMatch = generatedMatchesById.get(match.generated_match_id);
    if (!generatedMatch) continue;

    const getPlayer = (id: string) => 
      playersById.get(id) || { username: '미정', full_name: '미정', skill_level: 'E2' };

    const session = generatedMatch.session_id
      ? sessionsById.get(generatedMatch.session_id)
      : null;

    matchesWithDetails.push({
      id: match.id,
      match_date: match.match_date || '',
      start_time: match.start_time || '',
      end_time: match.end_time || '',
      location: match.location || '',
      status: match.status,
      description: match.description || '',
      max_participants: match.max_participants,
      current_participants: match.current_participants,
      generated_match: {
        id: generatedMatch.id,
        match_number: generatedMatch.match_number,
        status: generatedMatch.status,
        completed_at: generatedMatch.completed_at,
        match_result: generatedMatch.match_result,
        session: session || { session_name: '알 수 없음', session_date: '', id: '' },
        team1_player1: getPlayer(generatedMatch.team1_player1_id),
        team1_player2: getPlayer(generatedMatch.team1_player2_id),
        team2_player1: getPlayer(generatedMatch.team2_player1_id),
        team2_player2: getPlayer(generatedMatch.team2_player2_id)
      }
    });
  }

  return matchesWithDetails;
}
