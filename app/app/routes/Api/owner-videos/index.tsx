import { data } from "react-router"
import { isAuthenticated } from "~/lib/Security/Password"
import { filterFilesByAccess } from "../fun/accessControl"
import { ownerService } from "~/lib/Services/OwnerService"
import { stripGithubRepoForClient } from "~/lib/githubStorage"
import { checkOwnerVideosRateLimit } from "../fun/personalizationRateLimit"
import db from "~/lib/Database/supabase"

export const loader = async ({ request }: { request: Request }) => {
  try {
    // Per user/IP cap so the list/search can't be hammered into the DB.
    const rl = checkOwnerVideosRateLimit(request)
    if (!rl.allowed) {
      return data({ error: "Too many requests", data: [] }, { status: 429 })
    }

    const url = new URL(request.url)
    const ownerId = url.searchParams.get("ownerId")
    const excludeId = url.searchParams.get("excludeId")
    const page = parseInt(url.searchParams.get("page") || "1")
    const limit = parseInt(url.searchParams.get("limit") || "20")
    const safeOnlyParam = url.searchParams.get("safeOnly")
    const safeOnly =
      safeOnlyParam === "1" ||
      safeOnlyParam === "true" ||
      safeOnlyParam === "yes"

    if (!ownerId) {
      return data({ error: "Owner ID is required" }, { status: 400 })
    }

    if (page < 1 || limit < 1 || limit > 100) {
      return data({ error: "Invalid pagination parameters" }, { status: 400 })
    }

    const offset = (page - 1) * limit

    if (!db) {
      return data({ error: "Database not initialized" }, { status: 500 })
    }

    let query = db
      .from("files")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })

    if (excludeId) {
      query = query.neq("id", excludeId)
    }

    // Optional advanced search across title + filename + description. The term is
    // stripped of wildcard / PostgREST-filter metacharacters (`% , ( ) * \`)
    // FIRST, so it can't break out of the `.or()` grammar or the parameterized
    // ilike value — no filter-string injection possible.
    const rawQ = url.searchParams.get("q")
    const safeQ = (rawQ ?? "").replace(/[%,()*\\]/g, "").trim().slice(0, 100)
    if (safeQ) {
      query = query.or(
        `file_title.ilike.%${safeQ}%,filename.ilike.%${safeQ}%,file_description.ilike.%${safeQ}%`,
      )
    }

    // Opt-in filters (used by the series picker, so other callers are unchanged):
    // drop reels and anything shorter than `minDuration` seconds — series are
    // for long-form videos, not shorts.
    if (url.searchParams.get("excludeReels") === "1") {
      query = query.not("is_reel", "is", true) // keeps is_reel = false OR null
    }
    const minDuration = parseInt(url.searchParams.get("minDuration") || "0", 10)
    if (Number.isFinite(minDuration) && minDuration > 0) {
      query = query.gte("duration", minDuration)
    }

    const { data: files, error } = await query.range(offset, offset + limit - 1)

    if (error) {
      console.error("Error fetching owner videos:", error)
      return data({ error: "Failed to fetch owner videos", data: [] }, { status: 500 })
    }

    let rows = files || []
    rows = rows.filter((file: { is_series_main?: unknown; is_files_series_item?: unknown }) => {
      const main = file.is_series_main === true || file.is_series_main === 1
      const itemOnly = file.is_files_series_item === true || file.is_files_series_item === 1
      return main || !itemOnly
    })
    if (safeOnly) {
      rows = rows.filter((file: { is_adult?: unknown }) => {
        const a = file.is_adult
        if (a === true || a === 1) return false
        if (typeof a === "string" && ["true", "t", "1", "yes", "y"].includes(a.trim().toLowerCase())) {
          return false
        }
        return true
      })
    }

    const filesWithDefaults = rows.map((file: any) => ({
      ...stripGithubRepoForClient(file as Record<string, unknown>),
      is_adult: file.is_adult ?? false,
      is_public: file.is_public ?? true,
      owner_id: file.owner_id ?? ""
    }))

    let filteredFiles = await filterFilesByAccess(request, filesWithDefaults)

    filteredFiles = await ownerService.enrichFilesWithOwners(filteredFiles)

    const user = await isAuthenticated(request, ["id"])
    const userId: string | null = user?.id ?? null
    const fileIds = filteredFiles.map((f: any) => f.id).filter(Boolean)
    const interactionsByFile = new Map<
      string,
      { like_count: number; dislike_count: number; comment_count: number; user_has_liked: boolean; user_has_disliked: boolean }
    >()
    let userActions: { likedFileIds: string[]; dislikedFileIds: string[] } = {
      likedFileIds: [],
      dislikedFileIds: []
    }
    if (fileIds.length > 0) {
      const { data: batch } = await db.rpc("get_batch_interactions", {
        p_file_ids: fileIds,
        p_user_id: userId,
      })
      if (Array.isArray(batch)) {
        for (const row of batch) {
          if (row?.file_id) {
            interactionsByFile.set(row.file_id as string, {
              like_count: Number(row.like_count) ?? 0,
              dislike_count: Number(row.dislike_count) ?? 0,
              comment_count: Number(row.comment_count) ?? 0,
              user_has_liked: !!row.user_has_liked,
              user_has_disliked: !!row.user_has_disliked,
            })
          }
        }
        userActions = {
          likedFileIds: batch.filter((r: any) => r.user_has_liked).map((r: any) => r.file_id),
          dislikedFileIds: batch.filter((r: any) => r.user_has_disliked).map((r: any) => r.file_id),
        }
      }
    }

    const filesWithCounts = filteredFiles.map((file: any) => {
      const interactions = file.id ? interactionsByFile.get(file.id) : undefined
      return {
        ...file,
        like_count: interactions ? interactions.like_count : 0,
        dislike_count: interactions ? interactions.dislike_count : 0,
        comment_count: interactions ? interactions.comment_count : 0,
      }
    })

    const hasMore = filteredFiles.length === limit

    return data(
      {
        data: filesWithCounts,
        userActions,
        pagination: {
          page,
          limit,
          hasMore
        }
      },
      { status: 200 }
    )
  } catch (error) {
    console.error("Error in owner-videos loader:", error)
    return data({ error: "Internal server error", data: [] }, { status: 500 })
  }
}
