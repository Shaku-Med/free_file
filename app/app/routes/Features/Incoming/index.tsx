import React from "react";
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Roadmap and upcoming features | Memories",
    description:
      "See what we're building next at Memories: realtime collaboration, private chat, AI scripting, reels, and more. Check our roadmap and live features.",
    canonicalPath: "/features/incoming",
  });

const features = [
  {
    title: 'Realtime collaboration',
    description: 'Edit and review assets with teammates while seeing every change as it happens.',
    fulfilled: false
  },
  {
    title: `Realtime end-to-end encrypted private chat.`,
    description: 'Chat with your friends and family in real-time.',
    fulfilled: false
  },
  {
    title: 'AI-assisted scripting',
    description: 'Generate polished video scripts from briefs and adjust tone in one click.',
    fulfilled: false
  },
  {
    title: 'Reel and Personalized feeds.',
    description: 'Reels and personalized feeds based on your interests and preferences.',
    fulfilled: false
  },
  {
    title: 'NSFW content detection',
    description: 'Detect NSFW content in images and videos before publishing.',
    fulfilled: true
  },
  {
    title: `Live video transcription`,
    description: 'Transcribe live videos in real-time.',
    fulfilled: false
  },
  {
    title: `Commenting system`,
    description: 'Comment on videos and images.',
    fulfilled: true
  },
]

const Index = () => {
  return (
    <section className='min-h-[80vh] w-full px-6 py-20'>
      <div className='mx-auto flex max-w-3xl flex-col gap-10'>
        <div className='space-y-3 text-center'>
          <p className='text-xs uppercase tracking-[0.3em] text-primary'>Incoming</p>
          <h1 className='text-3xl font-semibold text-foreground'>What is on the way</h1>
          <p className='text-base text-muted-foreground'>A quick look at the roadmap and the features already live.</p>
        </div>
        <ul className='space-y-3'>
          {features.map(feature => (
            <li key={feature.title} className='flex items-start gap-4 rounded-2xl bg-secondary/30 p-6 transition hover:bg-secondary/50'>
              <div className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold ${feature.fulfilled ? 'bg-primary text-primary-foreground' : 'border-2 border-dashed border-muted-foreground/40 text-muted-foreground'}`}>
                {feature.fulfilled ? (
                  <svg viewBox='0 0 24 24' className='h-6 w-6' fill='none' stroke='currentColor' strokeWidth='2'>
                    <path d='M5 12l4 4 10-10' strokeLinecap='round' strokeLinejoin='round' />
                  </svg>
                ) : (
                  'Soon'
                )}
              </div>
              <div className='flex-1'>
                <p className='text-lg font-semibold text-foreground'>{feature.title}</p>
                <p className='text-sm text-muted-foreground'>{feature.description}</p>
              </div>
              <div className='text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
                {feature.fulfilled ? 'Live' : 'Building'}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default Index
