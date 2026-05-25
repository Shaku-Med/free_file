import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Terms of Service | Memories",
    description:
      "Memories terms of service: user responsibilities, content license, acceptable use, DMCA, and dispute resolution.",
    canonicalPath: "/terms",
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

export default function TermsPage() {
  return (
    <article className="max-w-3xl py-8 mandatory_select">
      <h1 className="text-2xl font-semibold text-foreground mb-2">Terms of Service</h1>
      <p className="text-xs text-muted-foreground mb-6">
        Effective date: {new Date().toLocaleDateString()}
      </p>

      <SectionTitle>1. Agreement to Terms</SectionTitle>
      <P>
        These Terms of Service ("Terms") form a binding contract between you and
        Memories ("we", "us", "our"), operator of the Memories platform at
        memories.brozy.org and related services (the "Service"). By accessing or
        using the Service you agree to these Terms. If you do not agree, do not
        use the Service.
      </P>

      <SectionTitle>2. Eligibility</SectionTitle>
      <P>
        You must be at least 13 years old to use the Service. Users aged 13–17 must
        have permission from a parent or legal guardian. If we offer or you access
        any age-restricted content, you must be at least 18 years old. By using the
        Service you represent that you meet these requirements.
      </P>

      <SectionTitle>3. Your Account</SectionTitle>
      <P>
        You are responsible for everything that happens under your account and for
        keeping your credentials secure. Notify us immediately at
        security@memories.brozy.org of any unauthorized access. We may suspend or
        terminate accounts that violate these Terms.
      </P>

      <SectionTitle>4. User Content & License Grant</SectionTitle>
      <P>
        "User Content" means anything you upload, post, stream, or transmit through
        the Service (videos, images, text, comments, captions, metadata, etc.).
      </P>
      <P>
        <strong>You retain ownership of your User Content.</strong> By posting it
        you grant us a worldwide, non-exclusive, royalty-free, sublicensable, and
        transferable license to host, store, reproduce, modify (for the purpose of
        transcoding, generating thumbnails, captions, and adaptive streams),
        publicly perform, publicly display, distribute, and create derivative
        works of your User Content, solely for the purpose of operating,
        promoting, and improving the Service. This license continues for content
        that remains on the Service and survives for a reasonable period after
        removal to allow for backups, caches, and required record-keeping.
      </P>
      <P>
        You represent and warrant that (a) you own your User Content or have all
        necessary rights and permissions to upload and license it as described
        above; (b) your User Content does not infringe any third party's
        intellectual property, privacy, publicity, contractual, or other rights;
        and (c) the people identifiable in your User Content have consented to
        the upload to the extent required by law.
      </P>

      <SectionTitle>5. Prohibited Content & Conduct</SectionTitle>
      <P>
        You will not upload, post, or transmit, and you will not use the Service
        for, any of the following:
      </P>
      <UL>
        <li>
          <strong>Child sexual abuse material (CSAM)</strong> or content that
          sexualizes minors in any form. We report all such content to the
          National Center for Missing &amp; Exploited Children (NCMEC) and
          relevant authorities, and preserve evidence as required by 18 U.S.C.
          §2258A.
        </li>
        <li>
          Copyrighted, trademarked, or otherwise protected material you do not
          own or have permission to share
        </li>
        <li>
          Non-consensual intimate imagery, doxxing, or content that reveals
          another person's private information without consent
        </li>
        <li>
          Content that depicts or promotes violence, self-harm, terrorism, hate
          speech, or harassment of any individual or group
        </li>
        <li>Illegal goods or services, fraud, scams, or phishing</li>
        <li>Malware, exploits, or attempts to disrupt or breach the Service</li>
        <li>
          Automated scraping, crawling, or bulk downloading without our written
          consent
        </li>
        <li>
          Impersonation, misrepresentation of affiliation, or use of someone
          else's identity
        </li>
        <li>Spam, deceptive engagement, or coordinated inauthentic behavior</li>
      </UL>

      <SectionTitle>6. Reporting Violations</SectionTitle>
      <P>
        If you see content that violates these Terms, use the in-app report
        button or email abuse@memories.brozy.org. For copyright complaints, see
        the DMCA section below.
      </P>

      <SectionTitle>7. DMCA / Copyright</SectionTitle>
      <P>
        We respect intellectual property rights and respond to valid notices
        under the Digital Millennium Copyright Act (17 U.S.C. §512). To submit a
        takedown notice or counter-notice, see our{" "}
        <a className="text-primary underline" href="/dmca">
          DMCA Policy
        </a>
        . We terminate the accounts of repeat infringers in appropriate
        circumstances.
      </P>

      <SectionTitle>8. Moderation & Enforcement</SectionTitle>
      <P>
        We may, but are not obligated to, review, remove, restrict, or otherwise
        moderate User Content for any reason, including suspected violations of
        these Terms or applicable law. We may suspend or terminate accounts
        without prior notice for serious or repeated violations. We are not
        liable for moderation decisions, including decisions to leave content
        up.
      </P>

      <SectionTitle>9. Our Intellectual Property</SectionTitle>
      <P>
        The Service itself (software, design, name, logo, and original content
        we provide) is owned by us and protected by intellectual property law.
        We grant you a limited, non-exclusive, non-transferable, revocable
        license to access and use the Service for personal, non-commercial use,
        subject to these Terms.
      </P>

      <SectionTitle>10. Third-Party Links & Services</SectionTitle>
      <P>
        The Service may link to or rely on third-party services. We do not
        endorse and are not responsible for third-party content or services.
        Your use of third-party services is governed by their terms.
      </P>

      <SectionTitle>11. Disclaimer of Warranties</SectionTitle>
      <P>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF
        ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
        NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE
        UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT USER CONTENT WILL BE
        PRESERVED.
      </P>

      <SectionTitle>12. Limitation of Liability</SectionTitle>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY
        INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR
        ANY LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL, ARISING OUT OF OR
        RELATING TO YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ALL CLAIMS
        RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) US $100 OR
        (B) THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM AROSE.
      </P>

      <SectionTitle>13. Indemnification</SectionTitle>
      <P>
        You agree to defend, indemnify, and hold harmless Memories and its
        officers, directors, employees, and agents from any claim, liability,
        damage, loss, or expense (including reasonable attorneys' fees) arising
        out of or related to (a) your User Content; (b) your use of the Service;
        (c) your violation of these Terms; or (d) your violation of any law or
        third-party right.
      </P>

      <SectionTitle>14. Termination</SectionTitle>
      <P>
        You may stop using the Service at any time. We may suspend or terminate
        your access at any time, with or without notice, for any reason
        including suspected violation of these Terms. Sections 4 (license
        survival), 11–13, and 15–17 survive termination.
      </P>

      <SectionTitle>15. Governing Law & Dispute Resolution</SectionTitle>
      <P>
        These Terms are governed by the laws of the State of Delaware, USA,
        without regard to conflict-of-laws rules. Any dispute arising out of or
        relating to these Terms or the Service will be resolved exclusively by
        binding individual arbitration administered by the American Arbitration
        Association under its Consumer Arbitration Rules. You and Memories waive
        the right to a jury trial and to participate in a class action. You may
        opt out of arbitration within 30 days of first accepting these Terms by
        emailing legal@memories.brozy.org with the subject "Arbitration Opt-Out"
        and your account email. Notwithstanding the above, either party may
        bring an individual claim in small-claims court.
      </P>

      <SectionTitle>16. Changes to These Terms</SectionTitle>
      <P>
        We may update these Terms from time to time. Material changes will be
        notified in the Service or by email. Continued use of the Service after
        an update means you accept the updated Terms.
      </P>

      <SectionTitle>17. Miscellaneous</SectionTitle>
      <P>
        These Terms, together with our{" "}
        <a className="text-primary underline" href="/privacy">
          Privacy Policy
        </a>{" "}
        and{" "}
        <a className="text-primary underline" href="/community-guidelines">
          Community Guidelines
        </a>
        , are the entire agreement between you and us regarding the Service. If
        any part of these Terms is unenforceable, the rest remains in effect.
        Our failure to enforce a provision is not a waiver. You may not assign
        these Terms; we may assign them to a successor.
      </P>

      <SectionTitle>18. Contact</SectionTitle>
      <P>
        Legal notices: legal@memories.brozy.org
        <br />
        DMCA notices: dmca@memories.brozy.org
        <br />
        Abuse / reports: abuse@memories.brozy.org
        <br />
        Privacy: privacy@memories.brozy.org
      </P>
    </article>
  );
}
