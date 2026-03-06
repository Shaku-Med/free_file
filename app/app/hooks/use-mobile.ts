import * as React from "react"
import { useFileContext } from "~/lib/Context/Context"

const MOBILE_BREAKPOINT = 900

export const useIsMobileByUserAgent = (user_agent: string) => {
  return user_agent.toLowerCase().includes('mobile')
}

export function useIsMobile() {
  const { user_agent } = useFileContext()
  const [is_Mobile, setIsMobile] = React.useState<boolean | undefined>(useIsMobileByUserAgent(user_agent))

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!is_Mobile
}
