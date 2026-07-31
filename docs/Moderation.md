# Moderation and account enforcement

Status: **in progress.**

Covers what happens when the upload pipeline flags content, how account
enforcement is applied, and where it must be enforced.

---

## Principle: one flag, read everywhere

Enforcement lives in **one column**, `users.account_status`, read by every
service that serves bytes:

| Service | Must check |
| --- | --- |
| app (React Router) | feeds, watch, profile, playlists, studio, search |
| GoUpload | reject new uploads |
| loadplay | refuse manifests and segments |
| LoadNodeServer | refuse media |
| app image loader | refuse thumbnails / images |

Duplicating the rule per-service guarantees drift, and drift means one of them
keeps serving content after a ban. Hiding things in the UI alone is not
enforcement. Every read path is checked server side.

---

## The four tiers

Severity is not a single "banned" boolean. Different violations need different
responses, and one of them is not a content-policy matter at all.

| Tier | Trigger | Effect |
| --- | --- | --- |
| `active` | default | full access |
| `strike` | borderline / mislabelled adult | content removed, user notified, strike counter increments |
| `restricted` | confirmed gore, or repeat strikes | content unlisted everywhere, no upload/comment/interact, **appealable, expires** |
| `terminated` | severe, human-confirmed | permanent, no appeal after review |

CSAM is deliberately **not** in this table. See below.

### What `restricted` actually means

The account is not deleted and the user is not locked out. They can sign in and
see their own library, which prevents the "all my work vanished" panic that
turns a moderation action into a support incident.

Blocked:

- their files never appear in feed, search, related, reels, playlists, or any
  other surface
- manifests / segments / images refuse to load for anyone (including via a
  direct link)
- profile page shows the name and a status message, nothing else
- no upload, comment, like, dislike, playlist add
- their own video cards render title and metadata but are not clickable, with no
  edit, share, copy-link or add-to-playlist actions

Allowed:

- sign in, see their own content in their own library and studio
- watch other people's public content

`terminated` is the same, minus the appeal and with no expiry.

---

## CSAM: a separate path, not a tier

This is the part that must not be built like the rest.

- **Detect by hash, not by classifier.** Perceptual hash matching against known
  databases (PhotoDNA, NCMEC hash lists). Cloudflare's CSAM Scanning Tool is
  free and does this without the operator ever holding material.
- **Never acquire material to test.** Possession is a serious crime in every
  jurisdiction, with no testing exemption. Hash-based tooling is testable
  without it.
- **Preserve, do not delete.** Deleting destroys evidence that providers are
  required to retain.
- **Do not notify the uploader.** A removal email tips off the account before
  anything can be preserved or reported.
- **Report.** US providers have a mandatory reporting duty to NCMEC
  (18 U.S.C. §2258A). Confirm the obligations that apply where the service
  operates.

Everything else in this document (the emails, the strike counter, the appeal)
must be skipped on this path.

---

## Guardrails on automated action

The classifier is unreliable in both directions: it missed real gore in testing,
and this class of model routinely false-positives on medical content, news
footage, war reporting, horror and SFX, hunting and butchery, and historical
documentary.

So automation may **flag and restrict**, never **terminate**:

- [ ] `terminated` requires human confirmation, always
- [ ] every action written to `moderation_actions` (who, what, why, when)
- [ ] an appeal route for `strike` and `restricted`
- [ ] `restricted` carries an expiry; permanent needs a human
- [ ] **rate limit the enforcement action itself**: cap automated restrictions
      per hour, so a bad deploy degrades instead of mass-banning the userbase
      overnight

That last one is cheap and is the difference between a bug and an outage of
trust.

---

## Notification (non-CSAM only)

On removal, tell the owner what happened and why:

1. push notification when a subscription exists
2. otherwise a row in `notifications`
3. **and** an email either way

GoUpload calls the app server-to-server (`memories.brozy.org`, `localhost` in
dev) rather than talking to users directly, so notification logic stays in one
place.

---

## Separate bug, fix independently

Playlists currently show adult items to the public. Owner-only visibility for
adult entries is a **privacy fix that affects every user today** and should not
wait for the ban system.

---

## Build order

1. [x] `account_status` on users + `moderation_actions` + `user_strikes`
2. [ ] shared server-side guard used by every read path in the app
3. [ ] loadplay / LoadNodeServer / image loader enforcement
4. [ ] GoUpload upload rejection
5. [ ] detection wiring + notification
6. [ ] appeals + admin review surface
