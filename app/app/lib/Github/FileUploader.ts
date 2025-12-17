import { GitHubClient } from './GitHubClient';

export interface UploadResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export class FileUploader {
  private githubClient: GitHubClient;

  constructor(githubToken: string, owner: string) {
    this.githubClient = new GitHubClient(githubToken, owner);
  }

  async initializeRepository(): Promise<void> {
    try {
      await this.githubClient.createRepository();
    } catch (error) {
      console.error('Failed to initialize repository:', error);
      throw new Error(`Repository initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private getDateFolder(): string {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    return `${day}_${month}_${year}`;
  }

  async uploadFile(
    file: File,
    uniqueID: string,
    filename: string,
    isAdult?: boolean,
    title?: string,
    description?: string
  ): Promise<UploadResult> {
    try {
      const dateFolder = this.getDateFolder();
      const filePath = `${dateFolder}/${uniqueID}/${filename}`;
      const metadata = {
        is_adult: isAdult,
        title: title,
        description: description
      };
      
      const buffer = await file.arrayBuffer();
      const message = `Upload ${filename} for ${uniqueID}`;
      
      const sha = await this.githubClient.uploadFileBuffer(
        filePath,
        buffer,
        message
      );

      return {
        success: true,
        filePath
      };
    } catch (error) {
      console.error('Error uploading file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async uploadMultipleFiles(
    files: { file: File; uniqueID: string; filename: string }[]
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = [];
    
    for (const fileData of files) {
      const result = await this.uploadFile(
        fileData.file,
        fileData.uniqueID,
        fileData.filename
      );
      results.push(result);
    }
    
    return results;
  }
}
