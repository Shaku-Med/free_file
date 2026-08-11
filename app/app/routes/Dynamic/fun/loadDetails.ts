/**
 * Server-side detail fetch for the watch page.
 *
 * Split out of index.tsx: this is the deferred half of the loader (interactions,
 * channel row, comment count, sound attribution) and none of it belongs in a
 * component file.
 *
 * Not named *.server.ts on purpose. index.tsx also ships a client component, and
 * React Router rejects a .server module in that graph. Only the loader reaches
 * this, so it tree-shakes out of the client bundle the same way the loader does.
 */

import db from "~/lib/Database/supabase";
import type { FileType } from "~/lib/types";
import { commentService } from "~/lib/Services/CommentService";
import type { DynamicDeferredDetails } from "../types";


export async function loadDynamicPageDetails(
  file: Record<string, unknown> & { id?: string; owner_id?: string | null },
  userId: string | null
): Promise<DynamicDeferredDetails> {
  if (!db) {
    return {
      userLiked: false,
      userDisliked: false,
      likeCount: 0,
      dislikeCount: 0,
      owner: null,
      channelStats: null,
      commentsCount: 0,
      relatedVideosUserActions: { likedFileIds: [], dislikedFileIds: [] },
      originalSound: null,
      soundRemixes: [],
      acoustidRecording: null,
    };
  }

  const interactionsP =
    file.id != null
      ? db
          .rpc("get_file_interactions", {
            p_file_id: file.id,
            p_user_id: userId,
          })
          .then((r: { data: unknown }) => r.data)
      : Promise.resolve(undefined);

  const ownerChannelP =
    file.owner_id != null
      ? Promise.all([
          db
            .from("users")
            .select("id, username, profile_pic, verified")
            .eq("id", file.owner_id)
            .maybeSingle(),
          db.rpc("get_channel_stats", {
            p_user_id: file.owner_id,
            p_viewer_id: userId,
          }),
        ])
      : Promise.resolve(null);

  const commentsP =
    file.id != null
      ? commentService.getCommentsCount(file.id, userId)
      : Promise.resolve({ data: 0 });

  // Attribution: this file's audio matched an existing original (set by
  // register_audio_fingerprints). Fetch the original's display info  but
  // only when it's public, so a private original never leaks.
  const originalFileId = (file as { original_file_id?: string | null }).original_file_id;
  const originalSoundP: Promise<DynamicDeferredDetails['originalSound']> = originalFileId
    ? (async () => {
        const { data: orig } = await db
          .from('files')
          .select('id, unique_id, file_title, filename, default_thumbnail, preview_endpoint, thumbnails, created_at, owner_id, is_public, visibility, upload_status')
          .eq('id', originalFileId)
          .maybeSingle();
        if (!orig || orig.is_public !== true || orig.upload_status !== 'complete') return null;
        let ownerUsername: string | null = null;
        if (orig.owner_id) {
          const { data: u } = await db
            .from('users')
            .select('username')
            .eq('id', orig.owner_id)
            .maybeSingle();
          ownerUsername = (u as { username?: string } | null)?.username ?? null;
        }
        return {
          id: String(orig.id),
          unique_id: String(orig.unique_id),
          file_title: orig.file_title ?? null,
          filename: orig.filename ?? null,
          default_thumbnail: orig.default_thumbnail ?? null,
          thumbnails: Array.isArray(orig.thumbnails) ? orig.thumbnails : null,
          created_at: orig.created_at ?? null,
          ownerUsername,
        };
      })().catch(() => null)
    : Promise.resolve(null);

  // This file as the ORIGINAL: the public videos that sampled its sound
  // (YouTube's "shorts remixing this video" row).
  const soundRemixesP: Promise<DynamicDeferredDetails['soundRemixes']> = file.id
    ? (async () => {
        const { data: remixes } = await db
          .from('files')
          .select('id, unique_id, file_title, filename, default_thumbnail, preview_endpoint, thumbnails, created_at, view_count, owner_id, is_reel')
          .eq('original_file_id', file.id)
          .eq('is_public', true)
          .eq('is_adult', false)
          .eq('upload_status', 'complete')
          .order('view_count', { ascending: false })
          .limit(12);
        const rows = Array.isArray(remixes) ? remixes : [];
        const ownerIds = Array.from(
          new Set(rows.map((r) => (r.owner_id ? String(r.owner_id) : "")).filter(Boolean)),
        );
        const owners = new Map<string, { id: string; username: string; profile_pic: string; verified?: boolean }>();
        if (ownerIds.length > 0) {
          const { data: users } = await db
            .from('users')
            .select('id, username, profile_pic, verified')
            .in('id', ownerIds);
          for (const u of (users ?? []) as Array<{ id: string; username: string; profile_pic: string | null; verified: boolean | null }>) {
            owners.set(String(u.id), {
              id: String(u.id),
              username: u.username,
              profile_pic: u.profile_pic ?? "",
              verified: u.verified === true,
            });
          }
        }
        return rows.map((r) => ({
          id: String(r.id),
          unique_id: String(r.unique_id),
          file_title: r.file_title ?? null,
          filename: r.filename ?? null,
          default_thumbnail: r.default_thumbnail ?? null,
          thumbnails: Array.isArray(r.thumbnails) ? r.thumbnails : null,
          created_at: r.created_at ?? null,
          view_count: Number(r.view_count) || 0,
          is_reel: r.is_reel === true,
          owner: r.owner_id ? owners.get(String(r.owner_id)) ?? null : null,
        }));
      })().catch(() => [] as DynamicDeferredDetails['soundRemixes'])
    : Promise.resolve([] as DynamicDeferredDetails['soundRemixes']);

  // AcoustID catalog (title / artists / album / hosted cover path).
  const acoustidRecordingId = (file as { acoustid_recording_id?: string | null })
    .acoustid_recording_id;
  const acoustidRecordingP: Promise<DynamicDeferredDetails["acoustidRecording"]> =
    acoustidRecordingId
      ? (async () => {
          const { data: rec } = await db
            .from("acoustid_recordings")
            .select(
              "id, title, artists, album, cover_art_url, musicbrainz_url, duration",
            )
            .eq("id", acoustidRecordingId)
            .maybeSingle();
          if (!rec) return null;
          const title = typeof rec.title === "string" ? rec.title.trim() : "";
          const artists = typeof rec.artists === "string" ? rec.artists.trim() : "";
          // Fingerprint-only stubs (no real song metadata) — hide completely.
          if (
            !title ||
            !artists ||
            /^unknown title$/i.test(title) ||
            /^unknown artist$/i.test(artists) ||
            /matched,\s*but musicbrainz/i.test(title)
          ) {
            return null;
          }
          const durationRaw = (rec as { duration?: unknown }).duration;
          const duration =
            typeof durationRaw === "number" && Number.isFinite(durationRaw)
              ? durationRaw
              : durationRaw != null && Number.isFinite(Number(durationRaw))
                ? Number(durationRaw)
                : null;
          return {
            id: String(rec.id),
            title,
            artists,
            album: typeof rec.album === "string" && rec.album.trim() ? rec.album : null,
            cover_art_url:
              typeof rec.cover_art_url === "string" && rec.cover_art_url.trim()
                ? rec.cover_art_url.trim()
                : null,
            musicbrainz_url:
              typeof rec.musicbrainz_url === "string" && rec.musicbrainz_url.trim()
                ? rec.musicbrainz_url.trim()
                : null,
            duration,
          };
        })().catch(() => null)
      : Promise.resolve(null);

  const [
    interactionsData,
    ownerChannel,
    commentsCountResult,
    originalSound,
    soundRemixes,
    acoustidRecording,
  ] = await Promise.all([
    interactionsP,
    ownerChannelP,
    commentsP,
    originalSoundP,
    soundRemixesP,
    acoustidRecordingP,
  ]);

  let userLiked = false;
  let userDisliked = false;
  let likeCount = 0;
  let dislikeCount = 0;
  const interactions = Array.isArray(interactionsData)
    ? interactionsData[0]
    : interactionsData;
  if (interactions) {
    likeCount = Number((interactions as { like_count?: unknown }).like_count) || 0;
    dislikeCount = Number((interactions as { dislike_count?: unknown }).dislike_count) || 0;
    userLiked = !!(interactions as { user_has_liked?: unknown }).user_has_liked;
    userDisliked = !!(interactions as { user_has_disliked?: unknown }).user_has_disliked;
  }

  let owner: DynamicDeferredDetails["owner"] = null;
  let channelStats: DynamicDeferredDetails["channelStats"] = null;
  if (ownerChannel) {
    const [ownerResult, statsResult] = ownerChannel;
    if (ownerResult.data) {
      owner = {
        id: ownerResult.data.id,
        username: ownerResult.data.username,
        profile_pic: ownerResult.data.profile_pic,
        verified: ownerResult.data.verified ?? false,
      };
    }
    if (statsResult.data) {
      const stats =
        typeof statsResult.data === "string"
          ? JSON.parse(statsResult.data)
          : statsResult.data;
      channelStats = {
        subscriber_count: Number(stats.subscriber_count) || 0,
        is_subscribed: !!stats.is_subscribed,
        notify: stats.notify !== false,
      };
    }
  }

  const commentsCount = commentsCountResult.data || 0;

  return {
    userLiked,
    userDisliked,
    likeCount,
    dislikeCount,
    owner,
    channelStats,
    commentsCount,
    relatedVideosUserActions: { likedFileIds: [], dislikedFileIds: [] },
    originalSound,
    soundRemixes,
    acoustidRecording,
  };
}

