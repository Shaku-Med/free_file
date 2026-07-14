import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { HomePage } from "@/pages/HomePage";
import { LibraryPage } from "@/pages/LibraryPage";
import { PlaylistsPage } from "@/pages/PlaylistsPage";
import { ReelsPage } from "@/pages/ReelsPage";
import { StudioPage } from "@/pages/StudioPage";
import { SubscriptionsPage } from "@/pages/SubscriptionsPage";
import { WatchPage } from "@/pages/WatchPage";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="subscriptions" element={<SubscriptionsPage />} />
          <Route path="reels" element={<ReelsPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="playlists" element={<PlaylistsPage />} />
          <Route path="studio" element={<StudioPage />} />
          <Route path="watch/:id" element={<WatchPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
