/**
 * Autoplay Service - Enables autoplay with sound by tracking user interactions
 * 
 * How it works (like Pornhub, YouTube):
 * 1. Tracks user interactions (clicks, touches, scrolls)
 * 2. Stores autoplay preference in localStorage
 * 3. Uses browser's Media Engagement Score (MES) - built into Chrome
 * 4. Attempts autoplay with sound, falls back to muted if blocked
 * 5. Provides user control to enable autoplay
 */

class AutoplayService {
  private hasUserInteracted: boolean = false;
  private autoplayEnabled: boolean = false;
  private interactionListeners: Array<() => void> = [];
  private initialized: boolean = false;
  private readonly STORAGE_KEY = 'autoplay_enabled';
  private readonly INTERACTION_KEY = 'user_has_interacted';

  constructor() {
    // Don't initialize during SSR - wait for browser environment
    if (typeof window !== 'undefined') {
      this.initialize();
    }
  }

  /**
   * Check if we're in browser environment
   */
  private isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  }

  /**
   * Lazy initialization - ensures we're in browser before accessing localStorage/document
   */
  private ensureInitialized() {
    if (!this.initialized && this.isBrowser()) {
      this.initialize();
    }
  }

  private initialize() {
    if (!this.isBrowser()) return;

    // Check if user has previously enabled autoplay
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      this.autoplayEnabled = stored === 'true';

      // Check if user has interacted before
      const hasInteracted = localStorage.getItem(this.INTERACTION_KEY) === 'true';
      this.hasUserInteracted = hasInteracted;

      // Track user interactions to build Media Engagement Score
      this.trackUserInteractions();
      
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize AutoplayService:', error);
    }
  }

  /**
   * Track all user interactions to build browser's Media Engagement Score
   * This is how sites like YouTube/Pornhub enable autoplay
   */
  private trackUserInteractions() {
    if (!this.isBrowser() || typeof document === 'undefined') return;

    const interactionEvents = ['click', 'touchstart', 'keydown', 'scroll'];
    
    const handleInteraction = () => {
      if (!this.hasUserInteracted && this.isBrowser()) {
        this.hasUserInteracted = true;
        try {
          localStorage.setItem(this.INTERACTION_KEY, 'true');
        } catch (error) {
          console.error('Failed to save interaction:', error);
        }
      }
    };

    // Use passive listeners for better performance
    interactionEvents.forEach(event => {
      const options = event === 'scroll' ? { passive: true, once: true } : { once: true };
      document.addEventListener(event, handleInteraction, options);
      this.interactionListeners.push(() => {
        document.removeEventListener(event, handleInteraction);
      });
    });
  }

  /**
   * Enable autoplay - called when user clicks "Enable Autoplay" button
   */
  enableAutoplay(): void {
    this.ensureInitialized();
    this.autoplayEnabled = true;
    if (this.isBrowser()) {
      try {
        localStorage.setItem(this.STORAGE_KEY, 'true');
        this.hasUserInteracted = true;
        localStorage.setItem(this.INTERACTION_KEY, 'true');
      } catch (error) {
        console.error('Failed to save autoplay preference:', error);
      }
    }
  }

  /**
   * Disable autoplay
   */
  disableAutoplay(): void {
    this.ensureInitialized();
    this.autoplayEnabled = false;
    if (this.isBrowser()) {
      try {
        localStorage.setItem(this.STORAGE_KEY, 'false');
      } catch (error) {
        console.error('Failed to save autoplay preference:', error);
      }
    }
  }

  /**
   * Check if autoplay is enabled
   */
  isAutoplayEnabled(): boolean {
    this.ensureInitialized();
    return this.autoplayEnabled;
  }

  /**
   * Check if user has interacted with the site
   */
  hasUserInteractedWithSite(): boolean {
    this.ensureInitialized();
    return this.hasUserInteracted;
  }

  /**
   * Autoplay without changing mute  `HTMLVideoElement` should already match saved player settings
   * (PlayerContext). Does not force muted fallback (that stuck users in mute and fought manual unmute).
   * Returns true when playback is unmuted after a successful play().
   */
  async attemptAutoplayWithSound(video: HTMLVideoElement): Promise<boolean> {
    this.ensureInitialized();
    if (!this.autoplayEnabled) {
      return false;
    }

    try {
      await video.play();
      return !video.muted;
    } catch (error: unknown) {
      const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: string }).name) : '';
      if (name) console.log('Autoplay blocked:', name);
      return false;
    }
  }

  /**
   * Check if browser supports autoplay with sound
   * Uses the browser's Media Engagement Score
   */
  async canAutoplayWithSound(): Promise<boolean> {
    if (!this.isBrowser() || typeof document === 'undefined') {
      return false;
    }

    // Create a test video element
    const testVideo = document.createElement('video');
    testVideo.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAG1tZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1MiByMjg1NCBlOWE1OTAzIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsaWdodCAyMDA3LTIwMTggLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1YnM9MSBtcHhmPTIgbXB4bT0xIG1weGU9MSBtcHhtPTEgbXB4YT0wIHN1YnM9MSBzdWI9MSBzdWIyPTEgbXA0PTA=';
    testVideo.muted = false;
    testVideo.playsInline = true;
    testVideo.setAttribute('playsinline', '');
    
    try {
      await testVideo.play();
      testVideo.pause();
      testVideo.remove();
      return true;
    } catch (error) {
      testVideo.remove();
      return false;
    }
  }

  /**
   * Cleanup listeners
   */
  cleanup() {
    this.interactionListeners.forEach(cleanup => cleanup());
    this.interactionListeners = [];
  }
}

// Export singleton instance
export const autoplayService = new AutoplayService();
