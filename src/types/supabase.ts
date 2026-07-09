/* eslint-disable */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      "app_modification_requests": {
  Row: {
    id: string;
  requester_id: string;
  category: string;
  content: string;
  status: string;
  requested_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  menu_name: string | null;
  };
  Insert: {
    id?: string;
  requester_id: string;
  category: string;
  content: string;
  status?: string;
  requested_at?: string;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  menu_name?: string | null;
  };
  Update: {
    id?: string | null;
  requester_id?: string | null;
  category?: string | null;
  content?: string | null;
  status?: string | null;
  requested_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  menu_name?: string | null;
  };
  Relationships: [];
};
      "assignments": {
  Row: {
    session_id: string;
  user_id: string;
  assigned_at: string;
  };
  Insert: {
    session_id: string;
  user_id: string;
  assigned_at?: string;
  };
  Update: {
    session_id?: string | null;
  user_id?: string | null;
  assigned_at?: string | null;
  };
  Relationships: [];
};
      "attendance_stats": {
  Row: {
    user_id: string | null;
  attended_at: string | null;
  status: string | null;
  match_schedule_id: string | null;
  year: number | null;
  month: number | null;
  week: number | null;
  };
  Insert: {
    user_id?: string | null;
  attended_at?: string | null;
  status?: string | null;
  match_schedule_id?: string | null;
  year?: number | null;
  month?: number | null;
  week?: number | null;
  };
  Update: {
    user_id?: string | null;
  attended_at?: string | null;
  status?: string | null;
  match_schedule_id?: string | null;
  year?: number | null;
  month?: number | null;
  week?: number | null;
  };
  Relationships: [];
};
      "attendances": {
  Row: {
    id: string;
  user_id: string;
  attended_at: string;
  status: string;
  match_schedule_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  partner_user_id: string | null;
  club_id?: string;
  };
  Insert: {
    id?: string;
  user_id: string;
  attended_at: string;
  status?: string;
  match_schedule_id?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  partner_user_id?: string | null;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  user_id?: string | null;
  attended_at?: string | null;
  status?: string | null;
  match_schedule_id?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  partner_user_id?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "challenge_requests": {
  Row: {
    id: string;
  challenge_date: string;
  challenger_id: string;
  partner_id: string;
  opponent1_id: string;
  opponent2_id: string;
  status: string;
  partner_response: string;
  opponent1_response: string;
  opponent2_response: string;
  note: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
  club_id?: string;
  };
  Insert: {
    id?: string;
  challenge_date?: string;
  challenger_id: string;
  partner_id: string;
  opponent1_id: string;
  opponent2_id: string;
  status?: string;
  partner_response?: string;
  opponent1_response?: string;
  opponent2_response?: string;
  note?: string | null;
  responded_at?: string | null;
  created_at?: string;
  updated_at?: string;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  challenge_date?: string | null;
  challenger_id?: string | null;
  partner_id?: string | null;
  opponent1_id?: string | null;
  opponent2_id?: string | null;
  status?: string | null;
  partner_response?: string | null;
  opponent1_response?: string | null;
  opponent2_response?: string | null;
  note?: string | null;
  responded_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "club_members": {
  Row: {
    id: string;
  club_id?: string;
  user_id: string;
  role: string;
  status: string;
  coin_balance: number;
  coin_wins: number;
  coin_losses: number;
  created_at: string | null;
  updated_at: string | null;
  };
  Insert: {
    id?: string;
  club_id?: string;
  user_id: string;
  role?: string;
  status?: string;
  coin_balance?: number;
  coin_wins?: number;
  coin_losses?: number;
  created_at?: string | null;
  updated_at?: string | null;
  };
  Update: {
    id?: string | null;
  club_id?: string | null;
  user_id?: string | null;
  role?: string | null;
  status?: string | null;
  coin_balance?: number | null;
  coin_wins?: number | null;
  coin_losses?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  };
  Relationships: [];
};
      "clubs": {
  Row: {
    id: string;
  name: string;
  code: string;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
  };
  Insert: {
    id?: string;
  name: string;
  code: string;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  };
  Update: {
    id?: string | null;
  name?: string | null;
  code?: string | null;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  };
  Relationships: [];
};
      "courts": {
  Row: {
    id: string;
  name: string;
  is_active: boolean;
  order_index: number | null;
  location: string | null;
  created_at: string;
  club_id?: string;
  };
  Insert: {
    id?: string;
  name: string;
  is_active?: boolean;
  order_index?: number | null;
  location?: string | null;
  created_at?: string;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  name?: string | null;
  is_active?: boolean | null;
  order_index?: number | null;
  location?: string | null;
  created_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "daily_game_counts": {
  Row: {
    date: string;
  user_id: string;
  count: number;
  last_assigned_at: string | null;
  };
  Insert: {
    date: string;
  user_id: string;
  count?: number;
  last_assigned_at?: string | null;
  };
  Update: {
    date?: string | null;
  user_id?: string | null;
  count?: number | null;
  last_assigned_at?: string | null;
  };
  Relationships: [];
};
      "dashboard_menus": {
  Row: {
    id: string;
  name: string;
  path: string;
  icon: string | null;
  admin_only: boolean;
  display_order: number;
  is_active: boolean;
  created_at: string;
  };
  Insert: {
    id?: string;
  name: string;
  path: string;
  icon?: string | null;
  admin_only?: boolean;
  display_order?: number;
  is_active?: boolean;
  created_at?: string;
  };
  Update: {
    id?: string | null;
  name?: string | null;
  path?: string | null;
  icon?: string | null;
  admin_only?: boolean | null;
  display_order?: number | null;
  is_active?: boolean | null;
  created_at?: string | null;
  };
  Relationships: [];
};
      "generated_matches": {
  Row: {
    id: number;
  session_id: string;
  match_number: number;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
  match_type: string;
  status: string;
  match_result: Json | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  club_id?: string;
  };
  Insert: {
    id?: number;
  session_id: string;
  match_number: number;
  team1_player1_id?: string | null;
  team1_player2_id?: string | null;
  team2_player1_id?: string | null;
  team2_player2_id?: string | null;
  match_type?: string;
  status?: string;
  match_result?: Json | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  club_id?: string;
  };
  Update: {
    id?: number | null;
  session_id?: string | null;
  match_number?: number | null;
  team1_player1_id?: string | null;
  team1_player2_id?: string | null;
  team2_player1_id?: string | null;
  team2_player2_id?: string | null;
  match_type?: string | null;
  status?: string | null;
  match_result?: Json | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "level_info": {
  Row: {
    id: number;
  code: string;
  name: string;
  description: string | null;
  created_at: string;
  score: number | null;
  };
  Insert: {
    id?: number;
  code: string;
  name: string;
  description?: string | null;
  created_at?: string;
  score?: number | null;
  };
  Update: {
    id?: number | null;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  created_at?: string | null;
  score?: number | null;
  };
  Relationships: [];
};
      "match_coin_bets": {
  Row: {
    id: number;
  match_id: number | null;
  profile_id: string;
  wager_amount: number;
  created_at: string;
  updated_at: string;
  club_id?: string;
  };
  Insert: {
    id?: number;
  match_id?: number | null;
  profile_id: string;
  wager_amount?: number;
  created_at?: string;
  updated_at?: string;
  club_id?: string;
  };
  Update: {
    id?: number | null;
  match_id?: number | null;
  profile_id?: string | null;
  wager_amount?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "match_participants": {
  Row: {
    id: string;
  match_schedule_id: string;
  user_id: string;
  registered_at: string;
  status: string;
  notes: string | null;
  partner_user_id: string | null;
  club_id?: string;
  };
  Insert: {
    id?: string;
  match_schedule_id: string;
  user_id: string;
  registered_at?: string;
  status?: string;
  notes?: string | null;
  partner_user_id?: string | null;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  match_schedule_id?: string | null;
  user_id?: string | null;
  registered_at?: string | null;
  status?: string | null;
  notes?: string | null;
  partner_user_id?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "match_player_status": {
  Row: {
    id: number;
  match_id: number;
  user_id: string;
  status: string;
  updated_at: string;
  updated_by: string | null;
  club_id?: string;
  };
  Insert: {
    id?: number;
  match_id: number;
  user_id: string;
  status?: string;
  updated_at?: string;
  updated_by?: string | null;
  club_id?: string;
  };
  Update: {
    id?: number | null;
  match_id?: number | null;
  user_id?: string | null;
  status?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "match_results": {
  Row: {
    id: number;
  match_id: number;
  winner_team1: boolean;
  team1_score: number;
  team2_score: number;
  created_at: string;
  club_id?: string;
  };
  Insert: {
    id?: number;
  match_id: number;
  winner_team1: boolean;
  team1_score: number;
  team2_score: number;
  created_at?: string;
  club_id?: string;
  };
  Update: {
    id?: number | null;
  match_id?: number | null;
  winner_team1?: boolean | null;
  team1_score?: number | null;
  team2_score?: number | null;
  created_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "match_schedules": {
  Row: {
    id: string;
  generated_match_id: number | null;
  match_date: string | null;
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
  scheduled_time: string | null;
  court_number: number | null;
  location: string | null;
  max_participants: number;
  current_participants: number;
  status: string;
  description: string | null;
  match_result: Json | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  schedule_source: string;
  referee_id: string | null;
  club_id?: string;
  };
  Insert: {
    id?: string;
  generated_match_id?: number | null;
  match_date?: string | null;
  scheduled_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  scheduled_time?: string | null;
  court_number?: number | null;
  location?: string | null;
  max_participants?: number;
  current_participants?: number;
  status?: string;
  description?: string | null;
  match_result?: Json | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
  schedule_source?: string;
  referee_id?: string | null;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  generated_match_id?: number | null;
  match_date?: string | null;
  scheduled_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  scheduled_time?: string | null;
  court_number?: number | null;
  location?: string | null;
  max_participants?: number | null;
  current_participants?: number | null;
  status?: string | null;
  description?: string | null;
  match_result?: Json | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  schedule_source?: string | null;
  referee_id?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "match_sessions": {
  Row: {
    id: string;
  session_name: string;
  session_date: string;
  status: string;
  total_matches: number;
  assigned_matches: number;
  created_at: string;
  updated_at: string;
  club_id?: string;
  };
  Insert: {
    id?: string;
  session_name: string;
  session_date: string;
  status?: string;
  total_matches?: number;
  assigned_matches?: number;
  created_at?: string;
  updated_at?: string;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  session_name?: string | null;
  session_date?: string | null;
  status?: string | null;
  total_matches?: number | null;
  assigned_matches?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "match_wager_proposals": {
  Row: {
    match_id: number;
  proposed_by: string;
  wager_amount: number;
  status: string;
  responses: Json | null;
  created_at: string;
  updated_at: string;
  club_id?: string;
  };
  Insert: {
    match_id?: number;
  proposed_by: string;
  wager_amount?: number;
  status?: string;
  responses?: Json | null;
  created_at?: string;
  updated_at?: string;
  club_id?: string;
  };
  Update: {
    match_id?: number | null;
  proposed_by?: string | null;
  wager_amount?: number | null;
  status?: string | null;
  responses?: Json | null;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "member_level_votes": {
  Row: {
    id: string;
  voter_id: string;
  subject_id: string;
  skill_level: string;
  created_at: string | null;
  updated_at: string | null;
  club_id?: string;
  };
  Insert: {
    id?: string;
  voter_id: string;
  subject_id: string;
  skill_level: string;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  voter_id?: string | null;
  subject_id?: string | null;
  skill_level?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "member_rating_settings": {
  Row: {
    id: number;
  start_date: string | null;
  end_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  club_id?: string;
  };
  Insert: {
    id?: number;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string;
  };
  Update: {
    id?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "notifications": {
  Row: {
    id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  related_match_id: number | null;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
  survey_id: string | null;
  file_url: string | null;
  file_name: string | null;
  club_id?: string;
  };
  Insert: {
    id?: string;
  user_id: string;
  title: string;
  message: string;
  type?: string;
  related_match_id?: number | null;
  is_read?: boolean;
  created_at?: string;
  read_at?: string | null;
  survey_id?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  user_id?: string | null;
  title?: string | null;
  message?: string | null;
  type?: string | null;
  related_match_id?: number | null;
  is_read?: boolean | null;
  created_at?: string | null;
  read_at?: string | null;
  survey_id?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "product_purchases": {
  Row: {
    id: string;
  profile_id: string;
  product_id: string;
  coin_price: number;
  created_at: string;
  club_id?: string;
  };
  Insert: {
    id?: string;
  profile_id: string;
  product_id: string;
  coin_price: number;
  created_at?: string;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  profile_id?: string | null;
  product_id?: string | null;
  coin_price?: number | null;
  created_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "products": {
  Row: {
    id: string;
  name: string;
  coin_price: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  image_svg: string | null;
  club_id?: string;
  };
  Insert: {
    id?: string;
  name: string;
  coin_price: number;
  description?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
  image_svg?: string | null;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  name?: string | null;
  coin_price?: number | null;
  description?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  image_svg?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "profile_coin_transactions": {
  Row: {
    id: number;
  profile_id: string;
  match_id: number | null;
  transaction_type: string;
  delta: number;
  wager_amount: number;
  team_side: string;
  team1_score: number;
  team2_score: number;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
  club_id?: string;
  };
  Insert: {
    id?: number;
  profile_id: string;
  match_id?: number | null;
  transaction_type: string;
  delta: number;
  wager_amount?: number;
  team_side: string;
  team1_score: number;
  team2_score: number;
  recorded_by?: string | null;
  created_at?: string;
  updated_at?: string;
  club_id?: string;
  };
  Update: {
    id?: number | null;
  profile_id?: string | null;
  match_id?: number | null;
  transaction_type?: string | null;
  delta?: number | null;
  wager_amount?: number | null;
  team_side?: string | null;
  team1_score?: number | null;
  team2_score?: number | null;
  recorded_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "profiles": {
  Row: {
    id: string;
  user_id: string | null;
  username: string | null;
  full_name: string | null;
  email: string | null;
  role: string;
  skill_level: string;
  gender: string | null;
  created_at: string;
  updated_at: string;
  coin_balance: number;
  coin_wins: number;
  coin_losses: number;
  coin_updated_at: string;
  avatar_url: string | null;
  is_guest: boolean | null;
  };
  Insert: {
    id?: string;
  user_id?: string | null;
  username?: string | null;
  full_name?: string | null;
  email?: string | null;
  role?: string;
  skill_level?: string;
  gender?: string | null;
  created_at?: string;
  updated_at?: string;
  coin_balance?: number;
  coin_wins?: number;
  coin_losses?: number;
  coin_updated_at?: string;
  avatar_url?: string | null;
  is_guest?: boolean | null;
  };
  Update: {
    id?: string | null;
  user_id?: string | null;
  username?: string | null;
  full_name?: string | null;
  email?: string | null;
  role?: string | null;
  skill_level?: string | null;
  gender?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  coin_balance?: number | null;
  coin_wins?: number | null;
  coin_losses?: number | null;
  coin_updated_at?: string | null;
  avatar_url?: string | null;
  is_guest?: boolean | null;
  };
  Relationships: [];
};
      "recurring_match_templates": {
  Row: {
    id: string;
  name: string;
  description: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  location: string;
  max_participants: number;
  is_active: boolean;
  advance_days: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  club_id?: string;
  };
  Insert: {
    id?: string;
  name: string;
  description?: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  location: string;
  max_participants?: number;
  is_active?: boolean;
  advance_days?: number;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  name?: string | null;
  description?: string | null;
  day_of_week?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  max_participants?: number | null;
  is_active?: boolean | null;
  advance_days?: number | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "recurring_templates_view": {
  Row: {
    id: string | null;
  name: string | null;
  description: string | null;
  day_name: string | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  max_participants: number | null;
  is_active: boolean | null;
  advance_days: number | null;
  created_at: string | null;
  };
  Insert: {
    id?: string | null;
  name?: string | null;
  description?: string | null;
  day_name?: string | null;
  day_of_week?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  max_participants?: number | null;
  is_active?: boolean | null;
  advance_days?: number | null;
  created_at?: string | null;
  };
  Update: {
    id?: string | null;
  name?: string | null;
  description?: string | null;
  day_name?: string | null;
  day_of_week?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  max_participants?: number | null;
  is_active?: boolean | null;
  advance_days?: number | null;
  created_at?: string | null;
  };
  Relationships: [];
};
      "sessions": {
  Row: {
    id: string;
  date: string;
  court_code: string;
  time_slot: string;
  round_no: number;
  created_at: string;
  };
  Insert: {
    id?: string;
  date: string;
  court_code: string;
  time_slot: string;
  round_no: number;
  created_at?: string;
  };
  Update: {
    id?: string | null;
  date?: string | null;
  court_code?: string | null;
  time_slot?: string | null;
  round_no?: number | null;
  created_at?: string | null;
  };
  Relationships: [];
};
      "survey_responses": {
  Row: {
    id: string;
  survey_id: string;
  user_id: string;
  selected_option: string;
  created_at: string | null;
  club_id?: string;
  };
  Insert: {
    id?: string;
  survey_id: string;
  user_id: string;
  selected_option: string;
  created_at?: string | null;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  survey_id?: string | null;
  user_id?: string | null;
  selected_option?: string | null;
  created_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "surveys": {
  Row: {
    id: string;
  question: string;
  description: string | null;
  options: Json;
  is_active: boolean;
  max_responses: number | null;
  option_limits: Json | null;
  created_at: string | null;
  club_id?: string;
  };
  Insert: {
    id?: string;
  question: string;
  description?: string | null;
  options: Json;
  is_active?: boolean;
  max_responses?: number | null;
  option_limits?: Json | null;
  created_at?: string | null;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  question?: string | null;
  description?: string | null;
  options?: Json | null;
  is_active?: boolean | null;
  max_responses?: number | null;
  option_limits?: Json | null;
  created_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "team_assignments": {
  Row: {
    id: string;
  assignment_date: string;
  round_number: number;
  title: string;
  team_type: string;
  racket_team: Json | null;
  shuttle_team: Json | null;
  team1: Json | null;
  team2: Json | null;
  team3: Json | null;
  team4: Json | null;
  pairs_data: Json | null;
  created_at: string;
  updated_at: string;
  club_id?: string;
  };
  Insert: {
    id?: string;
  assignment_date: string;
  round_number: number;
  title: string;
  team_type: string;
  racket_team?: Json | null;
  shuttle_team?: Json | null;
  team1?: Json | null;
  team2?: Json | null;
  team3?: Json | null;
  team4?: Json | null;
  pairs_data?: Json | null;
  created_at?: string;
  updated_at?: string;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  assignment_date?: string | null;
  round_number?: number | null;
  title?: string | null;
  team_type?: string | null;
  racket_team?: Json | null;
  shuttle_team?: Json | null;
  team1?: Json | null;
  team2?: Json | null;
  team3?: Json | null;
  team4?: Json | null;
  pairs_data?: Json | null;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "tournament_matches": {
  Row: {
    id: string;
  tournament_id: string;
  round: number;
  match_number: number;
  team1: string[];
  team2: string[];
  court: string;
  scheduled_time: string | null;
  status: string;
  score_team1: number | null;
  score_team2: number | null;
  winner: string | null;
  created_at: string;
  updated_at: string;
  referee_id: string | null;
  referee_name: string | null;
  club_id?: string;
  };
  Insert: {
    id?: string;
  tournament_id: string;
  round: number;
  match_number: number;
  team1: string[];
  team2: string[];
  court: string;
  scheduled_time?: string | null;
  status?: string;
  score_team1?: number | null;
  score_team2?: number | null;
  winner?: string | null;
  created_at?: string;
  updated_at?: string;
  referee_id?: string | null;
  referee_name?: string | null;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  tournament_id?: string | null;
  round?: number | null;
  match_number?: number | null;
  team1?: string[] | null;
  team2?: string[] | null;
  court?: string | null;
  scheduled_time?: string | null;
  status?: string | null;
  score_team1?: number | null;
  score_team2?: number | null;
  winner?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  referee_id?: string | null;
  referee_name?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "tournaments": {
  Row: {
    id: string;
  title: string;
  tournament_date: string;
  round_number: number;
  match_type: string;
  team_assignment_id: string;
  team_type: string;
  total_teams: number;
  matches_per_player: number;
  created_at: string;
  updated_at: string;
  club_id?: string;
  };
  Insert: {
    id?: string;
  title: string;
  tournament_date: string;
  round_number?: number;
  match_type?: string;
  team_assignment_id: string;
  team_type: string;
  total_teams: number;
  matches_per_player?: number;
  created_at?: string;
  updated_at?: string;
  club_id?: string;
  };
  Update: {
    id?: string | null;
  title?: string | null;
  tournament_date?: string | null;
  round_number?: number | null;
  match_type?: string | null;
  team_assignment_id?: string | null;
  team_type?: string | null;
  total_teams?: number | null;
  matches_per_player?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  club_id?: string | null;
  };
  Relationships: [];
};
      "user_status": {
  Row: {
    user_id: string;
  status: string;
  updated_at: string;
  };
  Insert: {
    user_id: string;
  status?: string;
  updated_at?: string;
  };
  Update: {
    user_id?: string | null;
  status?: string | null;
  updated_at?: string | null;
  };
  Relationships: [];
};
      "user_status_log": {
  Row: {
    id: number;
  user_id: string;
  status: string;
  changed_at: string;
  changed_by: string | null;
  };
  Insert: {
    id?: number;
  user_id: string;
  status: string;
  changed_at?: string;
  changed_by?: string | null;
  };
  Update: {
    id?: number | null;
  user_id?: string | null;
  status?: string | null;
  changed_at?: string | null;
  changed_by?: string | null;
  };
  Relationships: [];
};
    };
    Views: {
      "monthly_attendance_summary": {
  Row: {
    user_id: string | null;
  year: number | null;
  month: number | null;
  present_count: number | null;
  absent_count: number | null;
  total_days: number | null;
  attendance_rate: number | null;
  };
  Relationships: [];
};
      "user_notification_stats": {
  Row: {
    user_id: string | null;
  total_notifications: number | null;
  unread_count: number | null;
  read_count: number | null;
  latest_notification: string | null;
  };
  Relationships: [];
};
    };
    Functions: {
      "archive_expired_brackets": {
  Args: Record<string, never>;
  Returns: Json;
};
      "check_profile_connection": {
  Args: Record<string, never>;
  Returns: Json;
};
      "daily_match_generation": {
  Args: Record<string, never>;
  Returns: Json;
};
      "delete_expired_guests": {
  Args: Record<string, never>;
  Returns: Json;
};
      "get_all_users": {
  Args: Record<string, never>;
  Returns: Json[];
};
      "get_attendance_summary": {
  Args: Record<string, never>;
  Returns: Json;
};
      "get_available_profiles": {
  Args: Record<string, never>;
  Returns: { username: string | null; skill_level: string | null; skill_label: string | null; }[];
};
      "get_my_role": {
  Args: Record<string, never>;
  Returns: string | null;
};
      "record_match_result_with_coins": {
  Args: Record<string, never>;
  Returns: Json;
};
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
