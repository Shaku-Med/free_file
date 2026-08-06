import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MetaFunction } from "react-router";
import {
  // Apple, // Mac download card commented out until we ship a Mac build
  ArrowUpRight,
  Check,
  Monitor,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { buildPageMeta } from "~/lib/seo";
import { useWindapp } from "~/lib/hooks/useWindapp";
import { useStandalone } from "~/lib/hooks/useStandalone";
import { cn } from "~/lib/utils";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Download | Memories",
    description:
      "Get Memories on your computer or add it to your phone home screen.",
    canonicalPath: "/download",
  });

const DESKTOP_RELEASES_URL = "/api/desktop/win/download";

type DeviceKind = "windows" | "mac" | "ios" | "android" | "linux" | "other";

function detectDevice(): DeviceKind {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";

  if (/iPhone|iPad|iPod/i.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  if (/Android/i.test(ua)) return "android";
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return "mac";
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return "linux";
  return "other";
}

/**
 * Windows SmartScreen walkthrough.
 *
 * The installer is unsigned, so Windows hides "Run anyway" behind an
 * understated "More info" link. Nothing on our side removes that, so show
 * people what they are about to see and where to click.
 */
function WindowsInstallSteps() {
  const steps = [
    {
      title: "Run the file you downloaded",
      body: "It lands in your Downloads folder as Memories Setup.",
    },
    {
      title: 'Windows says "Windows protected your PC"',
      body: "This appears for every app without a paid signing certificate. Click More info, the small link under the message.",
    },
    {
      title: 'Choose "Run anyway"',
      body: "The button appears once More info is open. Memories installs normally from there.",
    },
  ];

  return (
    <div className="flex flex-1 flex-col p-6 sm:p-7">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="h-5 w-5 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          If Windows shows a warning
        </h2>
      </div>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
        Memories is safe. Windows shows this for any app without a paid signing
        certificate, which we do not have yet. Here is how to get past it.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_auto] lg:gap-8">
        <ol className="space-y-4">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3.5">
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                aria-hidden
              >
                {i + 1}
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">{step.title}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>

        <div
          className="w-full max-w-sm select-none overflow-hidden rounded-xl border border-border bg-background shadow-sm lg:w-80"
          aria-hidden
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Windows protected your PC</p>
          </div>
          <div className="space-y-3 px-4 py-3.5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Microsoft Defender SmartScreen prevented an unrecognised app from
              starting. Running this app might put your PC at risk.
            </p>
            <p className="text-xs font-medium text-primary underline underline-offset-2">
              More info
            </p>
            <div className="flex justify-end pt-1">
              <span className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                Don&apos;t run
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Prefer not to install anything? Open Memories in Edge or Chrome and use
        Install from the address bar. It runs in its own window with no download.
      </p>
    </div>
  );
}

function BentoCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[1.75rem] border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

function InstallLink({
  href,
  children,
  solid,
  /** For /api/desktop/* — HEAD-check first so error JSON is never saved as a junk file. */
  verifyDesktopDownload,
}: {
  href: string;
  children: ReactNode;
  solid?: boolean;
  verifyDesktopDownload?: boolean;
}) {
  const external = /^https?:\/\//i.test(href);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const className = cn(
    "inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors",
    solid
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : "border border-border bg-background text-foreground hover:bg-muted",
    busy && "pointer-events-none opacity-70",
  );

  if (verifyDesktopDownload) {
    return (
      <span className="inline-flex flex-col items-start gap-1.5">
        <button
          type="button"
          disabled={busy}
          className={className}
          onClick={() => {
            void (async () => {
              setError(null);
              setBusy(true);
              try {
                const head = await fetch(href, { method: "HEAD", credentials: "same-origin" });
                if (!head.ok) {
                  const fromHeader = head.headers.get("X-Desktop-Error");
                  let message =
                    fromHeader ||
                    "We didn't find a build to download. Nothing has been published yet.";
                  if (!fromHeader) {
                    try {
                      const full = await fetch(href, { method: "GET", credentials: "same-origin" });
                      const ct = full.headers.get("content-type") || "";
                      if (ct.includes("application/json")) {
                        const body = (await full.json()) as { error?: string };
                        if (body?.error) message = body.error;
                      }
                    } catch {
                      /* keep default message */
                    }
                  }
                  setError(message);
                  return;
                }
                // Real file — navigate so the browser streams the attachment (not a blob in RAM).
                window.location.assign(href);
              } catch {
                setError("Couldn't reach the download server. Please try again.");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {busy ? "Checking…" : children}
        </button>
        {error ? (
          <span className="max-w-xs text-xs text-destructive" role="alert">
            {error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : { download: true })}
      className={className}
    >
      {children}
      {external ? <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> : null}
    </a>
  );
}

/** Soft fake window chrome for the desktop bento visual. */
function DesktopPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md select-none" aria-hidden>
      <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
          <span className="ml-2 flex-1 truncate rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">
            Memories
          </span>
        </div>
        <div className="grid grid-cols-[56px_1fr] gap-0">
          <div className="flex flex-col items-center gap-3 border-r border-border py-3">
            <div className="h-6 w-6 rounded-full bg-muted" />
            <div className="h-5 w-5 rounded-md bg-muted" />
            <div className="h-5 w-5 rounded-md bg-muted" />
            <div className="mt-auto h-6 w-6 rounded-full bg-muted" />
          </div>
          <div className="space-y-2.5 p-3">
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="aspect-video bg-muted" />
                  <div className="space-y-1.5 p-2">
                    <div className="h-1.5 w-4/5 rounded bg-muted-foreground/25" />
                    <div className="h-1.5 w-2/5 rounded bg-muted-foreground/15" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhonePreview() {
  return (
    <div className="relative mx-auto w-[148px] select-none sm:w-[168px]" aria-hidden>
      <div className="overflow-hidden rounded-[1.6rem] border border-border bg-background shadow-sm">
        <div className="mx-auto mt-2 h-1.5 w-16 rounded-full bg-muted" />
        <div className="space-y-2 p-2.5 pt-3">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="aspect-[9/14] bg-muted" />
          </div>
          <div className="flex justify-around px-1 pb-1">
            <div className="h-1.5 w-1.5 rounded-full bg-foreground/40" />
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DownloadPage() {
  const isWindapp = useWindapp();
  const isStandalone = useStandalone();
  const [device, setDevice] = useState<DeviceKind>("other");

  useEffect(() => {
    setDevice(detectDevice());
  }, []);

  useEffect(() => {
    const id = "memories-download-serif";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap";
    document.head.appendChild(link);
  }, []);

  const isMobile = device === "ios" || device === "android";

  const headline = useMemo(() => {
    if (isWindapp) return "You already have Memories open";
    if (isStandalone) return "Memories is on your home screen";
    return "Memories, wherever you are";
  }, [isWindapp, isStandalone]);

  const sub = useMemo(() => {
    if (isWindapp) {
      return "You are all set on this computer. Grab it for another device anytime below.";
    }
    if (isStandalone) {
      return "Nice. Opened from your home screen. Share this page if someone else wants it too.";
    }
    return "Install it on your computer, or put it on your phone home screen.";
  }, [isWindapp, isStandalone]);

  const phoneSteps =
    device === "ios"
      ? [
          { title: "Open in Safari", body: "This works best in Safari." },
          { title: "Tap Share", body: "The square with the arrow at the bottom." },
          { title: "Add to Home Screen", body: "Confirm, and you are done." },
        ]
      : device === "android"
        ? [
            { title: "Open in Chrome", body: "Use Chrome on your phone." },
            { title: "Open the menu", body: "Tap the three dots up top." },
            { title: "Add to Home screen", body: "Install or add, then confirm." },
          ]
        : [
            { title: "iPhone", body: "Safari → Share → Add to Home Screen." },
            { title: "Android", body: "Chrome → menu → Add to Home screen." },
          ];

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden text-foreground">
      <div className="relative mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-10 text-center sm:mb-14">
          <h1
            className="text-balance text-3xl leading-tight tracking-tight text-foreground sm:text-5xl"
            style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
          >
            {headline}
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
            {sub}
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
          <BentoCard className="md:col-span-2">
            <div className="grid items-center gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_1.05fr] lg:gap-10 lg:p-10">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  Desktop
                </h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Your own Memories window on Windows. Stay in the flow without digging through
                  browser tabs.
                </p>
                {isWindapp ? (
                  <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
                    <Check className="h-4 w-4 text-muted-foreground" aria-hidden />
                    Running on this computer
                  </div>
                ) : (
                  <div className="mt-5 flex flex-wrap gap-2">
                    <InstallLink href={DESKTOP_RELEASES_URL} solid verifyDesktopDownload>
                      Install
                    </InstallLink>
                  </div>
                )}
              </div>
              <div className="min-w-0 lg:pl-2">
                <DesktopPreview />
              </div>
            </div>
          </BentoCard>

          <BentoCard className="flex flex-col md:col-span-2">
            <div className="flex flex-1 flex-col p-6 sm:p-7">
              <div className="flex items-center gap-2.5">
                <Monitor className="h-5 w-5 text-muted-foreground" aria-hidden />
                <h2 className="text-lg font-semibold tracking-tight text-foreground">Windows</h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Download the installer and put Memories on your PC in a minute.
              </p>
              <div className="mt-5">
                <InstallLink href={DESKTOP_RELEASES_URL} verifyDesktopDownload>Install</InstallLink>
              </div>
              <div className="mt-8 flex flex-1 items-end">
                <div className="w-full overflow-hidden rounded-xl border border-border bg-background p-3">
                  <div className="mb-2 flex gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="aspect-video rounded-md bg-muted" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </BentoCard>

          <BentoCard className="md:col-span-2">
            <WindowsInstallSteps />
          </BentoCard>

          {/* Mac build needs a Mac to compile — hide until we ship one.
          <BentoCard className="flex flex-col">
            <div className="flex flex-1 flex-col p-6 sm:p-7">
              <div className="flex items-center gap-2.5">
                <Apple className="h-5 w-5 text-muted-foreground" aria-hidden />
                <h2 className="text-lg font-semibold tracking-tight text-foreground">Mac</h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Works on MacBook and desktop Macs. Same Memories, in its own window.
              </p>
              <div className="mt-5">
                <InstallLink href={DESKTOP_RELEASES_URL} verifyDesktopDownload>Install</InstallLink>
              </div>
              <div className="mt-8 flex flex-1 items-end">
                <div className="w-full overflow-hidden rounded-xl border border-border bg-background p-3">
                  <div className="mb-2 flex gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-2 w-3/5 rounded bg-muted" />
                    <div className="h-16 rounded-lg bg-muted" />
                    <div className="h-2 w-2/5 rounded bg-muted" />
                  </div>
                </div>
              </div>
            </div>
          </BentoCard>
          */}

          <BentoCard className="md:col-span-2">
            <div className="grid items-center gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:gap-12 lg:p-10">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <Smartphone className="h-5 w-5 text-muted-foreground" aria-hidden />
                  <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                    Phone and tablet
                  </h2>
                </div>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {isStandalone
                    ? "You already opened Memories from the home screen on this device."
                    : isMobile
                      ? "No store app yet. Add it to your home screen and it opens like any other app."
                      : "Add Memories to your home screen for a quick full screen shortcut."}
                </p>

                {!isStandalone ? (
                  <ol className="mt-6 space-y-4">
                    {phoneSteps.map((step, i) => (
                      <li key={step.title} className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                          {i + 1}
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <p className="text-sm font-medium text-foreground">{step.title}</p>
                          <p className="mt-0.5 text-sm text-muted-foreground">{step.body}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
                    <Check className="h-4 w-4 text-muted-foreground" aria-hidden />
                    On your home screen
                  </div>
                )}
              </div>
              <div className="flex justify-center lg:pr-4">
                <PhonePreview />
              </div>
            </div>
          </BentoCard>

          {device === "linux" && !isWindapp ? (
            <BentoCard className="md:col-span-2">
              <div className="p-6 sm:p-8">
                <h2 className="text-lg font-semibold text-foreground">Linux</h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  We do not have a Linux installer yet. Keep using Memories in your browser for
                  now.
                </p>
              </div>
            </BentoCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
