/**
 * Every icon in the app comes from here.
 *
 * The point is the indirection, not the pack. Before this, 129 files imported
 * straight from lucide-react, so changing icon sets meant editing all of them
 * and doing it again for the next change. Now a swap is this file.
 *
 * Names stay generic (Play, Pause, Pip) rather than pack specific (RiPlayFill),
 * so call sites never encode which library is underneath. Where a name matches
 * the old lucide one, the import line is the only thing that changes.
 *
 * Remix ships a Line and a Fill cut of most icons. Line is the resting state,
 * Fill reads as active, which is how the player marks state without changing
 * colour.
 *
 * Remix components accept className, so existing `h-5 w-5` sizing keeps
 * working. They are fill based rather than stroke based, so a strokeWidth prop
 * passes through and does nothing.
 */
export {
  // ── Transport ────────────────────────────────────────────────────────────
  RiPlayFill as Play,
  RiPauseFill as Pause,
  RiPlayCircleLine as PlayCircle,
  RiSkipForwardFill as SkipForward,
  RiSkipBackFill as SkipBack,
  RiSpeedUpLine as FastForward,
  RiRepeatLine as Repeat,
  RiStopLine as Square,
  // Digits are part of the glyph. Lucide had no equivalent, so the number used
  // to be composed next to a rotate icon.
  RiReplay10Line as Replay10,
  RiReplay15Line as Replay15,
  RiReplay30Line as Replay30,

  // ── Player chrome ────────────────────────────────────────────────────────
  RiFullscreenLine as Maximize,
  RiFullscreenExitLine as Minimize,
  RiPictureInPicture2Line as PictureInPicture2,
  // No exit-PiP glyph existed in lucide at all — one of the gaps that started
  // this switch.
  RiPictureInPictureExitLine as PipExit,
  RiLayoutBottomLine as PanelBottom,
  RiRectangleLine as RectangleHorizontal,
  RiRectangleLine as RectangleVertical,
  RiClosedCaptioningLine as Captions,
  RiClosedCaptioningFill as CaptionsOff,
  RiSettings3Line as Settings,
  RiDashboard3Line as Gauge,
  RiSignalTowerLine as Signal,

  // ── Audio ────────────────────────────────────────────────────────────────
  RiVolumeUpFill as Volume2,
  RiVolumeDownFill as Volume1,
  RiVolumeMuteFill as VolumeX,
  RiSpeakerLine as Speaker,
  RiHeadphoneLine as Headphones,
  RiSoundModuleLine as AudioWaveform,
  RiPulseLine as Activity,
  RiBarChart2Line as BarChart3,

  // ── Ambience / effects ───────────────────────────────────────────────────
  // Contrast-drop reads as "how much glow", closer to the idea than the
  // sun/brightness glyphs lucide made us borrow.
  RiContrastDropLine as Ambience,
  RiSparklingLine as Sparkles,
  RiSparkling2Line as PartyPopper,
  RiGlobeLine as Orbit,
  RiComputerLine as Monitor,
  RiMoonLine as Moon,

  // ── Generic UI ───────────────────────────────────────────────────────────
  RiMore2Fill as MoreVertical,
  RiMoreFill as MoreHorizontal,
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
  RiArrowUpSLine as ChevronUp,
  RiArrowDownSLine as ChevronDown,
  RiCloseLine as X,
  RiLoader4Line as LoaderCircle,
  RiLoader4Line as Loader2,
  RiCheckLine as Check,
  RiRestartLine as RotateCcw,
  RiErrorWarningLine as AlertTriangle,
  RiQuestionLine as CircleHelp,
  RiEyeOffLine as EyeOff,
  RiLockLine as Lock,
  RiLoginBoxLine as LogIn,
  RiBracesLine as Braces,
  RiAlignLeft as AlignLeft,
  RiAlignCenter as AlignCenter,
  RiAlignRight as AlignRight,
} from "@remixicon/react";
