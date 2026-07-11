export type AttendanceStatus = 'present' | 'lesson' | 'absent';

export interface ExtendedPlayer {
  id: string;
  name: string;
  skill_level: string;
  skill_label: string;
  score?: number;
  gender: string;
  skill_code: string;
  status: AttendanceStatus;
  partner_user_id?: string | null;
}

export interface MatchSession {
  id: string;
  session_name: string;
  session_date: string;
  status: string;
  total_matches: number;
  assigned_matches: number;
  created_at: string;
}

export interface AvailableDateSchedule {
  match_date: string;
  location: string | null;
  start_time: string | null;
  end_time: string | null;
  max_participants: number;
  current_participants: number;
  status: string;
}

export interface GeneratedMatch {
  id: number;
  session_id: string;
  match_number: number;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  team1_player1: {
    id?: string | null;
    name: string;
    skill_level: string;
    score?: number;
  };
  team1_player2: {
    id?: string | null;
    name: string;
    skill_level: string;
    score?: number;
  };
  team2_player1: {
    id?: string | null;
    name: string;
    skill_level: string;
    score?: number;
  };
  team2_player2: {
    id?: string | null;
    name: string;
    skill_level: string;
    score?: number;
  };
  is_scheduled: boolean;
}

export interface AvailableDate {
  date: string;
  schedules: AvailableDateSchedule[];
  totalCapacity: number;
  currentParticipants: number;
  availableSlots: number;
  location: string;
  timeRange: string;
}

export const LEVEL_LABELS: Record<string, string> = {
  a1: 'A1 (최상급)',
  a2: 'A2 (최상급)',
  a3: 'A3 (최상급)',
  b1: 'B1 (상급)',
  b2: 'B2 (상급)',
  b3: 'B3 (상급)',
  c1: 'C1 (중상급)',
  c2: 'C2 (중상급)',
  c3: 'C3 (중상급)',
  d1: 'D1 (중급)',
  d2: 'D2 (중급)',
  d3: 'D3 (중급)',
  e1: 'E1 (초급)',
  e2: 'E2 (초급)',
  e3: 'E3 (초급)',
  n1: 'N1 (입문)',
  n2: 'N2 (입문)',
  n3: 'N3 (입문)',
};
