export default function PrivacyPage() {
  return (
    <article className="max-w-3xl py-8 mandatory_select">
      <h1 className="text-2xl font-semibold text-foreground mb-6">Privacy Policy</h1>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Information We Collect</h2>
        <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
          When you use our application, we may collect:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          <li>Files and media content you upload</li>
          <li>Usage data and analytics</li>
          <li>Device information and browser data</li>
          <li>IP addresses and location data</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">How We Use Your Information</h2>
        <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
          We use collected information to:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          <li>Provide and maintain our services</li>
          <li>Process and store your uploaded content</li>
          <li>Improve user experience and application performance</li>
          <li>Ensure security and prevent abuse</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Data Storage and Security</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We implement appropriate security measures to protect your information.
          However, please note that uploaded content is stored permanently and
          cannot be deleted once submitted to our platform.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Contact Us</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          If you have any questions about this Privacy Policy, please contact us
          through our support channels.
        </p>
      </section>

      <p className="text-xs text-muted-foreground pt-4 border-t border-border">
        Last updated: {new Date().toLocaleDateString()}
      </p>
    </article>
  );
}
