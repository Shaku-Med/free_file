import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar';
import { AppSidebar } from '~/components/Navbar/components/Sidebar';
import BodyComponent from '~/components/Navbar/components/BodyComponent';
import MobileBottomNav from '~/components/MobileBottomNav';
import NavProgress from '~/routes/Home/NavProgress/NavProgress';
import { useFileContext } from '~/lib/Context/Context';
import { BodyContentWidthBridge } from '~/lib/Context/BodyContentWidthContext';
import { cn } from '~/lib/utils';
import { useLocation } from 'react-router';
import { isPipChromeRoute } from '~/routes/pip/pipEnv';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { hideAppChrome } = useFileContext();
  const { pathname } = useLocation();
  const suppressChrome = hideAppChrome || isPipChromeRoute(pathname);

  return (
    <SidebarProvider className="min-h-0 flex h-full w-full flex-1">
      <div
        className={cn(suppressChrome && 'hidden')}
        aria-hidden={suppressChrome}
      >
        <AppSidebar />
      </div>
      <SidebarInset
        className={cn(
          'h-full min-h-0 min-w-0',
          suppressChrome && 'w-full max-w-none flex-1',
        )}
      >
        <BodyContentWidthBridge className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col">
          <BodyComponent>{children}</BodyComponent>
          <NavProgress />
        </BodyContentWidthBridge>
      </SidebarInset>
      {!suppressChrome && <MobileBottomNav />}
    </SidebarProvider>
  );
}
