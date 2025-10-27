import React from 'react'
import { Separator } from '../../ui/separator'
import { Link } from 'react-router'

const Footer = () => {
  return (
    <footer className="bg-background border-t border-border">
      <div className="mx-auto max-w-full xl:container py-6">
        <Separator className="mb-4" />
        <div className="flex flex-col items-center space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center space-x-4">
            <Link 
              to="/privacy" 
              className="hover:text-foreground transition-colors"
            >
              Privacy Policy
            </Link>
            <span className="text-border">•</span>
            <Link 
              to="/terms" 
              className="hover:text-foreground transition-colors"
            >
              Terms of Service
            </Link>
          </div>
          <p className="text-xs">
            © {new Date().getFullYear()} All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}

export default Footer
