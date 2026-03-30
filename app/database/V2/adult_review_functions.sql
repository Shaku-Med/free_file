-- ============================================================
-- Adult content false-identification review request functions
-- ============================================================
-- Requires: adult_review_requests, files, users tables
-- Run after adult_review_requests.sql
-- ============================================================

-- Drop existing
DO $$
DECLARE
  r RECORD;
  fns text[] := ARRAY[
    'submit_adult_review_request',
    'get_adult_review_status',
    'respond_adult_review'
  ];
  fn text;
BEGIN
  FOREACH fn IN ARRAY fns
  LOOP
    FOR r IN
      SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', r.nspname, r.proname, r.args);
    END LOOP;
  END LOOP;
END $$;


-- ============================================================
-- 1. submit_adult_review_request — user requests review of their file
--    Max 2 requests per file per user
-- ============================================================
CREATE OR REPLACE FUNCTION submit_adult_review_request(
  p_user_id  uuid,
  p_file_id  uuid,
  p_reason   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_file_owner uuid;
  v_is_adult boolean;
  v_existing RECORD;
  v_request_id uuid;
BEGIN
  -- Validate inputs
  IF p_user_id IS NULL OR p_file_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing required fields');
  END IF;

  -- Check file exists and belongs to the user
  SELECT owner_id, is_adult INTO v_file_owner, v_is_adult
  FROM files WHERE id = p_file_id;

  IF v_file_owner IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'File not found');
  END IF;

  IF v_file_owner != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only request review for your own files');
  END IF;

  IF v_is_adult = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'This file is not marked as adult content');
  END IF;

  -- Check existing request
  SELECT id, request_count, status, response_message, accepted
  INTO v_existing
  FROM adult_review_requests
  WHERE file_id = p_file_id AND user_id = p_user_id;

  IF v_existing IS NOT NULL THEN
    -- Already at max requests
    IF v_existing.request_count >= 2 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Maximum review requests reached for this file (2/2)',
        'request_count', v_existing.request_count,
        'status', v_existing.status,
        'response_message', v_existing.response_message,
        'accepted', v_existing.accepted
      );
    END IF;

    -- If previous was denied, allow re-request (increment count)
    IF v_existing.status = 'denied' THEN
      UPDATE adult_review_requests
      SET request_count = request_count + 1,
          reason = COALESCE(p_reason, reason),
          status = 'pending',
          response_message = NULL,
          accepted = NULL,
          updated_at = now(),
          reviewed_at = NULL
      WHERE id = v_existing.id
      RETURNING id INTO v_request_id;

      RETURN jsonb_build_object(
        'success', true,
        'request_id', v_request_id,
        'request_count', v_existing.request_count + 1,
        'message', 'Review request resubmitted'
      );
    END IF;

    -- If still pending
    IF v_existing.status = 'pending' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'A review request is already pending for this file',
        'request_count', v_existing.request_count,
        'status', 'pending'
      );
    END IF;

    -- If accepted, file should no longer be adult
    IF v_existing.status = 'accepted' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'This file was already reviewed and accepted',
        'status', 'accepted'
      );
    END IF;
  END IF;

  -- Create new request
  INSERT INTO adult_review_requests (file_id, user_id, reason)
  VALUES (p_file_id, p_user_id, p_reason)
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'request_count', 1,
    'message', 'Review request submitted'
  );
END;
$$;


-- ============================================================
-- 2. get_adult_review_status — check review status for a file
-- ============================================================
CREATE OR REPLACE FUNCTION get_adult_review_status(
  p_user_id  uuid,
  p_file_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result RECORD;
BEGIN
  SELECT id, request_count, status, response_message, accepted, created_at, reviewed_at
  INTO v_result
  FROM adult_review_requests
  WHERE file_id = p_file_id AND user_id = p_user_id;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object(
      'has_request', false,
      'request_count', 0,
      'can_request', true
    );
  END IF;

  RETURN jsonb_build_object(
    'has_request', true,
    'request_id', v_result.id,
    'request_count', v_result.request_count,
    'status', v_result.status,
    'response_message', v_result.response_message,
    'accepted', v_result.accepted,
    'created_at', v_result.created_at,
    'reviewed_at', v_result.reviewed_at,
    'can_request', (v_result.request_count < 2 AND v_result.status = 'denied')
  );
END;
$$;


-- ============================================================
-- 3. respond_adult_review — admin responds to a review request
--    If accepted, sets files.is_adult = false
-- ============================================================
CREATE OR REPLACE FUNCTION respond_adult_review(
  p_request_id       uuid,
  p_accepted         boolean,
  p_response_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_file_id uuid;
  v_status text;
BEGIN
  SELECT file_id, status INTO v_file_id, v_status
  FROM adult_review_requests
  WHERE id = p_request_id;

  IF v_file_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  IF v_status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request already reviewed');
  END IF;

  -- Update the request
  UPDATE adult_review_requests
  SET status = CASE WHEN p_accepted THEN 'accepted' ELSE 'denied' END,
      accepted = p_accepted,
      response_message = p_response_message,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_request_id;

  -- If accepted, remove the adult flag from the file
  IF p_accepted THEN
    UPDATE files SET is_adult = false WHERE id = v_file_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'accepted', p_accepted,
    'file_id', v_file_id
  );
END;
$$;


-- ============================================================
-- Grants
-- ============================================================
GRANT EXECUTE ON FUNCTION submit_adult_review_request(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_adult_review_status(uuid, uuid) TO authenticated;
-- respond_adult_review is admin-only, no public grant
