"use client"

import { useState, useEffect, useCallback, type ComponentType } from "react"
import { Link, useLocation } from "react-router"
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleUserRound,
  Film,
  History,
  Home,
  ListVideo,
  Settings,
  Sparkles,
  SquarePlay,
  SquareUserRound,
  ThumbsUp,
  Users,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "~/components/ui/sidebar"
import { Button } from "~/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { UserProfileDropdown } from "~/components/UserProfileDropdown"
import Logo from "../Logo/Logo"
import { useFileContext } from "~/lib/Context/Context"
import { cn } from "~/lib/utils"
import { getProfilePicUrl } from "~/lib/utils/profilePic"
import { SUBSCRIPTIONS_CHANGED_EVENT } from "~/lib/subscriptionEvents"
import { useStandalone } from "~/lib/hooks/useStandalone"
import { isWindappMac, useWindapp } from "~/lib/hooks/useWindapp"
import { isWatchRoute } from "~/lib/watchRoute"
import { DesktopUpdateSidebarCard } from "~/components/DesktopUpdateCta"

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>

type NavEntry = { title: string; icon: Icon; href: string }

type SubscribedChannel = { username: string; profile_pic: string | null; verified: boolean }

const mainNav: NavEntry[] = [
  { title: "Home", icon: Home, href: "/" },
  { title: "Reel", icon: Film, href: "/reel" },
  { title: "Subscriptions", icon: Users, href: "/subscriptions" },
]

const footerLinks = [
  { title: "Privacy", href: "/privacy" },
  { title: "Terms", href: "/terms" },
  { title: "Guidelines", href: "/community-guidelines" },
  { title: "DMCA", href: "/dmca" },
  { title: "Download app", href: "/download" },
]

/** Profile tabs that have a row of their own under "You". */
const TAB_ROWS = new Set(["history", "liked"])

/** YouTube shows this many channels before "Show more". */
const CHANNELS_FOLDED = 7

// YouTube's guide row: 40px tall, 10px corners, 24px icon with 24px after it.
// The active row gets the accent background (from the menu button), not a new
// colour; hover is a lighter wash of it so a hovered row never reads as current.
const ENTRY = "h-10 gap-6 rounded-lg px-3 text-sm [&>svg]:size-6 not-data-[active=true]:hover:bg-sidebar-accent/60"

function useSubscribedChannels(userId: string | null | undefined) {
  const [channels, setChannels] = useState<SubscribedChannel[]>([])

  useEffect(() => {
    if (!userId) {
      setChannels([])
      return
    }
    let cancelled = false
    const load = () => {
      fetch("/api/subscriptions/channels", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { channels: [] }))
        .then((j) => {
          if (!cancelled) setChannels(Array.isArray(j?.channels) ? j.channels : [])
        })
        .catch(() => {})
    }
    load()
    window.addEventListener(SUBSCRIPTIONS_CHANGED_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(SUBSCRIPTIONS_CHANGED_EVENT, load)
    }
  }, [userId])

  return channels
}

function SectionHeading({ title, href }: { title: string; href: string }) {
  return (
    <Link
      to={href}
      prefetch="intent"
      className="flex h-10 w-fit items-center gap-2 rounded-lg px-3 text-base font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
    >
      {title}
      <ChevronRight className="size-4" strokeWidth={2} aria-hidden />
    </Link>
  )
}

function EntryLink({ entry, active }: { entry: NavEntry; active: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={entry.title} className={ENTRY}>
        <Link to={entry.href} prefetch="intent">
          <entry.icon strokeWidth={1.75} />
          <span>{entry.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/** The collapsed rail, like YouTube's mini guide: icon over a small label. */
function RailLink({ entry, active }: { entry: NavEntry; active: boolean }) {
  return (
    <Link
      to={entry.href}
      prefetch="intent"
      data-active={active}
      className="flex w-full flex-col items-center gap-1.5 rounded-lg py-4 text-[10px] leading-[14px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 data-[active=true]:bg-sidebar-accent"
    >
      <entry.icon className="size-6" strokeWidth={1.75} />
      <span className="max-w-full truncate px-1">{entry.title}</span>
    </Link>
  )
}

export function AppSidebar() {
  const location = useLocation()
  const { userId, userProfile } = useFileContext()
  const { isMobile, setOpenMobile, state } = useSidebar()
  const isStandalone = useStandalone()
  const isWindapp = useWindapp()
  const isMac = isWindappMac()
  // The watch page collapses the sidebar away entirely so the player gets the
  // width; everywhere else it folds down to the rail.
  const onWatch = isWatchRoute(location.pathname)
  const railMode = !isMobile && !onWatch && state === "collapsed"
  // Mirror the navbar's pt-2 offset (only present when the rail is expanded).
  const expandedDesktop = !isMobile && state === "expanded"
  const channels = useSubscribedChannels(userId)
  const [channelsOpen, setChannelsOpen] = useState(false)

  useEffect(() => {
    setOpenMobile(false)
  }, [location.pathname, setOpenMobile])

  const isActiveRoute = useCallback((href: string) => {
    const [path, query] = href.split("?")
    if (path === "/") return location.pathname === "/"
    const onPath = location.pathname === path || location.pathname.startsWith(`${path}/`)
    if (!onPath) return false
    // History and liked are tabs of the profile, so on that page the tab
    // decides which row is lit; any other tab still lights "Your channel".
    const tab = new URLSearchParams(query ?? "").get("tab")
    const currentTab = new URLSearchParams(location.search).get("tab")
    if (tab) return currentTab === tab
    return !(location.pathname === path && currentTab && TAB_ROWS.has(currentTab))
  }, [location.pathname, location.search])

  const profileBase = userProfile?.username ? `/profile/${encodeURIComponent(userProfile.username)}` : null
  const youNav: NavEntry[] = profileBase
    ? [
        { title: "Your channel", icon: SquareUserRound, href: profileBase },
        { title: "History", icon: History, href: `${profileBase}?tab=history` },
        { title: "Playlists", icon: ListVideo, href: "/playlist" },
        { title: "Liked videos", icon: ThumbsUp, href: `${profileBase}?tab=liked` },
        { title: "Your videos", icon: SquarePlay, href: "/brozystudio/posts" },
      ]
    : [{ title: "Playlists", icon: ListVideo, href: "/playlist" }]
  const moreNav: NavEntry[] = [
    ...(userId ? [{ title: "Settings", icon: Settings, href: "/settings" }] : []),
    { title: "Incoming features", icon: Sparkles, href: "/features/incoming" },
  ]
  const shownChannels = channelsOpen ? channels : channels.slice(0, CHANNELS_FOLDED)
  const signInHref = `/auth/login?redirect=${encodeURIComponent(location.pathname + location.search)}`

  return (
    <Sidebar variant="sidebar" collapsible={onWatch ? "offcanvas" : "icon"} className="bg-background border-none">
      {/* Header: logo. Matches the navbar's h-14 row, and px-6 puts the mark's
          left edge on the same line as the nav icons below it. */}
      <SidebarHeader
        className={cn(
          "p-0",
          isStandalone && "pt-[env(safe-area-inset-top)]",
          isWindapp && "windapp-drag",
          // Clear native Mac traffic lights (top-left).
          isWindapp && isMac && "pl-[52px] group-data-[collapsible=icon]:pl-0",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center px-6 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2",
            expandedDesktop && "mt-2",
            // Collapsed icon rail: leave vertical room under the traffic lights.
            isWindapp && isMac && "group-data-[collapsible=icon]:pt-6",
          )}
        >
          <Link
            to="/"
            id="home_button"
            className="group flex w-fit items-center gap-2.5 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center"
          >
            <Logo className="size-7 text-primary transition-transform duration-200 group-hover:scale-105" />
            <span className="text-xl font-bold tracking-tight text-foreground group-data-[collapsible=icon]:hidden">
              Memories
            </span>
          </Link>
        </div>
      </SidebarHeader>

      <SidebarContent className="overflow-x-hidden">
        {railMode ? (
          <nav className="flex flex-col gap-0.5 px-1 pt-1" aria-label="Main">
            {mainNav.map((entry) => (
              <RailLink key={entry.href} entry={entry} active={isActiveRoute(entry.href)} />
            ))}
            <RailLink entry={{ title: "You", icon: CircleUserRound, href: "/library" }} active={isActiveRoute("/library")} />
          </nav>
        ) : (
          <>
            <SidebarGroup className="p-3">
              <SidebarMenu>
                {mainNav.map((entry) => (
                  <EntryLink key={entry.href} entry={entry} active={isActiveRoute(entry.href)} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
            <SidebarSeparator className="mx-0" />

            {userId && channels.length > 0 ? (
              <>
                <SidebarGroup className="p-3">
                  <SectionHeading title="Subscriptions" href="/subscriptions" />
                  <SidebarMenu>
                    {shownChannels.map((channel) => {
                      const href = `/profile/${encodeURIComponent(channel.username)}`
                      return (
                        <SidebarMenuItem key={channel.username}>
                          <SidebarMenuButton
                            asChild
                            isActive={location.pathname === href}
                            tooltip={channel.username}
                            className={ENTRY}
                          >
                            <Link to={href} prefetch="intent">
                              <Avatar className="size-6 shrink-0">
                                <AvatarImage src={getProfilePicUrl(channel.profile_pic)} alt="" loading="lazy" />
                                <AvatarFallback className="text-[10px]">
                                  {channel.username.charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span>{channel.username}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )
                    })}
                    {channels.length > CHANNELS_FOLDED ? (
                      <SidebarMenuItem>
                        <SidebarMenuButton className={ENTRY} onClick={() => setChannelsOpen((open) => !open)}>
                          {channelsOpen ? <ChevronUp strokeWidth={1.75} /> : <ChevronDown strokeWidth={1.75} />}
                          <span>{channelsOpen ? "Show fewer" : "Show more"}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ) : null}
                  </SidebarMenu>
                </SidebarGroup>
                <SidebarSeparator className="mx-0" />
              </>
            ) : null}

            <SidebarGroup className="p-3">
              <SectionHeading title="You" href="/library" />
              <SidebarMenu>
                {youNav.map((entry) => (
                  <EntryLink key={entry.href} entry={entry} active={isActiveRoute(entry.href)} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
            <SidebarSeparator className="mx-0" />

            {!userId ? (
              <>
                <SidebarGroup className="gap-3 px-6 py-4">
                  <p className="text-sm text-sidebar-foreground">
                    Sign in to like videos, comment, and subscribe.
                  </p>
                  <Button asChild variant="outline" className="h-9 w-fit gap-2 rounded-full px-4">
                    <Link to={signInHref}>
                      <CircleUserRound className="size-5" strokeWidth={1.75} />
                      Sign in
                    </Link>
                  </Button>
                </SidebarGroup>
                <SidebarSeparator className="mx-0" />
              </>
            ) : null}

            <SidebarGroup className="p-3">
              <SidebarMenu>
                {moreNav.map((entry) => (
                  <EntryLink key={entry.href} entry={entry} active={isActiveRoute(entry.href)} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
            <SidebarSeparator className="mx-0" />

            <nav className="flex flex-wrap gap-x-2 gap-y-1 px-6 py-4 text-xs font-medium text-muted-foreground" aria-label="About">
              {footerLinks.map((link) => (
                <Link key={link.href} to={link.href} className="transition-colors hover:text-foreground">
                  {link.title}
                </Link>
              ))}
              <span className="w-full pt-2 font-normal">© {new Date().getFullYear()} Memories</span>
            </nav>
          </>
        )}
      </SidebarContent>

      {/* Account: the same profile menu as the navbar. The sidebar variant adds
          the username and counts when expanded (and in the mobile sheet), and
          shrinks to the avatar in the rail. */}
      <SidebarFooter className="border-t border-border/40 p-0">
        <DesktopUpdateSidebarCard />
        <div className="p-2">
          <UserProfileDropdown variant="sidebar" />
        </div>
      </SidebarFooter>

      {/* Grab handle at the edge: drag or click to reveal when collapsed. */}
      <SidebarRail />
    </Sidebar>
  )
}
