import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";
import {
  LegalContactCard,
  LegalDocumentLayout,
  LegalP,
  LegalSection,
  LegalUL,
  type LegalTocItem,
} from "~/components/legal/LegalDocumentLayout";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Privacy Policy | Memories",
    description:
      "How Memories collects, uses, and protects your information. GDPR / CCPA rights, data retention, cookies, and contact details.",
    canonicalPath: "/privacy",
  });

const TOC: LegalTocItem[] = [
  { id: "information-we-collect", label: "Information we collect" },
  { id: "how-we-use", label: "How we use it" },
  { id: "legal-bases", label: "Legal bases" },
  { id: "how-we-share", label: "How we share" },
  { id: "data-retention", label: "Data retention" },
  { id: "your-rights", label: "Your rights" },
  { id: "children", label: "Children's privacy" },
  { id: "security", label: "Security" },
  { id: "international", label: "International transfers" },
  { id: "cookies", label: "Cookies" },
  { id: "do-not-track", label: "Do Not Track" },
  { id: "changes", label: "Changes" },
  { id: "contact", label: "Contact" },
];

export default function PrivacyPage() {
  return (
    <LegalDocumentLayout
      activeNav="privacy"
      title="Privacy Policy"
      summary="How Memories collects, uses, and protects your information when you use memories.brozy.org and related services."
      toc={TOC}
    >
      <LegalP>
        This Privacy Policy explains how Memories (&quot;we&quot;, &quot;us&quot;) collects, uses, and
        shares information when you use memories.brozy.org and related services
        (the &quot;Service&quot;). By using the Service you agree to this Policy.
      </LegalP>

      <LegalSection id="information-we-collect" title="1. Information We Collect">
        <LegalP>We collect the following categories of information:</LegalP>
        <LegalUL>
          <li>
            <strong className="text-foreground">Account info:</strong> email, username, password hash, profile
            picture, profile description.
          </li>
          <li>
            <strong className="text-foreground">User Content:</strong> videos, images, captions, comments,
            reactions, playlists, and metadata you upload or create.
          </li>
          <li>
            <strong className="text-foreground">Technical info:</strong> IP address, user agent, device type,
            OS, browser, referrer, timestamps, and basic logs needed to operate the
            Service.
          </li>
          <li>
            <strong className="text-foreground">Usage info:</strong> watch history, search queries, likes,
            subscriptions, watch time, and similar interaction events you generate
            on the Service.
          </li>
          <li>
            <strong className="text-foreground">Cookies &amp; local storage:</strong> session identifiers,
            security tokens, preferences (theme, volume), and the visited-videos
            list. We do not currently use third-party advertising trackers.
          </li>
          <li>
            <strong className="text-foreground">Push subscription:</strong> if you opt in, your browser-provided
            push endpoint and keys (we never see your device PIN or password).
          </li>
        </LegalUL>
      </LegalSection>

      <LegalSection id="how-we-use" title="2. How We Use Information">
        <LegalUL>
          <li>Provide and operate the Service (host and stream User Content)</li>
          <li>Authenticate you, secure your account, and prevent fraud and abuse</li>
          <li>Improve features, personalize recommendations, and tune performance</li>
          <li>Send service notifications and (if you opt in) push alerts</li>
          <li>Enforce our Terms and comply with applicable law</li>
          <li>
            Detect and report child sexual abuse material to NCMEC and law
            enforcement as required by 18 U.S.C. §2258A
          </li>
        </LegalUL>
      </LegalSection>

      <LegalSection id="legal-bases" title="3. Legal Bases (EU/UK Users)">
        <LegalP>
          Where the GDPR applies we rely on: (a) contract — to deliver the Service
          you requested; (b) legitimate interests — operating, securing, and
          improving the Service; (c) consent — for push notifications and any
          optional analytics; (d) legal obligation — record-keeping, mandatory
          reporting, and responses to lawful requests.
        </LegalP>
      </LegalSection>

      <LegalSection id="how-we-share" title="4. How We Share Information">
        <LegalP>We share information only as described here:</LegalP>
        <LegalUL>
          <li>
            <strong className="text-foreground">Service providers</strong> who help us host, operate, and
            secure the Service (for example, cloud infrastructure, databases,
            authentication, media delivery, and email). Each provider is bound by
            confidentiality obligations and may use your information only to
            provide services to us.
          </li>
          <li>
            <strong className="text-foreground">Other users:</strong> public-facing parts of your profile and
            User Content you choose to make public are visible to others.
          </li>
          <li>
            <strong className="text-foreground">Legal requests:</strong> we may disclose information if
            required by law, subpoena, court order, or to protect the rights,
            safety, or property of Memories, our users, or the public.
          </li>
          <li>
            <strong className="text-foreground">Business transfers:</strong> if we are acquired or merge,
            information may transfer to the successor under terms at least as
            protective.
          </li>
        </LegalUL>
        <LegalP>
          We do not sell your personal information for money. We do not share it
          with advertisers for cross-context behavioral advertising.
        </LegalP>
      </LegalSection>

      <LegalSection id="data-retention" title="5. Data Retention">
        <LegalP>
          We keep account info for as long as your account is active. User Content
          is retained while it remains posted; if you delete content, copies may
          remain in backups and cached copies for up to 30 days before being
          purged. Logs are kept up to 12 months. Records we are legally required to keep
          (e.g. mandatory reporting evidence) are retained for the period required
          by law.
        </LegalP>
      </LegalSection>

      <LegalSection id="your-rights" title="6. Your Rights">
        <LegalP>
          Depending on where you live (EU/UK GDPR, California CCPA/CPRA, and
          similar laws), you may have the right to:
        </LegalP>
        <LegalUL>
          <li>Access the personal information we hold about you</li>
          <li>Correct inaccurate information</li>
          <li>Delete your account and associated data</li>
          <li>Export your data in a portable format</li>
          <li>Object to or restrict certain processing</li>
          <li>Withdraw consent for processing based on consent</li>
          <li>Lodge a complaint with your local data protection authority (EU/UK)</li>
        </LegalUL>
        <LegalP>
          To exercise these rights email privacy@memories.brozy.org from the email
          associated with your account. We respond within 30 days. We will not
          discriminate against you for exercising your rights.
        </LegalP>
      </LegalSection>

      <LegalSection id="children" title="7. Children's Privacy">
        <LegalP>
          The Service is not directed to children under 13. We do not knowingly
          collect personal information from children under 13. If you believe a
          child under 13 has provided us information, contact
          privacy@memories.brozy.org and we will delete it promptly.
        </LegalP>
      </LegalSection>

      <LegalSection id="security" title="8. Security">
        <LegalP>
          We use industry-standard safeguards, including encryption in transit,
          secure authentication, hashed passwords, and access controls. No system
          is perfectly secure; we cannot guarantee absolute security. Report
          suspected vulnerabilities to security@memories.brozy.org.
        </LegalP>
      </LegalSection>

      <LegalSection id="international" title="9. International Transfers">
        <LegalP>
          Your information may be processed in countries where we or our service
          providers operate. By using the Service, you consent to this processing.
          Where required by law, we use standard contractual clauses or equivalent
          safeguards.
        </LegalP>
      </LegalSection>

      <LegalSection id="cookies" title="10. Cookies &amp; Tracking">
        <LegalP>
          We use first-party cookies and local storage for session management,
          security, and remembering preferences. We do not use third-party
          advertising cookies. You can clear cookies in your browser settings —
          doing so may sign you out and reset preferences.
        </LegalP>
      </LegalSection>

      <LegalSection id="do-not-track" title="11. Do Not Track">
        <LegalP>
          We do not respond to &quot;Do Not Track&quot; browser signals because there is no
          agreed standard. We otherwise do not track you across third-party sites.
        </LegalP>
      </LegalSection>

      <LegalSection id="changes" title="12. Changes to This Policy">
        <LegalP>
          We may update this Policy. Material changes will be announced in the
          Service or by email. Continued use after the effective date constitutes
          acceptance.
        </LegalP>
      </LegalSection>

      <LegalSection id="contact" title="13. Contact">
        <LegalContactCard>
          Privacy questions: privacy@memories.brozy.org
          <br />
          Security: security@memories.brozy.org
        </LegalContactCard>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
