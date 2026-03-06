import * as React from "react"
import { isMobile } from 'react-device-detect'
import { useFileContext } from "~/lib/Context/Context"

const MOBILE_BREAKPOINT = 900

export const useIsMobileByUserAgent = (user_agent: string) => {
  return user_agent.toLowerCase().includes('mobile')
}

export function useIsMobile(return_Current_Width: boolean = false) {
  const { user_agent } = useFileContext()
  const [is_Mobile, setIsMobile] = React.useState<boolean | undefined>(useIsMobileByUserAgent(user_agent))
  const [currentWidth, setCurrentWidth] = React.useState<number>(0)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
      console.log(window.innerWidth)
      setCurrentWidth(window.innerWidth)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    setCurrentWidth(window.innerWidth)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return return_Current_Width ? {
    isMobile: !!is_Mobile,
    currentWidth: currentWidth
  } : !!is_Mobile
}
