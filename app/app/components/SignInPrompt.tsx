import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useFileContext } from "~/lib/Context/Context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { LogIn, UserPlus, Upload, Heart, Bell, MessageCircle, Sparkles } from "lucide-react";

const PROMPTS = [
  {
    title: "Join the community",
    description: "Sign in to upload your own videos, follow creators you love, and build your personal feed.",
    icon: Upload,
    accent: "text-blue-500",
  },
  {
    title: "Never miss a moment",
    description: "Get notified when your favorite creators post something new. Sign in to turn on notifications.",
    icon: Bell,
    accent: "text-amber-500",
  },
  {
    title: "Show some love",
    description: "Like, comment, and save the videos you enjoy. Sign in to interact with the community.",
    icon: Heart,
    accent: "text-rose-500",
  },
  {
    title: "Join the conversation",
    description: "Have something to say? Sign in to leave comments and connect with other viewers.",
    icon: MessageCircle,
    accent: "text-emerald-500",
  },
  {
    title: "Unlock the full experience",
    description: "Playlists, subscriptions, upload history, and more. Create a free account to get started.",
    icon: Sparkles,
    accent: "text-violet-500",
  },
];

const SESSION_KEY = "signin_prompt_ts";
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 45_000;
const RECURRING_MIN_MS = 90_000;
const RECURRING_MAX_MS = 240_000;

const AUTH_PATHS = ["/auth", "/logout"];

export default function SignInPrompt() {
  const { userId } = useFileContext();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(PROMPTS[0]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownOnceRef = useRef(false);

  const isAuthRoute = AUTH_PATHS.some((p) => location.pathname.startsWith(p));

  const pickPrompt = useCallback(() => {
    setPrompt(PROMPTS[Math.floor(Math.random() * PROMPTS.length)]);
  }, []);

  const canShow = useCallback(() => {
    if (typeof window === "undefined") return false;
    try {
      const last = sessionStorage.getItem(SESSION_KEY);
      if (last && Date.now() - Number(last) < MIN_INTERVAL_MS) return false;
    } catch { /* SSR or storage blocked */ }
    return true;
  }, []);

  const show = useCallback(() => {
    if (userId || isAuthRoute || !canShow()) return;
    pickPrompt();
    setOpen(true);
    try { sessionStorage.setItem(SESSION_KEY, String(Date.now())); } catch {}
  }, [userId, isAuthRoute, canShow, pickPrompt]);

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const delay = shownOnceRef.current
      ? RECURRING_MIN_MS + Math.random() * (RECURRING_MAX_MS - RECURRING_MIN_MS)
      : INITIAL_DELAY_MS;
    timerRef.current = setTimeout(() => {
      show();
      shownOnceRef.current = true;
      scheduleNext();
    }, delay);
  }, [show]);

  useEffect(() => {
    if (userId || isAuthRoute) {
      setOpen(false);
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    scheduleNext();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [userId, isAuthRoute, scheduleNext]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (userId) return null;

  const Icon = prompt.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm gap-5">
        <DialogHeader className="items-center text-center gap-3">
          <div className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted ${prompt.accent}`}>
            <Icon className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <DialogTitle className="text-lg">{prompt.title}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            {prompt.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button asChild className="w-full gap-2" size="lg">
            <Link to="/auth/login" onClick={() => setOpen(false)}>
              <LogIn className="h-4 w-4" />
              Sign In
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full gap-2" size="lg">
            <Link to="/auth/signup" onClick={() => setOpen(false)}>
              <UserPlus className="h-4 w-4" />
              Create Account
            </Link>
          </Button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Maybe later
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
