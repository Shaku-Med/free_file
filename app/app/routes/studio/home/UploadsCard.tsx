import { Link } from "react-router";
import { Upload } from "lucide-react";
import { StorageQuotaMeter } from "~/components/StorageQuotaMeter";
import { useStudioData } from "~/lib/studio/studioCache";
import { isStillProcessing } from "~/lib/files/uploadStatus";
import { CardSection, DashCard, Skeleton, studioButton } from "../components/StudioUI";
import { postAnalyticsHref, postTitle } from "./PostThumb";

interface ProcessingRow {
  id: string;
  unique_id: string;
  filename: string;
  file_title?: string | null;
  upload_status?: string | null;
  processing_progress?: number | null;
}

interface PostsApi {
  success: boolean;
  data: ProcessingRow[];
  pagination?: { total: number };
}

function Progress({ row }: { row: ProcessingRow }) {
  const pct =
    typeof row.processing_progress === "number"
      ? Math.max(0, Math.min(100, Math.round(row.processing_progress)))
      : null;
  const label = isStillProcessing(row.upload_status) ? "Processing" : "Adding qualities";
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        {pct !== null && <span className="tabular-nums text-muted-foreground">{pct}%</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        {pct !== null ? (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
        )}
      </div>
    </div>
  );
}

export function UploadsCard({ onUpload }: { onUpload: () => void }) {
  const { data, loading } = useStudioData<PostsApi>({
    cacheKey: "studio:posts:processing:dashboard",
    url: "/api/studio/posts?limit=3&offset=0&status=processing",
    ttlMs: 30_000,
  });
  const rows = data?.success ? data.data ?? [] : [];
  const more = Math.max(0, (data?.pagination?.total ?? rows.length) - rows.length);

  return (
    <DashCard
      title="Uploads"
      footer={
        <>
          <button type="button" onClick={onUpload} className={studioButton}>
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Upload
          </button>
          <Link to="/brozystudio/posts" className={studioButton}>
            Manage content
          </Link>
        </>
      }
    >
      <CardSection>
        <StorageQuotaMeter variant="compact" />
      </CardSection>

      <CardSection label="Processing now">
        {loading && rows.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is processing right now.</p>
        ) : (
          <ul className="space-y-3.5">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  to={postAnalyticsHref(row)}
                  className="mb-1.5 block truncate text-sm text-foreground hover:underline"
                >
                  {postTitle({ file_title: row.file_title ?? null, filename: row.filename })}
                </Link>
                <Progress row={row} />
              </li>
            ))}
            {more > 0 && (
              <li className="text-xs text-muted-foreground">
                and {more} more in <Link to="/brozystudio/posts" className="underline hover:text-foreground">Content</Link>
              </li>
            )}
          </ul>
        )}
      </CardSection>
    </DashCard>
  );
}
