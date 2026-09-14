// Tells uploaders how to split a video into sections from its description.
// Matches the rules in parseChapters.
export function SectionsHint() {
  return (
    <p className="text-[11px] leading-snug text-muted-foreground">
      Split your video into sections: put a time and a title on each line, starting at{" "}
      <span className="font-mono text-foreground/80">0:00 Intro</span>. Use 3 to 100 sections, each 10 seconds or
      longer.
    </p>
  );
}
