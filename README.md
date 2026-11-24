# Trust-Verified Barcode & GPS Attendance System (`Code.gs` + `Index.html`)

Project submission package for **Terminal 3 — Build+Scale Agent Micro Grant** (Submission window: `2026/11/10 13:00` to `2026/12/24 22:59` UTC+7).

## Overview
This project implements a location-verified, device-bound barcode attendance and automated reporting workflow built with **Google Apps Script**, **HTML5 Geolocation**, **Google Sheets**, **Google Drive**, and **Telegram Bot API**:
- **Signed Barcode Verification (`buatHash` & `doGet`)**: Generates a 10-character hex `SHA-256` signature (`nim + SALT_RAHASIA`) to validate incoming attendance links before rendering `Index.html`.
- **Anti-Spoofing & Device Binding (`prosesAbsensi` & `Index.html`)**:
  - Flags low-accuracy/spoofed coordinates (`acc < 1`).
  - Binds a client `deviceId` (persisted in `localStorage`) to the user's record in Sheet `Data` (column 6) to deter proxy attendance (`TITIP ABSEN`).
  - Computes distance to geofence target (`haversine`, `maxRadius = 0.1` km = 100m) and classifies punctuality (`BERHASIL`, `BERHASIL (TERLAMBAT)`, `BERHASIL (PULANG AWAL)`).
- **Passive Location Verification (`verifikasiLokasiSilent` & `aktifkanNinjaTracking`)**: Periodically checks location between `07:00` and `15:59` on visibility changes and 15-minute intervals, recording outside-radius events in Sheet `Log` (columns 11–12) and alerting via Telegram.
- **Automated Reporting & Telegram Webhook (`doPost`, `buatRekapOtomatis`, `laporanBerdasarkanTanggal`, `buatDanKirimBarcode`)**: Supports `/rekap`, `/rekapharian`, `/sinkron`, `/barcode`, `/cek`, and `/rekap_id`, generates QR codes saved to Google Drive, updates Sheet `Rekap`, and exports daily `.xlsx` reports.

## Repository Structure
```text
├── README.md
├── .gitignore
├── apps_script/
│   ├── Code.gs
│   └── Index.html
└── docs/
    └── BUILD_SUBMISSION.md
```

## Security & Configuration Notes
- Replace placeholder constants in `apps_script/Code.gs` (`YOUR_TELEGRAM_BOT_TOKEN`, `YOUR_TELEGRAM_CHAT_ID`, `YOUR_GOOGLE_DRIVE_FOLDER_ID`, `YOUR_SECRET_SALT`) with your own values—ideally stored in `PropertiesService.getScriptProperties()` rather than hardcoded literals.
- Keep `webAppUrl` in `Code.gs` pointing to your own Google Apps Script Web App deployment (`/exec`).
