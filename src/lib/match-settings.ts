import { getFilteredAdminClient } from '@/lib/supabase-server';

export type MatchSettings = {
  autoGenerateEnabled: boolean;
};

const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  autoGenerateEnabled: false,
};

export async function readMatchSettings(): Promise<MatchSettings> {
  try {
    const supabase = await getFilteredAdminClient();
    const { data, error } = await (supabase as any)
      .from('match_settings')
      .select('auto_generate_enabled')
      .eq('id', 'default')
      .single();

    if (error || !data) {
      return DEFAULT_MATCH_SETTINGS;
    }

    return {
      autoGenerateEnabled: data.auto_generate_enabled ?? false,
    };
  } catch (error) {
    console.error('Failed to read match settings from Supabase:', error);
    return DEFAULT_MATCH_SETTINGS;
  }
}

export async function writeMatchSettings(settings: MatchSettings): Promise<MatchSettings> {
  try {
    const supabase = await getFilteredAdminClient();
    const { error } = await (supabase as any)
      .from('match_settings')
      .upsert({
        id: 'default',
        auto_generate_enabled: settings.autoGenerateEnabled,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.error('Failed to write match settings to Supabase:', error);
      throw error;
    }

    return settings;
  } catch (error) {
    console.error('Error in writeMatchSettings:', error);
    throw error;
  }
}
