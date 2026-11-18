// What's new in Studio. Newest first; edit freely when something ships.

export interface StudioNewsItem {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  body: string;
  link?: { label: string; to: string };
}

export const STUDIO_NEWS: StudioNewsItem[] = [
  {
    id: "dashboard",
    date: "2026-11-17",
    title: "A new Studio dashboard",
    body: "Your latest post, channel numbers, uploads and ideas now sit on one page. The newest post is measured against how your posts usually do in the same number of days.",
  },
  {
    id: "upload-fit",
    date: "2026-11-17",
    title: "Uploads that fit now go through",
    body: "If a file fits in what's left of your monthly upload space, it uploads, even when processing makes it bigger. It just uses up the rest of the month.",
    link: { label: "Check your space", to: "/settings" },
  },
  {
    id: "stable-volume",
    date: "2026-05-11",
    title: "Even out loud and quiet moments",
    body: "Turn on Stable volume in the player settings and quiet scenes stop needing the volume button.",
  },
];
