# ChatConnect — React LAN Chat

A small real-time Alice/Bob chat built with React, Vite, Express, and Socket.IO. It is designed to run on one Windows laptop and be opened from other laptops on the same Wi-Fi.

## Requirements
- Node.js (npm is included)
- Windows laptop for the server
- All client laptops connected to the same Wi-Fi network

## Run in development mode
Open PowerShell in this project folder:

```powershell
npm install
npm run dev
```

Vite serves the UI on port 5173 and the Socket.IO server listens on port 3001. The terminal prints the Vite Network URL. Share that `http://<SERVER-LAN-IP>:5173` address with Alice and Bob.

## Recommended: run a production build
Stop the dev server with `Ctrl+C`, then run:

```powershell
npm run build
npm start
```

The built app and Socket.IO backend are served together on port 3001. Share:

`http://<SERVER-LAN-IP>:3001`

## Find the server laptop's IPv4 address
In PowerShell, run:

```powershell
ipconfig
```

Under the active Wi-Fi adapter, find `IPv4 Address`, for example `192.168.1.10`. Do not use `127.0.0.1` or `localhost` on the other laptops.

## If another laptop cannot connect
1. Confirm all laptops are on the same Wi-Fi (not a guest network with client isolation).
2. Keep the server laptop awake and keep `npm run dev` or `npm start` running.
3. Allow Node.js through Windows Defender Firewall on Private networks, or allow inbound TCP ports 5173 and 3001 for development / 3001 for production.
4. Test `http://<SERVER-LAN-IP>:3001/health` from a browser; it should show `{"ok":true,"service":"ChatConnect"}`.
5. If the Wi-Fi has client isolation, use a different trusted network or a mobile hotspot you control.

## Notes
- No installation is needed on Alice's or Bob's laptops; a modern browser is enough.
- Messages are broadcast to everyone who has joined this room.
- The last 100 messages are held in server memory. They are lost when the server restarts.
- This is a learning/demo project, not an internet-facing secure messenger. Do not expose it to the public internet without authentication, access controls, and transport security.
- The UI loads Google Fonts if internet access is available; it falls back to system fonts if not.
