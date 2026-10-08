# AdHush 🔇

**Auto-mute and skip ads on Amazon MX Player** — so you can switch to another tab while you watch, without jumping back every time an ad starts.

- 🔇 **Mutes the tab** the moment an ad starts, and turns the sound back on when your show returns
- ⏩ **Skips ads**: clicks "Skip Ad" when it appears, otherwise fast-forwards the ad at 16×
- ↩️ **Brings you back** to the show's tab when the ad break ends (optional)
- 🔔 **Notifies you** when the episode finishes
- 🔒 **No tracking**: collects no data, talks to no server

Works in **Google Chrome, Microsoft Edge and Brave** on desktop.

**[⬇️ Download the latest version](https://github.com/AfzalSurti/Adhush/releases/latest/download/adhush.zip)**

---

## Install

AdHush isn't on the Chrome Web Store yet, so you install it in developer mode. It takes about a minute.

1. **Download** [`adhush.zip`](https://github.com/AfzalSurti/Adhush/releases/latest/download/adhush.zip) (or pick a version on the [Releases](https://github.com/AfzalSurti/Adhush/releases) page).
2. **Unzip** it into a folder you'll keep, for example `Documents\AdHush`. Don't delete or move this folder later, because Chrome loads the extension from it.
3. Open **`chrome://extensions`** (in Edge: `edge://extensions`).
4. Turn on **Developer mode** (top-right switch).
5. Click **Load unpacked** and select the folder that contains `manifest.json`.
6. Click the puzzle icon 🧩 in the toolbar and **pin AdHush**.
7. Open or **refresh** an episode on [mxplayer.in](https://www.mxplayer.in).

## Update to a new version

You don't need to remove AdHush. Your settings are kept.

1. Download the new [`adhush.zip`](https://github.com/AfzalSurti/Adhush/releases/latest/download/adhush.zip).
2. Unzip it **into your existing AdHush folder** and choose **Replace the files**.
3. Open `chrome://extensions` and click the **reload ↻** icon on the AdHush card. Check that it shows the new version number.
4. Refresh your MX Player tab.

Watch this repo (**Watch → Custom → Releases**) to get an email when a new version is out.

## Settings

Click the AdHush icon to open the popup:

| Switch | What it does |
|---|---|
| **Auto-mute ads** | Master on/off. Mutes the tab during ads and unmutes after |
| **Skip ads** | Clicks "Skip Ad" when available, otherwise plays the ad at 16× speed |
| **Bring me back after ads** | Switches to the show's tab when the ad break ends |
| **Episode finished alert** | Desktop notification when the episode ends |
| **Ad break over alert** | Notification when the show resumes |
| **Debug badge** | Shows on the page what AdHush detects and why |

If you mute the tab yourself, AdHush leaves it muted.

## How it works

AdHush watches the video player on the page and treats it as an ad when any of these appear:

- the main video switches to a short clip (under 3 minutes)
- a separate short video plays while the show is paused, or sits inside an ad container
- a Google ad frame covers the paused show
- an "Ad", "Ad 1 of 2" or "Skip Ad" label is shown on the player

During an ad it mutes the tab, then clicks Skip or speeds the ad up. If the ad runs inside Google's protected ad frame, the page can't reach it, so AdHush only mutes it. When the show plays again, the sound and your playback speed come back.

## Something not working?

1. Turn on **Debug badge** in the popup.
2. When the problem happens (an ad that wasn't muted, or the show muted by mistake), open the popup and click **Copy diagnostics**.
3. [Open an issue](https://github.com/AfzalSurti/Adhush/issues) and paste what was copied. It shows exactly what the player looked like, so the detection can be fixed.

## Privacy

AdHush has no servers and collects nothing. Your settings and the "ads muted" counter are stored only in your own browser.

Permissions it asks for:
- **storage**: save your settings and counter
- **notifications**: episode-finished and ad-break alerts
- **access to mxplayer.in only**: so it can watch the player. It runs on no other site.

## For the maintainer: publishing a new version

1. Make your changes and test them (reload ↻ in `chrome://extensions`, refresh MX Player).
2. Increase `"version"` in `manifest.json` (for example `1.2.0` → `1.3.0`).
3. Commit and push:
```bash
   git add .
   git commit -m "v1.3.0: what changed"
   git push
```
4. Zip the extension files (everything except `.git`, `README.md`, `LICENSE`, `.gitignore`) into a file named exactly **`adhush.zip`**.
5. Go to [Releases → New release](https://github.com/AfzalSurti/Adhush/releases/new), create tag `v1.3.0`, write what changed, attach `adhush.zip`, and publish.

The download links in this README always point to the newest release, so they never need changing.

## Note

AdHush is an independent project and is not affiliated with Amazon or MX Player. Free streaming is paid for by ads; muting or skipping them may go against the site's terms of use. Use it at your own discretion.

## License

[MIT](LICENSE) © 2026 Afzal Surti