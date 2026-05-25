import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Privacy Policy | Memories",
    description:
      "How Memories collects, uses, and protects your information. GDPR / CCPA rights, data retention, cookies, and contact details.",
    canonicalPath: "/privacy",
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

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl py-8 mandatory_select">
      <h1 className="text-2xl font-semibold text-foreground mb-2">Privacy Policy</h1>
      <p className="text-xs text-muted-foreground mb-6">
        Effective date: {new Date().toLocaleDateString()}
      </p>

      <P>
        This Privacy Policy explains how Memories ("we", "us") collects, uses, and
        shares information when you use memories.brozy.org and related services
        (the "Service"). By using the Service you agree to this Policy.
      </P>

      <SectionTitle>1. Information We Collect</SectionTitle>
      <P>We collect the following categories of information:</P>
      <UL>
        <li>
          <strong>Account info:</strong> email, username, password hash, profile
          picture, profile description.
        </li>
        <li>
          <strong>User Content:</strong> videos, images, captions, comments,
          reactions, playlists, and metadata you upload or create.
        </li>
        <li>
          <strong>Technical info:</strong> IP address, user agent, device type,
          OS, browser, referrer, timestamps, and basic logs needed to operate the
          Service.
        </li>
        <li>
          <strong>Usage info:</strong> watch history, search queries, likes,
          subscriptions, watch time, and similar interaction events you generate
          on the Service.
        </li>
        <li>
          <strong>Cookies &amp; local storage:</strong> session identifiers,
          security tokens, preferences (theme, volume), and the visited-videos
          list. We do not currently use third-party advertising trackers.
        </li>
        <li>
          <strong>Push subscription:</strong> if you opt in, your browser-provided
          push endpoint and keys (we never see your device PIN or password).
        </li>
      </UL>

      <SectionTitle>2. How We Use Information</SectionTitle>
      <UL>
        <li>Provide and operate the Service (host and stream User Content)</li>
        <li>
          Authenticate you, secure your account, and prevent fraud and abuse
        </li>
        <li>
          Improve features, personalize recommendations, and tune performance
        </li>
        <li>Send service notifications and (if you opt in) push alerts</li>
        <li>Enforce our Terms and comply with applicable law</li>
        <li>
          Detect and report child sexual abuse material to NCMEC and law
          enforcement as required by 18 U.S.C. §2258A
        </li>
      </UL>

      <SectionTitle>3. Legal Bases (EU/UK Users)</SectionTitle>
      <P>
        Where the GDPR applies we rely on: (a) contract  to deliver the Service
        you requested; (b) legitimate interests  operating, securing, and
        improving the Service; (c) consent  for push notifications and any
        optional analytics; (d) legal obligation  record-keeping, mandatory
        reporting, and responses to lawful requests.
      </P>

      <SectionTitle>4. How We Share Information</SectionTitle>
      <P>We share information only as described here:</P>
      <UL>
        <li>
          <strong>Service providers (subprocessors)</strong> who help us run the
          platform  currently Supabase (auth + database), our VPS hosts
          (Hostinger for CDN, AWS EC2 for app), and GitHub (object storage for
          uploaded media). Each is bound by confidentiality and used only to
          provide the Service.
        </li>
        <li>
          <strong>Other users:</strong> public-facing parts of your profile and
          User Content you choose to make public are visible to others.
        </li>
        <li>
          <strong>Legal requests:</strong> we may disclose information if
          required by law, subpoena, court order, or to protect the rights,
          safety, or property of Memories, our users, or the public.
        </li>
        <li>
          <strong>Business transfers:</strong> if we are acquired or merge,
          information may transfer to the successor under terms at least as
          protective.
        </li>
      </UL>
      <P>
        We do not sell your personal information for money. We do not share it
        with advertisers for cross-context behavioral advertising.
      </P>

      <SectionTitle>5. Data Retention</SectionTitle>
      <P>
        We keep account info for as long as your account is active. User Content
        is retained while it remains posted; if you delete content, copies may
        remain in backups and CDN caches for up to 30 days before being purged.
        Logs are kept up to 12 months. Records we are legally required to keep
        (e.g. mandatory reporting evidence) are retained for the period required
        by law.
      </P>

      <SectionTitle>6. Your Rights</SectionTitle>
      <P>
        Depending on where you live (EU/UK GDPR, California CCPA/CPRA, and
        similar laws), you may have the right to:
      </P>
      <UL>
        <li>Access the personal information we hold about you</li>
        <li>Correct inaccurate information</li>
        <li>Delete your account and associated data</li>
        <li>Export your data in a portable format</li>
        <li>Object to or restrict certain processing</li>
        <li>Withdraw consent for processing based on consent</li>
        <li>
          Lodge a complaint with your local data protection authority (EU/UK)
        </li>
      </UL>
      <P>
        To exercise these rights email privacy@memories.brozy.org from the email
        associated with your account. We respond within 30 days. We will not
        discriminate against you for exercising your rights.
      </P>

      <SectionTitle>7. Children's Privacy</SectionTitle>
      <P>
        The Service is not directed to children under 13. We do not knowingly
        collect personal information from children under 13. If you believe a
        child under 13 has provided us information, contact
        privacy@memories.brozy.org and we will delete it promptly.
      </P>

      <SectionTitle>8. Security</SectionTitle>
      <P>
        We use TLS for transit, HMAC-signed playback tokens, hashed passwords,
        IP/UA fingerprint binding, and access controls. No system is perfectly
        secure; we cannot guarantee absolute security. Report suspected
        vulnerabilities to security@memories.brozy.org.
      </P>

      <SectionTitle>9. International Transfers</SectionTitle>
      <P>
        Our servers are located in the United States and the European Union. By
        using the Service, you consent to your information being processed in
        those regions. Where required, we use standard contractual clauses or
        equivalent safeguards.
      </P>

      <SectionTitle>10. Cookies &amp; Tracking</SectionTitle>
      <P>
        We use first-party cookies and local storage for session management,
        security, and remembering preferences. We do not use third-party
        advertising cookies. You can clear cookies in your browser settings 
        doing so may sign you out and reset preferences.
      </P>

      <SectionTitle>11. Do Not Track</SectionTitle>
      <P>
        We do not respond to "Do Not Track" browser signals because there is no
        agreed standard. We otherwise do not track you across third-party sites.
      </P>

      <SectionTitle>12. Changes to This Policy</SectionTitle>
      <P>
        We may update this Policy. Material changes will be announced in the
        Service or by email. Continued use after the effective date constitutes
        acceptance.
      </P>

      <SectionTitle>13. Contact</SectionTitle>
      <P>
        Privacy questions: privacy@memories.brozy.org
        <br />
        Security: security@memories.brozy.org
      </P>
    </article>
  );
}
