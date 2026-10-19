# NetEase Music Player

A standalone Linux desktop app that wraps NetEase Cloud Music's official web player
([music.163.com/st/webplayer](https://music.163.com/st/webplayer)) using Electron
(Chromium), packaged as an installable `.deb`.

It does not modify or reimplement the web player — it just gives it its own window,
icon, and app entry so you don't need to keep a browser tab open for it.

## Install

From the mltz apt repository (Ubuntu 26.04 `resolute`; use `noble` on 24.04):

```bash
sudo curl -fsSL https://apt.mltz.tech/key.gpg -o /usr/share/keyrings/mltz.gpg
echo "deb [signed-by=/usr/share/keyrings/mltz.gpg] https://apt.mltz.tech resolute main" | sudo tee /etc/apt/sources.list.d/mltz.list
sudo apt-get update
sudo apt-get install netease-music-player
```

Or download the `.deb` from [Releases](https://github.com/carloscn/netease_music/releases)
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
