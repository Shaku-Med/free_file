"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { Link, useLocation } from "react-router"
import {
  Search,
  Plus,
  File,
  ChevronDown,
  ChevronRight,
  Shield,
  Play,
  ListVideo,
  Users,
  Sparkles,
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
  SidebarSeparator,
  useSidebar,
} from "~/components/ui/sidebar"
import { Button } from "~/components/ui/button"
import { Badge } from "~/components/ui/badge"
import Logo from "../Logo/Logo"
import { useFileContext } from "~/lib/Context/Context"
import { ParseFilename, arrangeDateForThumbnail, getRandomThumbnail } from "~/lib/utils"
import type { FileType } from "~/lib/types"
import SidebarUserProfile from "./SidebarUserProfile"
import ImageLoad from "~/routes/Home/components/ImageLoad/ImageLoad"
import HomeIcon from "~/components/ui/Icons/Home"

const noopRetry = () => {}

function SidebarThumbnail({ file, imageID }: { file: FileType; imageID: string }) {
  const link = useMemo(() => {
    if (file.file_type?.startsWith("image/") && file.endpoint) {
      return `/api/load/image/${file.endpoint}`
    }
    const randomThumbnail = getRandomThumbnail(file.thumbnails)
    if (randomThumbnail) {
      return `/api/load/image/${randomThumbnail}`
    }
    return `/api/load/image/${arrangeDateForThumbnail(file.created_at)}/${file.unique_id}/thumbnail_${ParseFilename(file.filename)}.jpg`
  }, [file.file_type, file.endpoint, file.thumbnails, file.created_at, file.unique_id, file.filename])

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
    icon: HomeIcon,
    href: "/",
  },
  {
    title: "Subscriptions",
    icon: Users,
    href: "/subscriptions",
  },
  {
    title: "Search",
    icon: Search,
    href: "/search",
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
  const { setIsModalOpen, files } = useFileContext()
  const { isMobile, setOpenMobile } = useSidebar()
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
    <Sidebar variant="sidebar" collapsible="offcanvas" className="bg-background border-none">
      {/* Header — Logo */}
      <SidebarHeader className={`${!isMobile ? 'pt-7' : 'pt-3.5'} px-4 pb-2`}>
        <Link to="/" id="home_button" className="flex items-center gap-2 group w-fit">
          <Logo className="relative h-9 w-9 text-primary transition-transform duration-200 group-hover:scale-110" />
          <span className="text-lg font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Memories
          </span>
        </Link>
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

              {/* More — collapsible */}
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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Now Playing */}
        {currentFile && (
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
        {allOtherFiles.length > 0 && (
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
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-sidebar-border/50 p-3 space-y-2">
        <Button
          onClick={() => setIsModalOpen(true)}
          className="w-full gap-2 h-10 font-medium shadow-sm"
          size="default"
        >
          <Plus className="h-4 w-4" />
          Upload
        </Button>
        <SidebarUserProfile />
      </SidebarFooter>
    </Sidebar>
  )
}
