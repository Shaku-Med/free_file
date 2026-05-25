import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "DMCA Copyright Policy | Memories",
    description:
      "How to submit DMCA copyright takedown notices and counter-notices to Memories. Designated agent contact and required information.",
    canonicalPath: "/dmca",
  });

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-lg font-semibold text-foreground mb-2 mt-6">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{children}</p>
);
const OL = ({ children }: { children: React.ReactNode }) => (
  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground mb-3">
    {children}
  </ol>
);

export default function DMCAPage() {
  return (
    <article className="max-w-3xl py-8 mandatory_select">
      <h1 className="text-2xl font-semibold text-foreground mb-2">DMCA Copyright Policy</h1>
      <p className="text-xs text-muted-foreground mb-6">
        Effective date: {new Date().toLocaleDateString()}
      </p>

      <P>
        Memories complies with the Digital Millennium Copyright Act (DMCA, 17
        U.S.C. §512). We respond expeditiously to valid takedown notices and
        terminate the accounts of repeat infringers in appropriate
        circumstances.
      </P>

      <SectionTitle>Designated Agent</SectionTitle>
      <P>
        Send DMCA notices to our designated agent registered with the U.S.
        Copyright Office:
      </P>
      <P>
        Email: dmca@memories.brozy.org
        <br />
        Subject line: "DMCA Takedown Notice"
      </P>

      <SectionTitle>Filing a Takedown Notice</SectionTitle>
      <P>
        To be effective under 17 U.S.C. §512(c)(3), your notice must include all
        of the following:
      </P>
      <OL>
        <li>
          A physical or electronic signature of the copyright owner or a person
          authorized to act on the owner's behalf
        </li>
        <li>
          Identification of the copyrighted work claimed to have been infringed
          (or a representative list if multiple works)
        </li>
        <li>
          Identification of the material that is claimed to be infringing,
          including the URL(s) on memories.brozy.org so we can locate it
        </li>
        <li>
          Your name, address, telephone number, and email address
        </li>
        <li>
          A statement that you have a good-faith belief that use of the material
          in the manner complained of is not authorized by the copyright owner,
          its agent, or the law
        </li>
        <li>
          A statement, under penalty of perjury, that the information in the
          notice is accurate and that you are the copyright owner or are
          authorized to act on the copyright owner's behalf
        </li>
      </OL>
      <P>
        Notices missing any of the above may be invalid. We may forward your
        notice (including your contact information) to the user who posted the
        material and to the Lumen Database for transparency.
      </P>

      <SectionTitle>False or Misleading Notices</SectionTitle>
      <P>
        Under 17 U.S.C. §512(f), anyone who knowingly materially misrepresents
        that material is infringing may be liable for damages. Don't send bogus
        takedowns.
      </P>

      <SectionTitle>Counter-Notice</SectionTitle>
      <P>
        If you believe your content was removed in error, you may submit a
        counter-notice to dmca@memories.brozy.org including:
      </P>
      <OL>
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
      </OL>
      <P>
        If we receive a valid counter-notice, we will forward it to the original
        complainant. Unless they file suit within 10–14 business days, we may
        restore the content.
      </P>

      <SectionTitle>Repeat-Infringer Policy</SectionTitle>
      <P>
        We terminate the accounts of users who, in our reasonable judgment, are
        repeat infringers. Three valid takedowns on a single account is the
        general threshold; serious or egregious infringement may result in
        immediate termination.
      </P>

      <SectionTitle>Contact</SectionTitle>
      <P>dmca@memories.brozy.org</P>
    </article>
  );
}
