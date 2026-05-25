import React from "react";
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Roadmap | Memories",
    description:
      "What's done and what we're working on next at Memories.",
    canonicalPath: "/features/incoming",
  });

type Status = "shipped" | "building" | "next";

interface Feature {
  title: string;
  description: string;
  status: Status;
}

const features: Feature[] = [
  // Shipped
  {
    title: "Captions, the good kind",
    description:
      "Upload a .vtt or type one out in a notebook-style editor. Drag the text wherever it looks best on the player. 30+ languages.",
    status: "shipped",
  },
  {
    title: "VR tilt mode",
    description:
      "Grab the video and orbit it in 3D. Pinch to zoom, shift-drag to skew. A bit of a toy, surprisingly useful.",
    status: "shipped",
  },
  {
    title: "Ambient mode",
    description:
      "The colors of the playing frame glow behind the player. Falls back to a softer gradient when hardware acceleration is off, so it doesn't melt your laptop.",
    status: "shipped",
  },
  {
    title: "Stable volume",
    description:
      "Loud clip, quiet clip, same room volume. No more reaching for the slider every two videos.",
    status: "shipped",
  },
  {
    title: "Sleep timer",
    description:
      "Pause in 10, 30, 60 minutes or at the end of the current video. Watching from bed, sorted.",
    status: "shipped",
  },
  {
    title: "Skip Intro and Next Episode",
    description:
      "Owners drop markers on their own videos. Viewers get a clean Netflix-style overlay during the right window. Works for short reels and three-hour movies alike.",
    status: "shipped",
  },
  {
    title: "Personalized reels and feed",
    description:
      "Smart ranking that blends fresh, trending, and stuff you might actually like.",
    status: "shipped",
  },
  {
    title: "Floating mini player",
    description:
      "Keep watching while you browse. Drag it where you want, swipe to skip, never drops audio on transitions.",
    status: "shipped",
  },
  {
    title: "Series and episodes",
    description:
      "Group videos, name episodes, get up-next and resume-where-you-left-off for free.",
    status: "shipped",
  },
  {
    title: "Watch progress that actually remembers",
    description:
      "Open a video weeks later. Pick up exactly where you stopped. Progress bar on every thumbnail.",
    status: "shipped",
  },
  {
    title: "Nested comments",
    description:
      "Replies, likes, owner moderation, per-video comment limits. Threads connect to their parent yes, we noticed.",
    status: "shipped",
  },
  {
    title: "NSFW detection",
    description:
      "Vision check runs before publishing. Flagged content stays out of feeds and search.",
    status: "shipped",
  },
  {
    title: "Push notifications",
    description:
      "Replies, mentions, new uploads from creators you follow.",
    status: "shipped",
  },
  {
    title: "Faster everything",
    description:
      "Smarter caching on the client and server so pages and playback feel snappier, with far fewer redundant requests per watch session.",
    status: "shipped",
  },

  // Building
  {
    title: "Live streaming",
    description:
      "Go live to your followers. Same player you already know, just live.",
    status: "building",
  },
  {
    title: "Live transcription",
    description:
      "Real-time captions on live streams, in whatever language the viewer picked.",
    status: "building",
  },
  {
    title: "Real-time chat",
    description:
      "Talk during streams. End-to-end encrypted DMs for one-on-one threads.",
    status: "building",
  },
  {
    title: "AI content analyzer",
    description:
      "Auto-tags, summaries, chapter markers, and recommendations from your upload.",
    status: "building",
  },
  {
    title: "Realtime collaboration",
    description:
      "Edit captions, descriptions, series metadata together everyone sees changes the moment they happen.",
    status: "building",
  },
  {
    title: "UI polish",
    description:
      "Less rough edges across control bars, dropdowns, and touch targets. Ongoing.",
    status: "building",
  },

  // Next
  {
    title: "AI subtitle generation",
    description:
      "Upload, get captions in seconds. Whisper-quality, basically free to run.",
    status: "next",
  },
  {
    title: "One-click caption translation",
    description:
      "Have English? Click → Spanish, French, Japanese, everything else.",
    status: "next",
  },
  {
    title: "Watch parties",
    description:
      "Invite friends, watch in sync. Play, pause, seek everyone moves together.",
    status: "next",
  },
  {
    title: "Music recognition",
    description:
      "Identify songs inside uploaded videos. Title, artist, the streaming links. A sound page for every track.",
    status: "next",
  },
  {
    title: "Content origin detection",
    description:
      "Find where a video first appeared on the web. Auto-credit the creator, flag re-uploads.",
    status: "next",
  },
  {
    title: "Creator analytics",
    description:
      "Watch time, retention curves, where viewers come from. Useful, not overwhelming.",
    status: "next",
  },
];

const SECTIONS: { status: Status; heading: string; note: string }[] = [
  {
    status: "shipped",
    heading: "Already live",
    note: "Stuff you can use today.",
  },
  {
    status: "building",
    heading: "Working on it",
    note: "Started, not done.",
  },
  {
    status: "next",
    heading: "Up next",
    note: "Picking these up after the current batch.",
  },
];

function StatusDot({ status }: { status: Status }) {
  if (status === "shipped") {
    return <span aria-hidden className="mt-[0.55rem] size-2 shrink-0 rounded-full bg-primary" />;
  }
  if (status === "building") {
    return (
      <span
        aria-hidden
        className="mt-[0.55rem] size-2 shrink-0 rounded-full border border-primary bg-transparent"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="mt-[0.55rem] size-2 shrink-0 rounded-full border border-dashed border-muted-foreground/60 bg-transparent"
    />
  );
}

const Index = () => {
  const sections = SECTIONS.map((section) => ({
    ...section,
    items: features.filter((f) => f.status === section.status),
  }));

  return (
    <section className="min-h-[80vh] w-full ">
      <div className="mx-auto flex max-w-2xl flex-col gap-14">
        <header className="space-y-3">
          <p className="text-sm text-muted-foreground">Roadmap</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            What's done, what's next.
          </h1>
          <p className="text-base leading-relaxed text-muted-foreground">
            A snapshot of where Memories is at. We try to keep this honest the
            stuff up top actually works, the middle stuff is in flight, and the
            bottom is what we're thinking about for the next stretch.
          </p>
        </header>

        {sections.map((section) => (
          <div key={section.status} className="space-y-5">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">
                {section.heading}
              </h2>
              <p className="text-sm text-muted-foreground">{section.note}</p>
            </div>
            <ul className="divide-y divide-border border-y border-border">
              {section.items.map((feature) => (
                <li
                  key={feature.title}
                  className="flex items-start gap-3 py-4 sm:gap-4 sm:py-5"
                >
                  <StatusDot status={feature.status} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground sm:text-base">
                      {feature.title}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <p className="text-sm leading-relaxed text-muted-foreground">
          If there's something you want and you don't see it here leave a
          comment on any video or send a note from your settings page. We
          actually read them.
        </p>
      </div>
    </section>
  );
};

export default Index;
