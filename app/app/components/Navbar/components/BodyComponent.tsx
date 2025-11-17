import { useSidebar } from "~/components/ui/sidebar"
import Navbar from ".."
import Footer from "~/components/components/Footer"
import ScrollRestoration from "~/lib/Context/ScrollRestoration"

interface BodyComponentProps {
  children: React.ReactNode
}
const BodyComponent = ({ children }: BodyComponentProps) => {
  const { isMobile, state} = useSidebar()
  return (
    <>
      <div className={`h-full w-full ${!isMobile && state === 'expanded' && `pt-3`}`}>
      <div id="scroll_container" className={` ${!isMobile && state === 'expanded' && `rounded-tl-3xl bg-card`} h-full w-full overflow-y-auto`}>
          <ScrollRestoration />
          <Navbar />
          <div className={`mx-auto px-6 xl:px-8 max-w-full xl:container w-full`}>
            {children}
          </div>
          <Footer />
          </div>
      </div>
    </>
  )
}

export default BodyComponent