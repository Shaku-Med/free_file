import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import { useFileContext } from "~/lib/Context/Context";

const SettingsPage = () => {
  const { userId } = useFileContext();
  const navigate = useNavigate();
  const [showNsfw, setShowNsfw] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      navigate("/auth/login");
      return;
    }

    const loadSettings = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/settings");
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Failed to load settings");
        }
        const payload = await response.json();
        setShowNsfw(Boolean(payload?.showNsfw));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, [userId, navigate]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showNsfw }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to update settings");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">Control your content preferences.</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Show NSFW content</p>
              <p className="text-xs text-muted-foreground">Include adult content in your feed.</p>
            </div>
            <Button
              type="button"
              variant={showNsfw ? "default" : "outline"}
              className="rounded-full px-4"
              onClick={() => setShowNsfw((prev) => !prev)}
              disabled={isLoading || isSaving}
            >
              {showNsfw ? "On" : "Off"}
            </Button>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center justify-end">
            <Button onClick={handleSave} disabled={isLoading || isSaving}>
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
