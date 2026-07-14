export type MediaKind = "video" | "reel" | "image";

export type MediaItem = {
  id: string;
  title: string;
  creator: string;
  views: string;
  age: string;
  duration?: string;
  kind: MediaKind;
  progress?: number;
  hue: number;
};

export type NavId =
  | "home"
  | "subscriptions"
  | "reels"
  | "library"
  | "playlists"
  | "studio"
  | "watch";

export const NAV_ITEMS: { id: NavId; label: string; hint?: string }[] = [
  { id: "home", label: "Home" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "reels", label: "Reels" },
  { id: "library", label: "Library" },
  { id: "playlists", label: "Playlists" },
  { id: "studio", label: "Brozy Studio", hint: "Create" },
];

export const HOME_CHIPS = [
  "All",
  "For you",
  "Music",
  "Gaming",
  "Film",
  "Art",
  "Nature",
  "Tech",
] as const;

export const FEED_ITEMS: MediaItem[] = [
  {
    id: "1",
    title: "Golden hour on the coast road",
    creator: "mira.lens",
    views: "128K",
    age: "2 days ago",
    duration: "12:41",
    kind: "video",
    hue: 28,
  },
  {
    id: "2",
    title: "Late studio session — drums only",
    creator: "knox.audio",
    views: "41K",
    age: "5 hours ago",
    duration: "0:48",
    kind: "reel",
    hue: 210,
  },
  {
    id: "3",
    title: "Tokyo rain reflections",
    creator: "yuki.frames",
    views: "890K",
    age: "1 week ago",
    duration: "8:02",
    kind: "video",
    hue: 250,
  },
  {
    id: "4",
    title: "Kitchen experiments: citrus glaze",
    creator: "nova.bites",
    views: "62K",
    age: "3 days ago",
    duration: "18:20",
    kind: "video",
    hue: 55,
  },
  {
    id: "5",
    title: "Board flip compilation #4",
    creator: "skate.arc",
    views: "210K",
    age: "Yesterday",
    duration: "0:32",
    kind: "reel",
    hue: 340,
  },
  {
    id: "6",
    title: "Quiet library mornings",
    creator: "calm.rooms",
    views: "19K",
    age: "4 days ago",
    kind: "image",
    hue: 180,
  },
  {
    id: "7",
    title: "Building a desk from scrap wood",
    creator: "forge.home",
    views: "305K",
    age: "2 weeks ago",
    duration: "24:11",
    kind: "video",
    hue: 18,
  },
  {
    id: "8",
    title: "Night drive — empty highways",
    creator: "volt.motion",
    views: "77K",
    age: "6 hours ago",
    duration: "1:05",
    kind: "reel",
    hue: 265,
  },
  {
    id: "9",
    title: "Film stills from last summer",
    creator: "amber.roll",
    views: "12K",
    age: "3 weeks ago",
    kind: "image",
    hue: 42,
  },
  {
    id: "10",
    title: "How we lit the warehouse set",
    creator: "stage.light",
    views: "54K",
    age: "5 days ago",
    duration: "15:33",
    kind: "video",
    hue: 200,
  },
  {
    id: "11",
    title: "Coffee pour under soft light",
    creator: "brew.still",
    views: "9.4K",
    age: "1 day ago",
    duration: "0:27",
    kind: "reel",
    hue: 15,
  },
  {
    id: "12",
    title: "Episode 3 — The Harbor",
    creator: "north.series",
    views: "1.2M",
    age: "1 month ago",
    duration: "42:08",
    kind: "video",
    progress: 0.62,
    hue: 195,
  },
];

export const CONTINUE_WATCHING = FEED_ITEMS.filter((i) => i.progress || i.kind === "video").slice(0, 5);

export const LIBRARY_SECTIONS = [
  { title: "Continue watching", items: CONTINUE_WATCHING },
  { title: "Liked", items: FEED_ITEMS.slice(0, 4) },
  { title: "Saved", items: FEED_ITEMS.slice(4, 8) },
] as const;

export const PLAYLISTS = [
  { id: "p1", title: "Sunday focus", count: 18, hue: 220 },
  { id: "p2", title: "Travel drafts", count: 7, hue: 35 },
  { id: "p3", title: "Series to finish", count: 11, hue: 170 },
  { id: "p4", title: "Sound references", count: 24, hue: 300 },
];

export const STUDIO_POSTS = FEED_ITEMS.slice(0, 6).map((item, i) => ({
  ...item,
  status: i % 3 === 0 ? "Processing" : "Published",
  likes: `${12 + i * 7}K`,
  comments: `${40 + i * 11}`,
}));

export const RELATED = FEED_ITEMS.slice(2, 8);
