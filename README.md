# Quiet hours

A calm, minimal site: a looping night-city video (no sound) with three ambient tracks
playing one after another, then starting over.

## Deploy to GitHub Pages

1. Create a new repository on GitHub (public, or private if your plan supports Pages).
2. Upload every file in this folder, or from a terminal:

       git init
       git add .
       git commit -m "Quiet hours"
       git branch -M main
       git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
       git push -u origin main

3. In the repository, open **Settings → Pages**. Under **Build and deployment**, choose
   **Deploy from a branch**, pick `main` and `/ (root)`, then save.
4. After a minute or two the site is live at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

Every file is under 25 MB, so you can upload with GitHub's "Add file → Upload files" page:
unzip the folder and drag all the files in. There are no sub-folders, so everything uploads in
one go (GitHub accepts up to 100 files per upload). The hidden `.nojekyll` file is optional.

The long audio tracks and the video are cut into parts, and the page joins them back together,
so each track still shows as one continuous bar you can seek along.

## Change the music

Put audio files next to `index.html` and list them in the `TRACKS` list at the top of `script.js`.
Files over 25 MB can be cut into parts with ffmpeg, for example into 15-minute pieces:

    ffmpeg -i long.mp3 -c copy -f segment -segment_time 900 -segment_start_number 1 long-part%d.mp3

List each part in order with its length in seconds (find it with `ffprobe`).

## Notes

- Browsers don't allow sound until someone clicks or taps, so the site opens with a **Begin**
  screen. The music starts the moment it's pressed.
- Controls fade away after a few seconds of stillness. Move the mouse or tap the scene to bring them back.
- Shortcuts: Space play/pause, N next, P previous, ← → skip 10 seconds, ↑ ↓ volume, M mute, F full screen.
- Volume, dimming, clock and video settings are remembered in the browser.
- On iPhones the volume slider is hidden (the device's own buttons control volume).
