/**
 * PersonalizationService — Client-side service for managing feed personalization.
 *
 * Handles:
 * - Refreshing user interest profiles on login
 * - Tracking session-level interests for real-time feed adjustment
 * - Managing save/bookmark actions
 * - Sending negative signals (not interested, hide creator, hide category)
 */

/** How often to auto-refresh personalization (4 hours) */
const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const LAST_REFRESH_KEY = 'ff_personalization_last_refresh';

export class PersonalizationService {
  private sessionLikedCategories: Set<string> = new Set();

  /**
   * Check if personalization data needs refreshing and do it if so.
   * Call this on app load / login.
   */
  async refreshIfNeeded(): Promise<void> {
    try {
      const lastRefresh = localStorage.getItem(LAST_REFRESH_KEY);
      const now = Date.now();

      if (lastRefresh && now - parseInt(lastRefresh, 10) < REFRESH_INTERVAL_MS) {
        return; // Recently refreshed, skip
      }

      await this.refresh();
      localStorage.setItem(LAST_REFRESH_KEY, String(now));
    } catch (error) {
      console.error('PersonalizationService.refreshIfNeeded failed:', error);
    }
  }

  /**
   * Force-refresh user's personalization data on the server.
   */
  async refresh(): Promise<boolean> {
    try {
      const res = await fetch('/api/personalization', { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Track a category from an in-session like for real-time feed boosting.
   */
  trackSessionLike(categories: string[] | null | undefined): void {
    if (!categories) return;
    categories.forEach(cat => this.sessionLikedCategories.add(cat));
  }

  /**
   * Get categories liked in this session, for passing to the feed API.
   */
  getSessionCategories(): string[] {
    return Array.from(this.sessionLikedCategories);
  }

  /**
   * Clear session categories (on feed refresh).
   */
  clearSessionCategories(): void {
    this.sessionLikedCategories.clear();
  }

  /**
   * Toggle save/bookmark on a file.
   */
  async toggleSave(fileId: string): Promise<{ saved: boolean; save_count: number } | null> {
    try {
      const res = await fetch('/api/saves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return { saved: data.saved, save_count: data.save_count };
    } catch {
      return null;
    }
  }

  /**
   * Check if a file is saved.
   */
  async isSaved(fileId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/saves?fileId=${fileId}`);
      if (!res.ok) return false;
      const data = await res.json();
      return !!data.saved;
    } catch {
      return false;
    }
  }

  /**
   * Send a "not interested" signal for a specific file.
   */
  async notInterested(fileId: string): Promise<boolean> {
    return this.addNegativeSignal('not_interested', { fileId });
  }

  /**
   * Send a "hide this creator" signal.
   */
  async hideCreator(creatorId: string): Promise<boolean> {
    return this.addNegativeSignal('hide_creator', { creatorId });
  }

  /**
   * Send a "hide this category" signal.
   */
  async hideCategory(category: string): Promise<boolean> {
    return this.addNegativeSignal('hide_category', { category });
  }

  private async addNegativeSignal(
    signalType: string,
    params: { fileId?: string; creatorId?: string; category?: string }
  ): Promise<boolean> {
    try {
      const res = await fetch('/api/feed-signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signalType, ...params }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export const personalizationService = new PersonalizationService();
