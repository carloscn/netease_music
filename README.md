# NetEase Music Player

A standalone Linux desktop app that wraps NetEase Cloud Music's official web player
([music.163.com/st/webplayer](https://music.163.com/st/webplayer)) using Electron
(Chromium), packaged as an installable `.deb`.

It does not modify or reimplement the web player — it just gives it its own window,
icon, and app entry so you don't need to keep a browser tab open for it.

## Install

Download the `.deb` from [Releases](https://github.com/carloscn/netease_music/releases)
and install:

```bash
sudo dpkg -i netease-music-player_<version>_amd64.deb
sudo apt-get install -f   # only needed if dependencies are missing
```

Launch it from your application menu ("NetEase Music Player") or run
`netease-music-player` from a terminal.

Uninstall:

```bash
sudo dpkg -r netease-music-player
```

## Build from source

Requires Node.js (tested with Node 24) and npm.

```bash
npm install
npm start        # run the app directly
npm run dist      # build dist/netease-music-player_<version>_amd64.deb
```

## Notes

- External links (login redirects, help pages, etc.) that leave the `music.163.com`
  domain open in your system's default browser instead of inside the app window.
- The app icon is an original generic music-note icon, not NetEase's trademarked logo.
- This project is unofficial and not affiliated with NetEase.
