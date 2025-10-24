import { Octokit } from '@octokit/rest';

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string = 'Memories') {
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
  }

  async createRepository(): Promise<void> {
    try {
      await this.octokit.rest.repos.createForAuthenticatedUser({
        name: this.repo,
        private: false,
        auto_init: true
      });
    } catch (error: any) {
      if (error.status === 422 && error.message.includes('already exists')) {
        console.log('Repository already exists');
      } else {
        throw error;
      }
    }
  }

  async uploadFile(
    filePath: string,
    content: string,
    message: string = 'Upload file'
  ): Promise<string> {
    try {
      const response = await this.octokit.rest.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path: filePath,
        message,
        content: content
      });
      return response.data.content?.sha || '';
    } catch (error) {
      console.error('Error uploading file to GitHub:', error);
      throw error;
    }
  }

  async uploadFileBuffer(
    filePath: string,
    buffer: ArrayBuffer,
    message: string = 'Upload file'
  ): Promise<string> {
    const content = Buffer.from(buffer).toString('base64');
    return this.uploadFile(filePath, content, message);
  }

  async getFileContent(filePath: string): Promise<string | null> {
    try {
      const response = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: filePath
      });

      if ('content' in response.data) {
        return Buffer.from(response.data.content, 'base64').toString();
      }
      return null;
    } catch (error) {
      console.error('Error getting file content:', error);
      return null;
    }
  }
}
