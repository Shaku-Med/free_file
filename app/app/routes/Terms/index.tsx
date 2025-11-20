import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { AlertTriangle } from 'lucide-react'

export default function TermsPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Terms of Service</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-destructive mb-2">Important Upload Notice</h3>
                <p className="text-sm text-destructive/80">
                  <strong>Please be mindful when uploading content to this application.</strong> 
                  Any files you upload cannot be deleted once submitted. We recommend only uploading 
                  content you are comfortable having permanently stored on our platform.
                </p>
              </div>
            </div>
          </div>

          <section>
            <h2 className="text-xl font-semibold mb-3">Acceptance of Terms</h2>
            <p className="text-muted-foreground">
              By using this application, you agree to be bound by these Terms of Service. 
              If you do not agree to these terms, please do not use our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">User Responsibilities</h2>
            <p className="text-muted-foreground mb-4">
              As a user of this application, you agree to:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Only upload content you own or have permission to share</li>
              <li>Not upload illegal, harmful, or inappropriate content</li>
              <li>Understand that uploaded content cannot be deleted</li>
              <li>Respect the rights of other users</li>
              <li>Use the service in compliance with applicable laws</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Content Policy</h2>
            <p className="text-muted-foreground mb-4">
              You are responsible for all content you upload. Prohibited content includes:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Copyrighted material without permission</li>
              <li>Explicit or inappropriate content</li>
              <li>Content that violates laws or regulations</li>
              <li>Spam or malicious content</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Service Availability</h2>
            <p className="text-muted-foreground">
              We strive to maintain service availability but cannot guarantee uninterrupted access. 
              We reserve the right to modify or discontinue the service at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Limitation of Liability</h2>
            <p className="text-muted-foreground">
              We are not liable for any damages arising from your use of this service. 
              You use the service at your own risk.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Changes to Terms</h2>
            <p className="text-muted-foreground">
              We may update these terms at any time. Continued use of the service 
              constitutes acceptance of any changes.
            </p>
          </section>

          <div className="text-xs text-muted-foreground pt-4 border-t">
            Last updated: {new Date().toLocaleDateString()}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
