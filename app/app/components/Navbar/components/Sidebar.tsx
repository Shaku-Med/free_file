"use client"

import { useState, useEffect, useMemo } from "react"
import { Link, useLocation } from "react-router"
import {
  Home,
  Search,
  Heart,
  Settings,
  User,
  Plus,
  File,
  ChevronDown,
  Shield,
  Star,
  Play,
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
  useSidebar,
} from "~/components/ui/sidebar"
import { Button } from "~/components/ui/button"
import { Badge } from "~/components/ui/badge"
import Logo from "../Logo/Logo"
import { useFileContext } from "~/lib/Context/Context"
import { ParseFilename, arrangeDateForThumbnail, getRandomThumbnail } from "~/lib/utils"
import type { FileType } from "~/lib/types"
import { Magnetic } from "components/motion-primitives/magnetic"
import SidebarUserProfile from "./SidebarUserProfile"
import ImageLoad from "~/routes/Home/components/ImageLoad/ImageLoad"

const menuItems = [
  {
    title: "Home",
    icon: Home,
    href: "/",
  },
  {
    title: "Reels",
    icon: Play,
    href: "/reel",
  },
  {
    title: "Search",
    icon: Search,
    href: "/search",
  },
  {
    title: "Privacy",
    icon: Shield,
    href: "/privacy",
  },
  {
    title: "Terms",
    icon: File,
    href: "/terms",
  },
  {
    title: "Incoming Features List",
    icon: Star,
    href: "/features/incoming",
  },
]

export function AppSidebar() {
  const location = useLocation()
  const { setIsModalOpen, files } = useFileContext()
  const {isMobile} = useSidebar()
  const [monitoredFiles, setMonitoredFiles] = useState<FileType[]>([])
  const [displayCount, setDisplayCount] = useState(100)

  useEffect(() => {
    setMonitoredFiles(files)
    setDisplayCount(100)
  }, [files])

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

  const handleLoadMore = () => {
    setDisplayCount(prev => prev + 100)
  }

  const getFileThumbnailLink = (file: FileType) => {
    if (file.file_type?.startsWith("image/") && file.endpoint) {
      return `/api/load/image/${file.endpoint}`
    }
    const randomThumbnail = getRandomThumbnail(file.thumbnails)
    if (randomThumbnail) {
      return `/api/load/image/${randomThumbnail}`
    }
    return `/api/load/image/${arrangeDateForThumbnail(file.created_at)}/${file.unique_id}/thumbnail_${ParseFilename(file.filename)}.jpg`
  }

  return (
    <Sidebar variant="sidebar" collapsible="offcanvas" className="bg-background border-none">
      <SidebarHeader className={`${!isMobile ? `pt-[28px]` : `pt-[14px]`}`}>
        <Link to="/" id="home_button" className="flex items-center space-x-2 group">
          <div className="relative flex items-center ">
            <div className="">
              <Logo className="relative h-10 w-10 text-primary" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent line-clamp-1">Memories</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === item.href}
                    tooltip={item.title}
                  >
                    <Link to={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {currentFile && (
          <SidebarGroup>
            <SidebarGroupLabel>Current</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={true}
                    tooltip={(currentFile.file_title && currentFile.file_title.trim() !== '') 
                      ? currentFile.file_title 
                      : ParseFilename(currentFile.filename)}
                  >
                    <Link to={`/${currentFile.unique_id}`} className="flex items-center gap-2 w-full">
                      <div className="relative h-9 w-16 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                        <ImageLoad
                          link={getFileThumbnailLink(currentFile)}
                          imageID={`${currentFile.unique_id}_sidebar`}
                          index={0}
                          retry={() => {}}
                          className="w-full h-full object-cover"
                          quality={5}
                          hasAdultTag={Boolean(currentFile.is_adult)}
                        />
                      </div>
                      <span className="truncate flex-1">
                        {(currentFile.file_title && currentFile.file_title.trim() !== '') 
                          ? currentFile.file_title 
                          : ParseFilename(currentFile.filename)}
                      </span>
                      {currentFile.is_adult && (
                        <Badge variant="destructive" className="shrink-0 text-[10px] px-1.5 py-0.5 h-5">
                          18PG
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {allOtherFiles.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Files</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {otherFiles.map((file) => (
                  <SidebarMenuItem key={file.unique_id}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === `/${file.unique_id}`}
                      tooltip={(file.file_title && file.file_title.trim() !== '') 
                        ? file.file_title 
                        : ParseFilename(file.filename)}
                    >
                      <Link to={`/${file.unique_id}`} className="flex items-center gap-2 w-full">
                        <div className="relative h-8 w-14 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                          <ImageLoad
                            link={getFileThumbnailLink(file)}
                            imageID={`${file.unique_id}_sidebar`}
                            index={0}
                            retry={() => {}}
                            className="w-full h-full object-cover"
                            quality={5}
                            hasAdultTag={Boolean(file.is_adult)}
                          />
                        </div>
                        <span className="truncate flex-1">
                          {(file.file_title && file.file_title.trim() !== '') 
                            ? file.file_title 
                            : ParseFilename(file.filename)}
                        </span>
                        {file.is_adult && (
                          <Badge variant="destructive" className="shrink-0 text-[10px] px-1.5 py-0.5 h-5">
                            18PG
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
              {hasMore && (
                <div className="px-2 pt-2">
                  <Button
                    onClick={handleLoadMore}
                    variant="outline"
                    className="w-full"
                    size="sm"
                  >
                    <ChevronDown className="mr-2 h-4 w-4" />
                    Load More
                  </Button>
                </div>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="p-4 space-y-3">
          <Magnetic
            intensity={0.5}
            range={100}
            actionArea="global"
            springOptions={{
              stiffness: 100,
              damping: 10,
            }}
          >
            <Button
              onClick={() => setIsModalOpen(true)}
              className="w-full"
              size="lg"
            >
              <Plus className="mr-2 h-4 w-4" />
              <span>Add New</span>
            </Button>
          </Magnetic>
        </div>
        <SidebarUserProfile />
      </SidebarFooter>
    </Sidebar>
  )
}

