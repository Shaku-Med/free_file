# Memories on LG (webOS)

This folder is the LG TV app. Your LG does not run Android, so the Android Studio project under androidtv will not install here. That project is still useful for Chromecast with Google TV, Nvidia Shield, Fire TV, and other Android based boxes. For this LG, this webos package is the one that matters.

## What the app does

It is a thin shell. When you open Memories it tries to load the live site at memories.brozy.org. On many LG sets the built in app web engine is older than the desktop site expects, so you may only see the green Memories logo with no layout. In that case the app opens the TV browser instead, where the full site can load.

The Magic Remote works like a mouse on the page.

## One time setup on the TV

1. Install the Developer Mode app from the LG Content Store.
2. Sign in with your LG developer account.
3. Turn Dev Mode Status on.
4. Turn Key Server on.
5. Note the IP address and the passphrase on that screen.
6. Keep the TV and your PC on the same WiFi.

Dev mode sessions expire. Open the Developer Mode app again and tap Extend when the timer gets low, or apps you sideloaded can disappear.

## One time setup on your PC

Install the webOS CLI:

```
npm install -g @webosose/ares-cli
```

Register the TV. Replace the sample values with what your Developer Mode screen shows:

```
ares-setup-device -a lg -i "host=192.168.0.42" -i "port=9922" -i "username=prisoner" -f lg
```

With Key Server still on, fetch the key and type the passphrase when asked (example only: `AB12CD`):

```
ares-novacom --device lg --getkey
```

## Build, install, launch

From this webos folder:

```
ares-package .
ares-install --device lg .\org.brozy.memories.tv_1.0.2_all.ipk
ares-launch --device lg org.brozy.memories.tv
```

In PowerShell do not use `.\*.ipk`. Use the full filename ares-package prints.

To open it later from the TV alone, find Memories in your apps list and launch it like any other app.

## Quick troubleshooting

SSH errors about authentication usually mean getkey never succeeded or Key Server was off. Run getkey again with Key Server on.

If you only see the green logo and no menus or text, the in app engine could not run the site. Use the Open in TV Browser button on the splash, or open https://memories.brozy.org in the LG browser app yourself.

Android Studio is the wrong tool for this LG. Use these ares commands instead.
