import { data } from "react-router"
import { isAuthenticated } from "~/lib/Security/Password"
import { filterFilesByAccess } from "../fun/accessControl"
import { ownerService } from "~/lib/Services/OwnerService"
import { userActionsService } from "~/lib/Services/UserActionsService"
import db from "~/lib/Database/supabase"

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url)
    const ownerId = url.searchParams.get("ownerId")
    const excludeId = url.searchParams.get("excludeId")
    const page = parseInt(url.searchParams.get("page") || "1")
    const limit = parseInt(url.searchParams.get("limit") || "20")

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

    const { data: files, error } = await query.range(offset, offset + limit - 1)

    if (error) {
      console.error("Error fetching owner videos:", error)
      return data({ error: "Failed to fetch owner videos", data: [] }, { status: 500 })
    }

    const filesWithDefaults = (files || []).map((file: any) => ({
      ...file,
      is_adult: file.is_adult ?? false,
      is_public: file.is_public ?? true,
      owner_id: file.owner_id ?? ""
    }))

    let filteredFiles = await filterFilesByAccess(request, filesWithDefaults)

    filteredFiles = await ownerService.enrichFilesWithOwners(filteredFiles)

    const user = await isAuthenticated(request, ["id"])
    let userActions: { likedFileIds: string[]; dislikedFileIds: string[] } = {
      likedFileIds: [],
      dislikedFileIds: []
    }
    if (user?.id && filteredFiles.length > 0) {
      const fileIds = filteredFiles.map((f: any) => f.id).filter(Boolean)
      if (fileIds.length > 0) {
        const actions = await userActionsService.getUserActions(user.id, fileIds)
        userActions = {
          likedFileIds: Array.from(actions.likedFileIds),
          dislikedFileIds: Array.from(actions.dislikedFileIds)
        }
      }
    }

    const hasMore = filteredFiles.length === limit

    return data(
      {
        data: filteredFiles,
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
