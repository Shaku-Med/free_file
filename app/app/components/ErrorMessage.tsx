import React from 'react'
import { cn } from '~/lib/utils'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

type ErrorAction = 'reload'

interface ErrorMessageProps {
  message: {
    title?: string;
    description?: string;
    /** Fixed action id — never arbitrary JS. */
    action?: ErrorAction;
    actionText?: string;
  };
  children?: React.ReactNode;
  className?: string;
}

const ACTIONS: Record<ErrorAction, () => void> = {
  reload: () => {
    if (typeof window !== 'undefined') window.location.reload()
  },
}

const ErrorMessage = ({ message, children, className }: ErrorMessageProps) => {
  const onAction =
    message.action && ACTIONS[message.action]
      ? ACTIONS[message.action]
      : undefined

  return (
    <div className={cn('flex items-center justify-center min-h-screen bg-background fixed inset-0 p-4', className)}>
      {children || (
        <Card className="w-full max-w-md mx-auto text-center">
          <CardHeader className="space-y-4">
            <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
              <svg
                className="w-8 h-8 text-destructive"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <CardTitle className="text-2xl font-bold text-foreground">
              {message.title}
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              {message.description}
            </CardDescription>
          </CardHeader>
          {onAction && (
            <CardContent>
              <Button
                className="w-full"
                size="lg"
                type="button"
                onClick={onAction}
              >
                {message.actionText}
              </Button>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}

export default ErrorMessage
