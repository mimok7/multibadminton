-- Fix trigger to automatically add new auth users to the default club in club_members
-- Run this in Supabase SQL Editor if you want to ensure all new signups have a default club membership.

CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  matched_profile_id uuid;
  target_club_id uuid;
BEGIN
  -- Get club id from user metadata, fallback to the oldest club (default club)
  IF NULLIF(NEW.raw_user_meta_data ->> 'club_id', '') IS NOT NULL THEN
    target_club_id := (NEW.raw_user_meta_data ->> 'club_id')::uuid;
  ELSE
    SELECT id INTO target_club_id FROM public.clubs ORDER BY created_at ASC LIMIT 1;
  END IF;

  -- If this auth user is already linked, do nothing.
  SELECT p.id
  INTO matched_profile_id
  FROM public.profiles p
  WHERE p.user_id = NEW.id
  LIMIT 1;

  IF matched_profile_id IS NOT NULL THEN
    -- Make sure they are in club_members of default/target club
    IF target_club_id IS NOT NULL THEN
      INSERT INTO public.club_members (club_id, user_id, role, status)
      VALUES (target_club_id, matched_profile_id, 'member', 'active')
      ON CONFLICT (club_id, user_id) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  -- First priority: attach to an existing placeholder profile with the same email.
  SELECT p.id
  INTO matched_profile_id
  FROM public.profiles p
  WHERE p.email = NEW.email
    AND p.user_id IS NULL
  ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST
  LIMIT 1;

  IF matched_profile_id IS NOT NULL THEN
    UPDATE public.profiles
    SET
      user_id = NEW.id,
      email = COALESCE(NEW.email, email),
      updated_at = now()
    WHERE id = matched_profile_id;

    -- Make sure they are in club_members of default/target club
    IF target_club_id IS NOT NULL THEN
      INSERT INTO public.club_members (club_id, user_id, role, status)
      VALUES (target_club_id, matched_profile_id, 'member', 'active')
      ON CONFLICT (club_id, user_id) DO NOTHING;
    END IF;

    RETURN NEW;
  END IF;

  -- Otherwise create a fresh linked profile row.
  INSERT INTO public.profiles (
    id,
    user_id,
    email,
    username,
    full_name,
    role,
    skill_level
  )
  VALUES (
    NEW.id,
    NEW.id,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data ->> 'username', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'role', ''), 'user'),
    'E2'
  )
  RETURNING id INTO matched_profile_id;

  -- Make sure they are in club_members of default/target club
  IF target_club_id IS NOT NULL THEN
    INSERT INTO public.club_members (club_id, user_id, role, status)
    VALUES (
      target_club_id, 
      matched_profile_id, 
      CASE WHEN (NEW.raw_user_meta_data ->> 'role') = 'admin' THEN 'admin'
           WHEN (NEW.raw_user_meta_data ->> 'role') = 'manager' THEN 'manager'
           ELSE 'member' END, 
      'active'
    )
    ON CONFLICT (club_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
