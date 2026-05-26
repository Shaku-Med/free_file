import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";
import {
  LegalContactCard,
  LegalDocumentLayout,
  LegalOL,
  LegalP,
  LegalSection,
  type LegalTocItem,
} from "~/components/legal/LegalDocumentLayout";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "DMCA Copyright Policy | Memories",
    description:
      "How to submit DMCA copyright takedown notices and counter-notices to Memories. Designated agent contact and required information.",
    canonicalPath: "/dmca",
  });

const TOC: LegalTocItem[] = [
  { id: "designated-agent", label: "Designated agent" },
  { id: "takedown-notice", label: "Takedown notice" },
  { id: "false-notices", label: "False notices" },
  { id: "counter-notice", label: "Counter-notice" },
  { id: "repeat-infringer", label: "Repeat infringers" },
  { id: "contact", label: "Contact" },
];

export default function DMCAPage() {
  return (
    <LegalDocumentLayout
      activeNav="dmca"
      title="DMCA Copyright Policy"
      summary="How to submit copyright takedown notices and counter-notices under the Digital Millennium Copyright Act."
      toc={TOC}
    >
      <LegalP>
        Memories complies with the Digital Millennium Copyright Act (DMCA, 17
        U.S.C. §512). We respond expeditiously to valid takedown notices and
        terminate the accounts of repeat infringers in appropriate
        circumstances.
      </LegalP>

      <LegalSection id="designated-agent" title="Designated Agent">
        <LegalP>
          Send DMCA notices to our designated agent registered with the U.S.
          Copyright Office:
        </LegalP>
        <LegalContactCard>
          Email: dmca@memories.brozy.org
          <br />
          Subject line: &quot;DMCA Takedown Notice&quot;
        </LegalContactCard>
      </LegalSection>

      <LegalSection id="takedown-notice" title="Filing a Takedown Notice">
        <LegalP>
          To be effective under 17 U.S.C. §512(c)(3), your notice must include all
          of the following:
        </LegalP>
        <LegalOL>
          <li>
            A physical or electronic signature of the copyright owner or a person
            authorized to act on the owner&apos;s behalf
          </li>
          <li>
            Identification of the copyrighted work claimed to have been infringed
            (or a representative list if multiple works)
          </li>
          <li>
            Identification of the material that is claimed to be infringing,
            including the URL(s) on memories.brozy.org so we can locate it
          </li>
          <li>Your name, address, telephone number, and email address</li>
          <li>
            A statement that you have a good-faith belief that use of the material
            in the manner complained of is not authorized by the copyright owner,
            its agent, or the law
          </li>
          <li>
            A statement, under penalty of perjury, that the information in the
            notice is accurate and that you are the copyright owner or are
            authorized to act on the copyright owner&apos;s behalf
          </li>
        </LegalOL>
        <LegalP>
          Notices missing any of the above may be invalid. We may forward your
          notice (including your contact information) to the user who posted the
          material and to the Lumen Database for transparency.
        </LegalP>
      </LegalSection>

      <LegalSection id="false-notices" title="False or Misleading Notices">
        <LegalP>
          Under 17 U.S.C. §512(f), anyone who knowingly materially misrepresents
          that material is infringing may be liable for damages. Don&apos;t send bogus
          takedowns.
        </LegalP>
      </LegalSection>

      <LegalSection id="counter-notice" title="Counter-Notice">
        <LegalP>
          If you believe your content was removed in error, you may submit a
          counter-notice to dmca@memories.brozy.org including:
        </LegalP>
        <LegalOL>
          <li>Your physical or electronic signature</li>
          <li>
            Identification of the material that was removed and the location at
            which it appeared before removal
          </li>
          <li>
            A statement under penalty of perjury that you have a good-faith belief
            the material was removed as a result of mistake or misidentification
          </li>
          <li>
            Your name, address, and telephone number, and a statement that you
            consent to the jurisdiction of the U.S. federal district court for the
            judicial district where you are located (or, if outside the U.S., the
            district where Memories is located), and that you will accept service
            of process from the person who sent the original notice or their
            agent
          </li>
        </LegalOL>
        <LegalP>
          If we receive a valid counter-notice, we will forward it to the original
          complainant. Unless they file suit within 10–14 business days, we may
          restore the content.
        </LegalP>
      </LegalSection>

      <LegalSection id="repeat-infringer" title="Repeat-Infringer Policy">
        <LegalP>
          We terminate the accounts of users who, in our reasonable judgment, are
          repeat infringers. Three valid takedowns on a single account is the
          general threshold; serious or egregious infringement may result in
          immediate termination.
        </LegalP>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <LegalContactCard>dmca@memories.brozy.org</LegalContactCard>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
