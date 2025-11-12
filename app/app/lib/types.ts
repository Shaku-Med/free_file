export interface FileType {
  id: string;
  created_at: string;
  endpoint: string;
  filename: string;
  unique_id: string;
  file_type: string;
  file_size: number;
  is_adult?: boolean;
}