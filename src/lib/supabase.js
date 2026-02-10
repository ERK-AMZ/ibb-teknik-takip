import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

// ═══ AUTH ═══
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// ═══ PROFILES ═══
export async function getProfiles() {
  const { data } = await supabase.from('profiles').select('*').order('full_name');
  return data || [];
}

export async function getProfile(id) {
  const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
  return data;
}

export async function updateProfile(id, updates) {
  const { data, error } = await supabase.from('profiles').update(updates).eq('id', id);
  return { data, error };
}

export async function createUserWithProfile(email, password, profile) {
  // Admin creates user via Supabase Auth admin API
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (authError) {
    // Fallback: sign up normally
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) return { error: signUpError };
    const userId = signUpData.user?.id;
    if (userId) {
      await supabase.from('profiles').insert({ id: userId, ...profile });
    }
    return { data: signUpData, error: null };
  }
  const userId = authData.user?.id;
  if (userId) {
    await supabase.from('profiles').insert({ id: userId, ...profile });
  }
  return { data: authData, error: null };
}

// ═══ OVERTIMES ═══
export async function getOvertimes() {
  const { data } = await supabase.from('overtimes').select('*').order('work_date', { ascending: false });
  return data || [];
}

export async function createOvertime(overtime) {
  const { data, error } = await supabase.from('overtimes').insert(overtime).select().single();
  return { data, error };
}

export async function updateOvertime(id, updates) {
  const { data, error } = await supabase.from('overtimes').update(updates).eq('id', id);
  return { data, error };
}

// ═══ LEAVES ═══
export async function getLeaves() {
  const { data } = await supabase.from('leaves').select('*').order('created_at', { ascending: false });
  return data || [];
}

export async function createLeave(leave) {
  const { data, error } = await supabase.from('leaves').insert(leave).select().single();
  return { data, error };
}

export async function updateLeave(id, updates) {
  const { data, error } = await supabase.from('leaves').update(updates).eq('id', id);
  return { data, error };
}

// ═══ PHOTO UPLOAD ═══
export async function uploadPhoto(file, folder) {
  const ext = file.name.split('.').pop();
  const fileName = `${folder}/${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage.from('photos').upload(fileName, file);
  if (error) return { url: null, error };
  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(fileName);
  return { url: urlData.publicUrl, error: null };
}

// ═══ REALTIME ═══
export function subscribeToChanges(table, callback) {
  return supabase.channel(`${table}-changes`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, callback)
    .subscribe();
}
