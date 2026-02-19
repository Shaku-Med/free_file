export default function TermsPage() {
  return (
    <article className="max-w-3xl py-8 mandatory_select">
      <h1 className="text-2xl font-semibold text-foreground mb-6">Terms of Service</h1>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Acceptance of Terms</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          By using this application, you agree to be bound by these Terms of Service.
          If you do not agree to these terms, please do not use our service.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">User Responsibilities</h2>
        <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
          As a user of this application, you agree to:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          <li>Only upload content you own or have permission to share</li>
          <li>Not upload illegal, harmful, or inappropriate content</li>
          <li>Understand that uploaded content cannot be deleted</li>
          <li>Respect the rights of other users</li>
          <li>Use the service in compliance with applicable laws</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Content Policy</h2>
        <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
          You are responsible for all content you upload. Prohibited content includes:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          <li>Copyrighted material without permission</li>
          <li>Explicit or inappropriate content</li>
          <li>Content that violates laws or regulations</li>
          <li>Spam or malicious content</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Service Availability</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We strive to maintain service availability but cannot guarantee uninterrupted access.
          We reserve the right to modify or discontinue the service at any time.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Limitation of Liability</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We are not liable for any damages arising from your use of this service.
          You use the service at your own risk.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Changes to Terms</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We may update these terms at any time. Continued use of the service
          constitutes acceptance of any changes.
        </p>
      </section>

      <p className="text-xs text-muted-foreground pt-4 border-t border-border">
        Last updated: {new Date().toLocaleDateString()}
      </p>
    </article>
  );
}
