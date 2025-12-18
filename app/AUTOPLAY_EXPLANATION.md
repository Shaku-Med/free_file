# How Autoplay with Sound Works (Like YouTube, Pornhub, etc.)

## The Secret: Browser's Media Engagement Score (MES)

Major video sites can autoplay with sound because browsers track **user engagement** with media. Here's how it works:

### 1. **Media Engagement Score (MES)**
- Browsers (especially Chrome) track if users have **previously interacted** with media on your site
- If a user has clicked, touched, or interacted with videos before, the browser "remembers" this
- This builds up a **Media Engagement Score** for your domain
- Once the score is high enough, browsers allow autoplay with sound

### 2. **User Interaction Tracking**
Our `AutoplayService` tracks:
- ✅ Clicks
- ✅ Touch events
- ✅ Keyboard interactions
- ✅ Scroll events

These interactions are stored in `localStorage` to remember user engagement across sessions.

### 3. **How It Works in Practice**

**First Visit:**
1. User visits your site
2. Browser blocks autoplay with sound (no engagement yet)
3. User clicks anywhere on the page
4. We track this interaction
5. User enables autoplay via button
6. Video plays with sound

**Subsequent Visits:**
1. User returns to your site
2. Browser checks Media Engagement Score
3. If score is high enough → autoplay with sound works automatically!
4. If not → shows prompt to enable autoplay

### 4. **The Implementation**

```typescript
// Track user interactions
autoplayService.trackUserInteractions();

// Enable autoplay (stores preference)
autoplayService.enableAutoplay();

// Attempt autoplay with sound
await autoplayService.attemptAutoplayWithSound(video);
```

### 5. **Why This Works**

- **Browser Policy**: Browsers allow autoplay with sound if:
  - User has interacted with the site before
  - Site has high Media Engagement Score
  - User explicitly enabled autoplay

- **User Control**: Users can enable/disable autoplay via the prompt

- **Progressive Enhancement**: 
  - Try autoplay with sound first
  - Fall back to muted autoplay if blocked
  - Show prompt if user wants to enable

### 6. **Best Practices (Like Major Sites)**

1. **Track ALL interactions** - clicks, touches, scrolls
2. **Store preference** - remember user's choice in localStorage
3. **Show clear prompt** - explain why autoplay is blocked
4. **Respect user choice** - don't force autoplay
5. **Use Intersection Observer** - only autoplay when video is visible

### 7. **Testing**

To test autoplay:
1. Clear browser cache and localStorage
2. Visit site - autoplay should be blocked
3. Click anywhere on page
4. Enable autoplay via button
5. Refresh page - autoplay with sound should work!

### 8. **Browser Support**

- ✅ Chrome/Edge: Full support (MES)
- ✅ Firefox: Good support
- ✅ Safari: Limited (stricter policies)
- ✅ Mobile: Varies by browser

---

**This is exactly how YouTube, Pornhub, and other major video sites enable autoplay with sound!**
