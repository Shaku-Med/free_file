import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { AlertTriangle } from 'lucide-react'

export default function PrivacyPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Privacy Policy</CardTitle>
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
            <h2 className="text-xl font-semibold mb-3">Information We Collect</h2>
            <p className="text-muted-foreground mb-4">
              When you use our application, we may collect:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Files and media content you upload</li>
              <li>Usage data and analytics</li>
              <li>Device information and browser data</li>
              <li>IP addresses and location data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">How We Use Your Information</h2>
            <p className="text-muted-foreground mb-4">
              We use collected information to:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Provide and maintain our services</li>
              <li>Process and store your uploaded content</li>
              <li>Improve user experience and application performance</li>
              <li>Ensure security and prevent abuse</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Data Storage and Security</h2>
            <p className="text-muted-foreground">
              We implement appropriate security measures to protect your information. 
              However, please note that uploaded content is stored permanently and 
              cannot be deleted once submitted to our platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Contact Us</h2>
            <p className="text-muted-foreground">
              If you have any questions about this Privacy Policy, please contact us 
              through our support channels.
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
