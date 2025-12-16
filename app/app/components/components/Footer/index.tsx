import React from 'react'
import { Separator } from '../../ui/separator'
import { Link, useLocation } from 'react-router'

const Footer = () => {
  const location = useLocation()
  const staticRoutes = ['/', '/privacy', '/terms', '/features', '/auth', '/api']
  const isSearchRoute = location.pathname === '/search' || location.pathname.startsWith('/search/')
  const isDynamicRoute = !staticRoutes.includes(location.pathname) && 
    location.pathname.startsWith('/') && 
    location.pathname.split('/').filter(Boolean).length === 1
  const isBlacklisted = isSearchRoute || isDynamicRoute

  return (
    <footer className={` border-t border-border text-center px-3 ${isBlacklisted ? 'hidden' : ''}`}>
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
          <p>Be mindful when uploading content to this application. Any files you upload cannot be deleted once submitted. We recommend only uploading content you are comfortable having permanently stored on our platform.</p>
          <p className="text-xs">
            © {new Date().getFullYear()} All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}

export default Footer
