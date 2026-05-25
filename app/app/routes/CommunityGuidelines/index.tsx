import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Community Guidelines | Memories",
    description:
      "Memories community guidelines: what's allowed, what's not, and how reporting and enforcement work.",
    canonicalPath: "/community-guidelines",
  });

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-lg font-semibold text-foreground mb-2 mt-6">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{children}</p>
);
const UL = ({ children }: { children: React.ReactNode }) => (
  <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground mb-3">
    {children}
  </ul>
);

export default function CommunityGuidelinesPage() {
  return (
    <article className="max-w-3xl py-8 mandatory_select">
      <h1 className="text-2xl font-semibold text-foreground mb-2">Community Guidelines</h1>
      <p className="text-xs text-muted-foreground mb-6">
        Effective date: {new Date().toLocaleDateString()}
      </p>

      <P>
        Memories is a place to share videos and photos with other people. These
        guidelines, together with our{" "}
        <a className="text-primary underline" href="/terms">
          Terms of Service
        </a>
        , set the rules for what's allowed. Breaking these rules can lead to
        content removal, restrictions, or account termination.
      </P>

      <SectionTitle>Zero-tolerance: instant ban + reported to authorities</SectionTitle>
      <UL>
        <li>
          <strong>Child sexual abuse material (CSAM)</strong> or any
          sexualization of minors  reported to NCMEC and law enforcement
        </li>
        <li>Threats of imminent violence or serious self-harm</li>
        <li>Terrorist content or recruitment material</li>
        <li>Non-consensual intimate imagery ("revenge porn")</li>
        <li>Doxxing  publishing private information to target someone</li>
        <li>Distribution of malware or active phishing</li>
      </UL>

      <SectionTitle>Not allowed</SectionTitle>
      <UL>
        <li>
          Content you don't own or have permission to share  including
          copyrighted videos, music, footage, and other people's photos
        </li>
        <li>Hate speech, slurs, or targeted harassment of any individual or group</li>
        <li>Graphic violence or gore meant to shock rather than inform</li>
        <li>Promotion of illegal goods or services, fraud, or scams</li>
        <li>
          Sexual content involving real people without their explicit consent
        </li>
        <li>Impersonation of another person or organization</li>
        <li>
          Spam, deceptive engagement, view manipulation, or coordinated
          inauthentic behavior
        </li>
        <li>Posting other users' private information without consent</li>
      </UL>

      <SectionTitle>Mature content</SectionTitle>
      <P>
        Some content is allowed only behind an age gate and clearly tagged.
        Mature content must never sexualize minors, depict non-consensual acts,
        or violate any law. We may remove mature content at our discretion.
      </P>

      <SectionTitle>Reporting</SectionTitle>
      <P>
        Use the report button on any video, comment, or profile. For copyright
        complaints use our{" "}
        <a className="text-primary underline" href="/dmca">
          DMCA process
        </a>
        . For urgent safety issues email abuse@memories.brozy.org. For threats
        to life, contact local emergency services first.
      </P>

      <SectionTitle>Enforcement</SectionTitle>
      <P>
        We may remove content, restrict features, hide content from
        recommendations, demonetize, or suspend / terminate accounts depending
        on severity. We track strikes per account and terminate repeat
        violators. Decisions can be appealed by emailing
        appeals@memories.brozy.org with your account email and the affected
        content link.
      </P>

      <SectionTitle>Changes</SectionTitle>
      <P>
        We update these guidelines as the platform evolves. Material changes
        will be announced in the app or by email.
      </P>
    </article>
  );
}
