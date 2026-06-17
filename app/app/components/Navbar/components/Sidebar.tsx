"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { Link, useLocation } from "react-router"
import {
  File,
  ChevronDown,
  ChevronRight,
  Shield,
  Play,
  ListVideo,
  Users,
  Sparkles,
  Home,
  Film,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "~/components/ui/sidebar"
import { Button } from "~/components/ui/button"
import { UserProfileDropdown } from "~/components/UserProfileDropdown"
import { Badge } from "~/components/ui/badge"
import Logo from "../Logo/Logo"
import { useFileContext } from "~/lib/Context/Context"
import { getThumbnailUrl, ParseFilename, cn } from "~/lib/utils"
import type { FileType } from "~/lib/types"
import ImageLoad from "~/routes/Home/components/ImageLoad/ImageLoad"
import { useStandalone } from "~/lib/hooks/useStandalone"
import { isWatchRoute } from "~/lib/watchRoute"

const noopRetry = () => {}

function SidebarThumbnail({ file, imageID }: { file: FileType; imageID: string }) {
  const link = useMemo(() => getThumbnailUrl(file), [file.file_type, file.endpoint, file.default_thumbnail, file.created_at, file.unique_id, file.filename])

  return (
    <ImageLoad
      link={link}
      imageID={imageID}
      index={0}
      retry={noopRetry}
      className="w-full h-full object-cover"
      quality={10}
      hasAdultTag={Boolean(file.is_adult)}
    />
  )
}

function getFileTitle(file: FileType): string {
  return (file.file_title && file.file_title.trim() !== '')
    ? file.file_title
    : ParseFilename(file.filename)
}

const mainNavItems = [
  {
    title: "Home",
    icon: Home,
    href: "/",
  },
  {
    title: "Subscriptions",
    icon: Users,
    href: "/subscriptions",
  },
  {
    title: "Reel",
    icon: Film,
    href: "/reel",
  },
  {
    title: "Playlist",
    icon: ListVideo,
    href: "/playlist",
  },
]

const moreNavItems = [
  {
    title: "Incoming Features",
    icon: Sparkles,
    href: "/features/incoming",
  },
  {
    title: "Privacy Policy",
    icon: Shield,
    href: "/privacy",
  },
  {
    title: "Terms of Service",
    icon: File,
    href: "/terms",
  },
]

export function AppSidebar() {
  const location = useLocation()
  const { files } = useFileContext()
  const { isMobile, setOpenMobile, sheetOnly, state } = useSidebar()
  const isStandalone = useStandalone()
  // Desktop rail (collapsed to icons): hide content-heavy sections so the
  // thumbnail lists unmount instead of clipping inside the 4rem rail.
  // On the watch page collapse fully (offcanvas) so the player goes full-width;
  // everywhere else collapse to the icon rail.
  const onWatch = isWatchRoute(location.pathname)
  const collapsibleMode = onWatch ? "offcanvas" : "icon"
  const railMode = !isMobile && !sheetOnly && !onWatch && state === "collapsed"
  // Mirror the navbar's pt-2 offset (only present when the rail is expanded).
  const expandedDesktop = !isMobile && !sheetOnly && state === "expanded"
  const [monitoredFiles, setMonitoredFiles] = useState<FileType[]>([])
  const [displayCount, setDisplayCount] = useState(100)
  const [moreOpen, setMoreOpen] = useState(false)
  const [filesCollapsed, setFilesCollapsed] = useState(false)

  useEffect(() => {
    setMonitoredFiles(files)
    setDisplayCount(100)
  }, [files])

  useEffect(() => {
    setOpenMobile(false)
  }, [location.pathname, setOpenMobile])

  const currentFileId = location.pathname.replace(/^\//, "")
  const currentFile = useMemo(() =>
    monitoredFiles.find(file => file.unique_id === currentFileId),
    [monitoredFiles, currentFileId]
  )
  const allOtherFiles = useMemo(() =>
    monitoredFiles.filter(file => file.unique_id !== currentFileId),
    [monitoredFiles, currentFileId]
  )
  const otherFiles = useMemo(() =>
    allOtherFiles.slice(0, displayCount),
    [allOtherFiles, displayCount]
  )
  const hasMore = allOtherFiles.length > displayCount

  const handleLoadMore = useCallback(() => {
    setDisplayCount(prev => prev + 100)
  }, [])

  const isActiveRoute = useCallback((href: string) => {
    if (href === "/") return location.pathname === "/"
    return location.pathname === href || location.pathname.startsWith(`${href}/`)
  }, [location.pathname])

  // Auto-expand "More" if user is on one of those pages
  useEffect(() => {
    if (moreNavItems.some(item => isActiveRoute(item.href))) {
      setMoreOpen(true)
    }
  }, [isActiveRoute])

  return (
    <Sidebar variant="sidebar" collapsible={collapsibleMode} className="bg-background border-none">
      {/* Header  Logo. Matches the navbar's h-14 row so the mark lines up. */}
      <SidebarHeader className={cn("p-0 ml-[-5px]", isStandalone && "pt-[env(safe-area-inset-top)]")}>
        <div
          className={cn(
            "flex h-14 items-center px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2",
            expandedDesktop && "mt-2",
          )}
        >
          <Link to="/" id="home_button" className="flex items-center gap-2 group w-fit group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center ml-[-5px]">
            <Logo className="relative h-8 w-8 text-primary transition-transform duration-200 group-hover:scale-110 group-data-[collapsible=icon]:h-7 group-data-[collapsible=icon]:w-7" />
            <span className="text-lg font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent group-data-[collapsible=icon]:hidden">
              Memories
            </span>
          </Link>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-1 overflow-x-hidden">
        {/* Main Navigation */}
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => {
                const isActive = isActiveRoute(item.href)
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className={isActive ? "bg-primary/10 text-primary font-medium" : ""}
                    >
                      <Link to={item.href}>
                        <item.icon className="w-[18px] h-[18px] fill-none stroke-current" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}

              {/* More  collapsible (hidden in the icon rail) */}
              {!railMode && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="More"
                      onClick={() => setMoreOpen(prev => !prev)}
                      className="text-muted-foreground"
                    >
                      <ChevronRight className={`w-[18px] h-[18px] transition-transform duration-200 ${moreOpen ? 'rotate-90' : ''}`} />
                      <span>More</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {moreOpen && moreNavItems.map((item) => {
                    const isActive = isActiveRoute(item.href)
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.title}
                          className={`ml-2 ${isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"}`}
                        >
                          <Link to={item.href}>
                            <item.icon className="w-4 h-4 fill-none stroke-current" />
                            <span className="text-[13px]">{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Now Playing */}
        {currentFile && !railMode && (
          <>
            <SidebarGroup className="py-1">
              <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 px-3">
                Now Playing
              </SidebarGroupLabel>
              <SidebarGroupContent className="px-1">
                <Link
                  to={`/${currentFile.unique_id}`}
                  className="group/current flex gap-3 p-2 rounded-lg bg-primary/5 border border-primary/10 hover:bg-primary/10 transition-colors"
                >
                  <div className="relative h-12 w-20 flex-shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-primary/20">
                    <SidebarThumbnail file={currentFile} imageID={`${currentFile.unique_id}_sidebar_current`} />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover/current:opacity-100 transition-opacity">
                      <Play className="w-4 h-4 text-white fill-white" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <p className="text-sm font-medium text-foreground truncate leading-tight">
                      {getFileTitle(currentFile)}
                    </p>
                    {currentFile.is_adult && (
                      <Badge variant="destructive" className="mt-1 w-fit text-[9px] px-1.5 py-0 h-4 font-semibold">
                        18+
                      </Badge>
                    )}
                  </div>
                </Link>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
          </>
        )}

        {/* Files Library */}
        {allOtherFiles.length > 0 && !railMode && (
          <SidebarGroup className="py-1 flex-1">
            <button
              onClick={() => setFilesCollapsed(prev => !prev)}
              className="flex items-center justify-between w-full px-3 py-1 group/label cursor-pointer"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 group-hover/label:text-muted-foreground transition-colors">
                Library
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground/50 tabular-nums">{allOtherFiles.length}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform duration-200 ${filesCollapsed ? '-rotate-90' : ''}`} />
              </div>
            </button>
            {!filesCollapsed && (
              <SidebarGroupContent className="mt-1">
                <SidebarMenu>
                  {otherFiles.map((file) => (
                    <SidebarMenuItem key={file.unique_id}>
                      <SidebarMenuButton
                        asChild
                        isActive={location.pathname === `/${file.unique_id}`}
                        tooltip={getFileTitle(file)}
                      >
                        <Link to={`/${file.unique_id}`} className="flex items-center gap-2.5 w-full group/file">
                          <div className="relative h-8 w-14 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                            <SidebarThumbnail file={file} imageID={`${file.unique_id}_sidebar`} />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover/file:opacity-100 transition-opacity">
                              <Play className="w-3 h-3 text-white fill-white" />
                            </div>
                          </div>
                          <span className="truncate flex-1 text-[13px]">
                            {getFileTitle(file)}
                          </span>
                          {file.is_adult && (
                            <Badge variant="destructive" className="shrink-0 text-[9px] px-1.5 py-0 h-4 font-semibold">
                              18+
                            </Badge>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
                {hasMore && (
                  <div className="px-2 pt-2 pb-1">
                    <Button
                      onClick={handleLoadMore}
                      variant="ghost"
                      className="w-full text-muted-foreground hover:text-foreground h-8 text-xs"
                      size="sm"
                    >
                      <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
                      Show more
                    </Button>
                  </div>
                )}
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}

        {/* Files Library  icon rail. The full list is hidden in rail mode (text
            clips at 4rem), so show just the thumbnails as square icons, with the
            now-playing file pinned on top and a tooltip carrying the title. */}
        {railMode && (currentFile || allOtherFiles.length > 0) && (
          <SidebarGroup className="py-1 flex-1 min-h-0 overflow-y-auto">
            <SidebarGroupContent>
              <div className="flex flex-col items-center gap-1.5">
                {currentFile && (
                  <Link
                    to={`/${currentFile.unique_id}`}
                    title={getFileTitle(currentFile)}
                    aria-label={getFileTitle(currentFile)}
                    className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-muted ring-2 ring-primary transition-transform hover:scale-105"
                  >
                    <SidebarThumbnail file={currentFile} imageID={`${currentFile.unique_id}_sidebar_rail_current`} />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Play className="h-3.5 w-3.5 fill-white text-white" />
                    </span>
                  </Link>
                )}
                {otherFiles.map((file) => (
                  <Link
                    key={file.unique_id}
                    to={`/${file.unique_id}`}
                    title={getFileTitle(file)}
                    aria-label={getFileTitle(file)}
                    className={cn(
                      "relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-muted ring-1 transition-all hover:scale-105 hover:ring-primary/50 group/railfile",
                      location.pathname === `/${file.unique_id}` ? "ring-2 ring-primary" : "ring-border/50",
                    )}
                  >
                    <SidebarThumbnail file={file} imageID={`${file.unique_id}_sidebar_rail`} />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover/railfile:opacity-100">
                      <Play className="h-3 w-3 fill-white text-white" />
                    </span>
                    {file.is_adult && (
                      <span className="absolute inset-x-0 bottom-0 bg-black/65 text-center text-[7px] font-semibold leading-tight text-white">
                        18+
                      </span>
                    )}
                  </Link>
                ))}
                {hasMore && (
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    aria-label="Show more"
                    title="Show more"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 ring-1 ring-border/50 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                )}
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Account  reuses the same profile dropdown/menu as the navbar; the
          sidebar variant adds the username + subscriber/upload counts when the
          rail is expanded (and in the mobile sheet), collapsing to the avatar
          in the icon rail. */}
      <SidebarFooter className="border-t border-border/40">
        <UserProfileDropdown variant="sidebar" />
      </SidebarFooter>

      {/* Grab handle at the edge  drag/click to reveal when collapsed. */}
      <SidebarRail />
    </Sidebar>
  )
}
