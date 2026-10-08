# AdHush – Auto-mute ads for MX Player

A Chrome extension (also works in Edge and Brave) that mutes the MX Player tab while an ad plays and turns the sound back on when your show returns. It can also notify you when an episode finishes, so you can work in another tab without checking.

## Install (developer mode)

1. Unzip `adhush.zip` to a folder you'll keep (for example `Documents/adhush`).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `adhush` folder.
4. Pin the extension (puzzle icon → pin AdHush) so you can see the badge.
5. Open any episode on mxplayer.in. If the page was already open, reload it once.

## How it works

The content script checks the player several times a second (and on every video event, so it still reacts in a background tab). It treats the moment as an ad when any of these show up:

- the main video element switches to a short clip (under 3 minutes)
- a separate short, un-muted video starts playing while the show is paused, or sits inside an ad container (`ima`, `ad-container`, …)
- a Google ad frame (IMA / DoubleClick) is visible over the paused show
- an "Ad", "Ad 1 of 2" or "Skip Ad" label is visible on the player for two checks in a row

When the ad ends and the show is playing again, the tab is unmuted within about half a second. Between ads in the same break it waits up to 4 seconds before unmuting, so you don't get a blip of sound.

If you mute the tab yourself, AdHush leaves it alone and won't unmute it.

### Skipping ads (v1.1)

While an ad is muted, AdHush also tries to get rid of it:

1. If a **Skip / Skip Ad** button is visible, it clicks it.
2. Otherwise, if the ad video is reachable on the page, it plays it at **16× speed** (a 30-second ad ends in about 2 seconds). Your normal playback speed is restored as soon as the show returns.
3. If the ad plays inside Google's own ad frame, the page can't touch it, so it stays muted only. The debug pill shows "mute only" in that case.

Turn this off with the **Skip ads** switch if you'd rather just mute.

### Bring me back after ads (v1.2)

Turn on **Bring me back after ads** and, when an ad break ends and the show is playing again, Chrome switches to the MX Player tab and raises its window. It only fires when the show actually resumes, not in the short gaps between two ads. When this is on, the "Ad break over" notification is skipped since you're already being taken there.

## Popup

- **Auto-mute ads** – master on/off switch
- **Episode finished alert** – desktop notification when the episode ends; clicking it jumps to the tab
- **Ad break over alert** – notification when the show resumes after an ad
- **Debug badge** – a pill in the bottom-left corner of the page showing what AdHush detects and why
- **Copy diagnostics** – copies a JSON snapshot of the player (videos, frames, on-screen text) for tuning detection

## If an ad isn't caught (or the show gets muted by mistake)

1. Turn on **Debug badge**.
2. When the problem happens, open the popup and click **Copy diagnostics**.
3. Paste the JSON to the developer. It shows exactly what the page looked like, so the detection rule can be adjusted.

## Publishing to the Chrome Web Store

- Register a developer account (one-time US$5 fee).
- Zip the folder contents (manifest.json at the root of the zip) and upload.
- Privacy: AdHush collects no data. Settings and the ads-muted counter stay in your browser's extension storage.
- Permissions: `storage` (settings, stats), `notifications` (alerts), host access to `mxplayer.in` only.
