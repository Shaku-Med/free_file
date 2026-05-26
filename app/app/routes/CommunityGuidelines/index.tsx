import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";
import {
  LegalContactCard,
  LegalDocumentLayout,
  LegalLink,
  LegalP,
  LegalSection,
  LegalUL,
  type LegalTocItem,
} from "~/components/legal/LegalDocumentLayout";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Community Guidelines | Memories",
    description:
      "Memories community guidelines: what's allowed, what's not, and how reporting and enforcement work.",
    canonicalPath: "/community-guidelines",
  });

const TOC: LegalTocItem[] = [
  { id: "zero-tolerance", label: "Zero tolerance" },
  { id: "not-allowed", label: "Not allowed" },
  { id: "mature-content", label: "Mature content" },
  { id: "reporting", label: "Reporting" },
  { id: "enforcement", label: "Enforcement" },
  { id: "changes", label: "Changes" },
];

export default function CommunityGuidelinesPage() {
  return (
    <LegalDocumentLayout
      activeNav="guidelines"
      title="Community Guidelines"
      summary="What's allowed on Memories, what's not, and how reporting and enforcement work."
      toc={TOC}
    >
      <LegalP>
        Memories is a place to share videos and photos with other people. These
        guidelines, together with our{" "}
        <LegalLink to="/terms">Terms of Service</LegalLink>, set the rules for
        what&apos;s allowed. Breaking these rules can lead to content removal,
        restrictions, or account termination.
      </LegalP>

      <LegalSection id="zero-tolerance" title="Zero-tolerance: instant ban + reported to authorities">
        <LegalUL>
          <li>
            <strong className="text-foreground">Child sexual abuse material (CSAM)</strong> or any
            sexualization of minors — reported to NCMEC and law enforcement
          </li>
          <li>Threats of imminent violence or serious self-harm</li>
          <li>Terrorist content or recruitment material</li>
          <li>Non-consensual intimate imagery (&quot;revenge porn&quot;)</li>
          <li>Doxxing — publishing private information to target someone</li>
          <li>Distribution of malware or active phishing</li>
        </LegalUL>
      </LegalSection>

      <LegalSection id="not-allowed" title="Not allowed">
        <LegalUL>
          <li>
            Content you don&apos;t own or have permission to share — including
            copyrighted videos, music, footage, and other people&apos;s photos
          </li>
          <li>Hate speech, slurs, or targeted harassment of any individual or group</li>
          <li>Graphic violence or gore meant to shock rather than inform</li>
          <li>Promotion of illegal goods or services, fraud, or scams</li>
          <li>Sexual content involving real people without their explicit consent</li>
          <li>Impersonation of another person or organization</li>
          <li>Spam, deceptive engagement, view manipulation, or coordinated inauthentic behavior</li>
          <li>Posting other users&apos; private information without consent</li>
        </LegalUL>
      </LegalSection>

      <LegalSection id="mature-content" title="Mature content">
        <LegalP>
          Some content is allowed only behind an age gate and clearly tagged.
          Mature content must never sexualize minors, depict non-consensual acts,
          or violate any law. We may remove mature content at our discretion.
        </LegalP>
      </LegalSection>

      <LegalSection id="reporting" title="Reporting">
        <LegalP>
          Use the report button on any video, comment, or profile. For copyright
          complaints use our <LegalLink to="/dmca">DMCA process</LegalLink>. For urgent safety
          issues email abuse@memories.brozy.org. For threats to life, contact local
          emergency services first.
        </LegalP>
      </LegalSection>

      <LegalSection id="enforcement" title="Enforcement">
        <LegalP>
          We may remove content, restrict features, hide content from
          recommendations, demonetize, or suspend / terminate accounts depending
          on severity. We track strikes per account and terminate repeat
          violators. Decisions can be appealed by emailing appeals@memories.brozy.org
          with your account email and the affected content link.
        </LegalP>
      </LegalSection>

      <LegalSection id="changes" title="Changes">
        <LegalP>
          We update these guidelines as the platform evolves. Material changes
          will be announced in the app or by email.
        </LegalP>
      </LegalSection>

      <LegalContactCard>
        Appeals: appeals@memories.brozy.org · Abuse: abuse@memories.brozy.org
      </LegalContactCard>
    </LegalDocumentLayout>
  );
}
