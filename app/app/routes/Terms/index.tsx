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
    title: "Terms of Service | Memories",
    description:
      "Memories terms of service: user responsibilities, content license, acceptable use, DMCA, and dispute resolution.",
    canonicalPath: "/terms",
  });

const TOC: LegalTocItem[] = [
  { id: "agreement", label: "Agreement" },
  { id: "eligibility", label: "Eligibility" },
  { id: "your-account", label: "Your account" },
  { id: "user-content", label: "User content" },
  { id: "prohibited", label: "Prohibited conduct" },
  { id: "reporting", label: "Reporting" },
  { id: "dmca", label: "DMCA" },
  { id: "moderation", label: "Moderation" },
  { id: "our-ip", label: "Our IP" },
  { id: "third-party", label: "Third parties" },
  { id: "disclaimer", label: "Disclaimer" },
  { id: "liability", label: "Liability" },
  { id: "indemnification", label: "Indemnification" },
  { id: "termination", label: "Termination" },
  { id: "disputes", label: "Disputes" },
  { id: "changes", label: "Changes" },
  { id: "miscellaneous", label: "Miscellaneous" },
  { id: "contact", label: "Contact" },
];

export default function TermsPage() {
  return (
    <LegalDocumentLayout
      activeNav="terms"
      title="Terms of Service"
      summary="The rules for using Memories, including your responsibilities, content licensing, and how we enforce the platform."
      toc={TOC}
    >
      <LegalSection id="agreement" title="1. Agreement to Terms">
        <LegalP>
          These Terms of Service (&quot;Terms&quot;) form a binding contract between you and
          Memories (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;), operator of the Memories platform at
          memories.brozy.org and related services (the &quot;Service&quot;). By accessing or
          using the Service you agree to these Terms. If you do not agree, do not
          use the Service.
        </LegalP>
      </LegalSection>

      <LegalSection id="eligibility" title="2. Eligibility">
        <LegalP>
          You must be at least 13 years old to use the Service. Users aged 13–17 must
          have permission from a parent or legal guardian. If we offer or you access
          any age-restricted content, you must be at least 18 years old. By using the
          Service you represent that you meet these requirements.
        </LegalP>
      </LegalSection>

      <LegalSection id="your-account" title="3. Your Account">
        <LegalP>
          You are responsible for everything that happens under your account and for
          keeping your credentials secure. Notify us immediately at
          security@memories.brozy.org of any unauthorized access. We may suspend or
          terminate accounts that violate these Terms.
        </LegalP>
      </LegalSection>

      <LegalSection id="user-content" title="4. User Content & License Grant">
        <LegalP>
          &quot;User Content&quot; means anything you upload, post, stream, or transmit through
          the Service (videos, images, text, comments, captions, metadata, etc.).
        </LegalP>
        <LegalP>
          <strong className="text-foreground">You retain ownership of your User Content.</strong> By posting it
          you grant us a worldwide, non-exclusive, royalty-free, sublicensable, and
          transferable license to host, store, reproduce, modify (for the purpose of
          transcoding, generating thumbnails, captions, and adaptive streams),
          publicly perform, publicly display, distribute, and create derivative
          works of your User Content, solely for the purpose of operating,
          promoting, and improving the Service. This license continues for content
          that remains on the Service and survives for a reasonable period after
          removal to allow for backups, caches, and required record-keeping.
        </LegalP>
        <LegalP>
          You represent and warrant that (a) you own your User Content or have all
          necessary rights and permissions to upload and license it as described
          above; (b) your User Content does not infringe any third party&apos;s
          intellectual property, privacy, publicity, contractual, or other rights;
          and (c) the people identifiable in your User Content have consented to
          the upload to the extent required by law.
        </LegalP>
      </LegalSection>

      <LegalSection id="prohibited" title="5. Prohibited Content & Conduct">
        <LegalP>
          You will not upload, post, or transmit, and you will not use the Service
          for, any of the following:
        </LegalP>
        <LegalUL>
          <li>
            <strong className="text-foreground">Child sexual abuse material (CSAM)</strong> or content that
            sexualizes minors in any form. We report all such content to the
            National Center for Missing &amp; Exploited Children (NCMEC) and
            relevant authorities, and preserve evidence as required by 18 U.S.C.
            §2258A.
          </li>
          <li>Copyrighted, trademarked, or otherwise protected material you do not own or have permission to share</li>
          <li>Non-consensual intimate imagery, doxxing, or content that reveals another person&apos;s private information without consent</li>
          <li>Content that depicts or promotes violence, self-harm, terrorism, hate speech, or harassment of any individual or group</li>
          <li>Illegal goods or services, fraud, scams, or phishing</li>
          <li>Malware, exploits, or attempts to disrupt or breach the Service</li>
          <li>Automated scraping, crawling, or bulk downloading without our written consent</li>
          <li>Impersonation, misrepresentation of affiliation, or use of someone else&apos;s identity</li>
          <li>Spam, deceptive engagement, or coordinated inauthentic behavior</li>
        </LegalUL>
      </LegalSection>

      <LegalSection id="reporting" title="6. Reporting Violations">
        <LegalP>
          If you see content that violates these Terms, use the in-app report
          button or email abuse@memories.brozy.org. For copyright complaints, see
          the DMCA section below.
        </LegalP>
      </LegalSection>

      <LegalSection id="dmca" title="7. DMCA / Copyright">
        <LegalP>
          We respect intellectual property rights and respond to valid notices
          under the Digital Millennium Copyright Act (17 U.S.C. §512). To submit a
          takedown notice or counter-notice, see our{" "}
          <LegalLink to="/dmca">DMCA Policy</LegalLink>. We terminate the accounts of repeat infringers in appropriate
          circumstances.
        </LegalP>
      </LegalSection>

      <LegalSection id="moderation" title="8. Moderation & Enforcement">
        <LegalP>
          We may, but are not obligated to, review, remove, restrict, or otherwise
          moderate User Content for any reason, including suspected violations of
          these Terms or applicable law. We may suspend or terminate accounts
          without prior notice for serious or repeated violations. We are not
          liable for moderation decisions, including decisions to leave content
          up.
        </LegalP>
      </LegalSection>

      <LegalSection id="our-ip" title="9. Our Intellectual Property">
        <LegalP>
          The Service itself (software, design, name, logo, and original content
          we provide) is owned by us and protected by intellectual property law.
          We grant you a limited, non-exclusive, non-transferable, revocable
          license to access and use the Service for personal, non-commercial use,
          subject to these Terms.
        </LegalP>
      </LegalSection>

      <LegalSection id="third-party" title="10. Third-Party Links & Services">
        <LegalP>
          The Service may link to or rely on third-party services. We do not
          endorse and are not responsible for third-party content or services.
          Your use of third-party services is governed by their terms.
        </LegalP>
      </LegalSection>

      <LegalSection id="disclaimer" title="11. Disclaimer of Warranties">
        <LegalP>
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF
          ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF
          MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
          NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE
          UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT USER CONTENT WILL BE
          PRESERVED.
        </LegalP>
      </LegalSection>

      <LegalSection id="liability" title="12. Limitation of Liability">
        <LegalP>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY
          INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR
          ANY LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL, ARISING OUT OF OR
          RELATING TO YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ALL CLAIMS
          RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) US $100 OR
          (B) THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM AROSE.
        </LegalP>
      </LegalSection>

      <LegalSection id="indemnification" title="13. Indemnification">
        <LegalP>
          You agree to defend, indemnify, and hold harmless Memories and its
          officers, directors, employees, and agents from any claim, liability,
          damage, loss, or expense (including reasonable attorneys&apos; fees) arising
          out of or related to (a) your User Content; (b) your use of the Service;
          (c) your violation of these Terms; or (d) your violation of any law or
          third-party right.
        </LegalP>
      </LegalSection>

      <LegalSection id="termination" title="14. Termination">
        <LegalP>
          You may stop using the Service at any time. We may suspend or terminate
          your access at any time, with or without notice, for any reason
          including suspected violation of these Terms. Sections 4 (license
          survival), 11–13, and 15–17 survive termination.
        </LegalP>
      </LegalSection>

      <LegalSection id="disputes" title="15. Governing Law & Dispute Resolution">
        <LegalP>
          These Terms are governed by the laws of the State of Delaware, USA,
          without regard to conflict-of-laws rules. Any dispute arising out of or
          relating to these Terms or the Service will be resolved exclusively by
          binding individual arbitration administered by the American Arbitration
          Association under its Consumer Arbitration Rules. You and Memories waive
          the right to a jury trial and to participate in a class action. You may
          opt out of arbitration within 30 days of first accepting these Terms by
          emailing legal@memories.brozy.org with the subject &quot;Arbitration Opt-Out&quot;
          and your account email. Notwithstanding the above, either party may
          bring an individual claim in small-claims court.
        </LegalP>
      </LegalSection>

      <LegalSection id="changes" title="16. Changes to These Terms">
        <LegalP>
          We may update these Terms from time to time. Material changes will be
          notified in the Service or by email. Continued use of the Service after
          an update means you accept the updated Terms.
        </LegalP>
      </LegalSection>

      <LegalSection id="miscellaneous" title="17. Miscellaneous">
        <LegalP>
          These Terms, together with our{" "}
          <LegalLink to="/privacy">Privacy Policy</LegalLink>{" "}
          and{" "}
          <LegalLink to="/community-guidelines">Community Guidelines</LegalLink>
          , are the entire agreement between you and us regarding the Service. If
          any part of these Terms is unenforceable, the rest remains in effect.
          Our failure to enforce a provision is not a waiver. You may not assign
          these Terms; we may assign them to a successor.
        </LegalP>
      </LegalSection>

      <LegalSection id="contact" title="18. Contact">
        <LegalContactCard>
          Legal notices: legal@memories.brozy.org
          <br />
          DMCA notices: dmca@memories.brozy.org
          <br />
          Abuse / reports: abuse@memories.brozy.org
          <br />
          Privacy: privacy@memories.brozy.org
        </LegalContactCard>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
