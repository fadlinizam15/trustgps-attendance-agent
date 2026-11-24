// --- KONFIGURASI GLOBAL ---
var token = "YOUR_TELEGRAM_BOT_TOKEN"; 
var chatId = "YOUR_TELEGRAM_CHAT_ID"; 
var folderId = "YOUR_GOOGLE_DRIVE_FOLDER_ID"; 
var webAppUrl = "https://script.google.com/macros/s/AKfycbxMpabcvbrJXtoq26Bxvl5ifX5Gc73OVJGWobprdAhxdLNinNcsS-BafZsVj7k-jt7gjg/exec";
var SALT_RAHASIA = "YOUR_SECRET_SALT";

// 1. FUNGSI PEMBUAT KUNCI (HASH)
function buatHash(nim) {
var signature = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, nim + SALT_RAHASIA);
return signature.map(function(byte) {
return ('0' + (byte & 0xFF).toString(16)).slice(-2);
}).join('').substring(0, 10);
}

// 2. FUNGSI PENERIMA AKSES (DO GET)
function doGet(e) {
var nim = e.parameter.nim || "";
var key = e.parameter.key || "";
var v = e.parameter.v || ""; 

if (v !== buatHash(nim)) {
return HtmlService.createHtmlOutput("<center><h2>⚠️ Akses Ditolak</h2><p>Barcode tidak sah.</p></center>");
}

var tmp = HtmlService.createTemplateFromFile('Index');
tmp.nim = nim;
tmp.key = key;

return tmp.evaluate()
.setTitle("Absensi GPS - " + nim)
.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
.addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 3. FUNGSI LOGIKA WAKTU INDONESIA
function dapatkanWaktuLengkap() {
var sekarang = new Date();
var hariNama = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
var bulanNama = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
var jam = Utilities.formatDate(sekarang, "GMT+7", "HH:mm:ss");
return hariNama[sekarang.getDay()] + ", " + sekarang.getDate() + " " + bulanNama[sekarang.getMonth()] + " " + sekarang.getFullYear() + " [" + jam + " WIB]";
}

// 4. FUNGSI PROSES ABSENSI UTAMA
function prosesAbsensi(nim, key, lat, lon, acc, deviceId, browserInfo) {
var ss = SpreadsheetApp.getActiveSpreadsheet();
var dbSheet = ss.getSheetByName("Data");
var logSheet = ss.getSheetByName("Log");
var data = dbSheet.getDataRange().getValues();

if (!nim || nim === "undefined") return { status: "ERROR", pesanSpesifik: "NIM tidak terbaca. Scan ulang." };

var tipeHP = browserInfo.includes("Android") ? "HP Android" : (browserInfo.includes("iPhone") ? "iPhone (iOS)" : "Laptop/PC Windows");
var targetLat = -2.997309; 
var targetLon = 104.780529; 
var maxRadius = 0.1; 
var waktuLengkap = dapatkanWaktuLengkap();

var mapUrl = "https://www.google.com/maps?q=" + lat + "," + lon;
var linkMapsFormula = '=HYPERLINK("' + mapUrl + '"; "📍 Lihat Lokasi")';

if (acc < 1) { 
logSheet.appendRow([new Date(), "SUSPECT", nim, "🚨 GAGAL: Fake GPS", lat + "," + lon, acc, linkMapsFormula, tipeHP]);
return { status: "GAGAL: Terdeteksi Fake GPS", nama: "-", nim: nim, waktu: "--:--:--" };
}

for (var i = 1; i < data.length; i++) {
if (String(data[i][1]).trim() === String(nim).trim()) {
var nama = data[i][0];
var registeredDevice = String(data[i][5] || "").trim(); 

if (registeredDevice === "") {
dbSheet.getRange(i + 1, 6).setValue(deviceId);
registeredDevice = deviceId;
} else if (registeredDevice !== deviceId) {
kirimNotifPeringatanHP(nama, nim, lat, lon, tipeHP, waktuLengkap);
logSheet.appendRow([new Date(), nama, nim, "⚠️ TITIP ABSEN", lat + "," + lon, acc, linkMapsFormula, tipeHP]);
return { status: "DITOLAK: TITIP ABSEN", pesanSpesifik: "Gunakan HP Anda sendiri!", nama: nama, nim: nim };
}

var jarak = haversine(lat, lon, targetLat, targetLon);

if (jarak <= maxRadius) {
var sekarang = new Date();
var jam = sekarang.getHours();
var menit = sekarang.getMinutes();
var finalStatus = "";

if (jam < 12) { 
finalStatus = (jam < 11 || (jam == 11 && menit <= 30)) ? "BERHASIL" : "BERHASIL (TERLAMBAT)";
} else {
finalStatus = (jam > 15 || (jam == 15 && menit >= 30)) ? "BERHASIL" : "BERHASIL (PULANG AWAL)";
}

var waktuSaja = Utilities.formatDate(sekarang, "GMT+7", "HH:mm:ss");
logSheet.appendRow([sekarang, nama, nim, finalStatus, lat + "," + lon, acc, linkMapsFormula, tipeHP]);
SpreadsheetApp.flush();
kirimNotifTelegram(nama, nim, finalStatus, lat, lon, tipeHP, waktuLengkap);
buatRekapOtomatis();
return { status: finalStatus, nama: nama, nim: nim, waktu: waktuSaja };
} else {
var selisihJarak = (jarak * 1000).toFixed(0);
logSheet.appendRow([new Date(), nama, nim, "GAGAL: Luar Jangkauan (" + selisihJarak + "m)", lat + "," + lon, acc, linkMapsFormula, tipeHP]);
kirimKeTelegram("⚠️ *PERCOBAAN ABSEN LUAR RADIUS*\n👤 Nama: " + nama + "\n📏 Jarak: " + selisihJarak + " meter\n📍 [Cek Lokasi](" + mapUrl + ")");
return { status: "DITOLAK: LUAR JANGKAUAN", pesanSpesifik: "Jarak Anda " + selisihJarak + "m dari kantor.", nama: nama, nim: nim };
}
}
}
return { status: "DATA TIDAK DITEMUKAN" };
}

// 5. FUNGSI TELEGRAM
function kirimKeTelegram(teks) {
UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
"method": "post", "contentType": "application/json",
"payload": JSON.stringify({ "chat_id": chatId, "text": teks, "parse_mode": "HTML" }), "muteHttpExceptions": true
});
}

function kirimNotifTelegram(nama, nim, status, lat, lon, device, waktu) {
var mapUrl = "https://www.google.com/maps?q=" + lat + "," + lon;
var pesan = "<b>🔔 ABSENSI MASUK</b>\n👤 <b>" + nama + "</b>\n🆔 NIM: " + nim + "\n📊 Status: " + status + "\n📍 <a href='" + mapUrl + "'>Lihat Lokasi</a>";
kirimKeTelegram(pesan);
}

function kirimNotifPeringatanHP(nama, nim, lat, lon, device, waktu) {
var mapUrl = "https://www.google.com/maps?q=" + lat + "," + lon;
var pesan = "<b>🚨 ALARM TITIP ABSEN!</b>\n👤 Akun: <b>" + nama + "</b>\n🆔 NIM: " + nim + "\n📱 Device: " + device + "\n📍 <a href='" + mapUrl + "'>Cek Pelanggaran</a>";
kirimKeTelegram(pesan);
}

function buatRekapOtomatis() {
var ss = SpreadsheetApp.getActiveSpreadsheet();
var logSheet = ss.getSheetByName("Log");
var rekapSheet = ss.getSheetByName("Rekap");
var dataSheet = ss.getSheetByName("Data");
if (!rekapSheet || !dataSheet) return;

var daftar = dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1, 2).getValues();
var logs = logSheet.getDataRange().getValues();
var hasil = [];

for (var i = 0; i < daftar.length; i++) {
var nama = daftar[i][0], nim = String(daftar[i][1]);
var h = 0, t = 0, l = 0, tp = 0;
var nj = 0; // <-- Ini variabel baru untuk menampung info Ninja

for (var j = 1; j < logs.length; j++) {
if (String(logs[j][2]) === nim) {
var st = String(logs[j][3]);

// Fungsi lama tetap jalan:
if (st === "BERHASIL") h++;
if (st.includes("TERLAMBAT") || st.includes("PULANG AWAL")) t++;
if (st.includes("Luar Jangkauan")) l++;
if (st.includes("TITIP ABSEN")) tp++;

// --- TAMBAHAN INFO NINJA ---
// Cek Kolom K (Indeks 10), jika ada isinya berarti pernah terdeteksi Ninja
var infoNinja = String(logs[j][10] || "");
if (infoNinja !== "") {
nj++;
}
}
}
// Menambahkan variabel 'nj' di urutan terakhir (Kolom ke-7 / G)
hasil.push([nama, nim, h, t, l, tp, nj]);
}

// Perubahan: Range diperluas menjadi 7 kolom (G) agar info Ninja tampil
rekapSheet.getRange(2, 1, hasil.length, 7).setValues(hasil);
}

function triggerKirimRekapHarian() {
var tgl = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");
laporanBerdasarkanTanggal(tgl);
}

function buatDanKirimBarcode(nim) {
try {
var ss = SpreadsheetApp.getActiveSpreadsheet();
var dataSheet = ss.getSheetByName("Data");
var data = dataSheet.getDataRange().getValues();
var namaMhs = "Tanpa_Nama";
var rowIdx = -1;
for (var i = 1; i < data.length; i++) {
if (String(data[i][1]) === String(nim)) {
namaMhs = data[i][0].toString().replace(/\s+/g, '_');
rowIdx = i + 1;
break;
}
}
var hash = buatHash(nim);
var linkAbsensi = webAppUrl + "?nim=" + nim + "&v=" + hash;
var qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" + encodeURIComponent(linkAbsensi);
var response = UrlFetchApp.fetch(qrUrl);
var namaFile = "QR_" + namaMhs + "_" + nim + ".png";
var blob = response.getBlob().setName(namaFile);
var folder = DriveApp.getFolderById(folderId);
var fileLama = folder.getFilesByName(namaFile);
while (fileLama.hasNext()) { fileLama.next().setTrashed(true); }
var file = folder.createFile(blob);
var linkDrive = file.getUrl();
if (rowIdx != -1) { dataSheet.getRange(rowIdx, 8).setValue(linkDrive); }
var payload = {
'chat_id': chatId, 'photo': blob, 'parse_mode': 'HTML',
'caption': "✅ <b>QR GENERATED</b>\n👤 Nama: <b>" + namaMhs.replace(/_/g, ' ') + "</b>\n🆔 NIM: <code>" + nim + "</code>\n📂 Link: " + linkDrive
};
UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendPhoto", {'method': 'post', 'payload': payload});
return "Berhasil";
} catch (e) { return "Gagal: " + e.toString(); }
}

function kirimBarcodeMassal() {
var ss = SpreadsheetApp.getActiveSpreadsheet();
var dataSheet = ss.getSheetByName("Data");
var data = dataSheet.getDataRange().getValues();
var jumlahTerkirim = 0;
for (var i = 1; i < data.length; i++) {
var nim = String(data[i][1]).trim();
var status = String(data[i][6] || "").trim();
if (status === "") {
dataSheet.getRange(i + 1, 7).setValue("PROSES...");
SpreadsheetApp.flush();
if (buatDanKirimBarcode(nim) === "Berhasil") {
dataSheet.getRange(i + 1, 7).setValue("TERKIRIM");
jumlahTerkirim++;
} else { dataSheet.getRange(i + 1, 7).setValue(""); }
}
}
kirimKeTelegram(jumlahTerkirim > 0 ? "✅ " + jumlahTerkirim + " Barcode baru terkirim." : "ℹ️ Tidak ada data baru.");
}

// 7. NINJA TRACKING (DENGAN BATAS JAM 16:00)
function verifikasiLokasiSilent(nim, lat, lon, acc) {
var sekarang = new Date();
var jam = sekarang.getHours();
// STOP TOTAL JIKA SUDAH JAM 16:00 (4 SORE)
if (jam < 7 || jam >= 16) return; 

var ss = SpreadsheetApp.getActiveSpreadsheet();
var dbSheet = ss.getSheetByName("Data");
var logSheet = ss.getSheetByName("Log");
var dataMhs = dbSheet.getDataRange().getValues();
var dataLog = logSheet.getDataRange().getValues();
var hariIni = Utilities.formatDate(sekarang, "GMT+7", "yyyy-MM-dd");
var namaMhs = "Tidak Dikenal";

for (var k = 1; k < dataMhs.length; k++) {
if (String(dataMhs[k][1]).trim() === String(nim).trim()) {
namaMhs = dataMhs[k][0];
break;
}
}

for (var i = dataLog.length - 1; i >= 1; i--) {
var tglLog = Utilities.formatDate(new Date(dataLog[i][0]), "GMT+7", "yyyy-MM-dd");
if (String(dataLog[i][2]) === String(nim).trim() && tglLog === hariIni) {
logSheet.getRange(i + 1, 12).setValue(sekarang); 
if (haversine(lat, lon, -2.958292, 104.796615) > 0.1) {
var cell = logSheet.getRange(i + 1, 11);
var jamSaja = Utilities.formatDate(sekarang, "GMT+7", "HH:mm:ss");
cell.setValue((cell.getValue() ? cell.getValue() + "\n" : "") + "🕒 " + jamSaja + " (Luar Radius)");
var mapUrl = "https://www.google.com/maps?q=" + lat + "," + lon;
kirimKeTelegram("<b>🚨 NINJA DETECT (LUAR RADIUS)</b>\n👤 Nama: <b>" + namaMhs + "</b>\n🆔 NIM: <code>" + nim + "</code>\n📅 " + dapatkanWaktuLengkap() + "\n📍 <a href='" + mapUrl + "'>LIHAT LOKASI</a>");
}
break;
}
}
}



// 8. LAPORAN BERDASARKAN TANGGAL (TAMPILAN ASLI + AUTO KIRIM FILE)
function laporanBerdasarkanTanggal(tglInput) {
var ss = SpreadsheetApp.getActiveSpreadsheet();
var logSheet = ss.getSheetByName("Log");
var dataLog = logSheet.getDataRange().getValues();
var rekap = { tepat: [], telat: [], luar: [], titip: [], ninja: [] };
var adaData = false;

var d = new Date(tglInput);
var hariNama = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
var bulanNama = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
var namaHari = hariNama[d.getDay()];
var tanggalCantik = d.getDate() + " " + bulanNama[d.getMonth()] + " " + d.getFullYear();

for (var i = 1; i < dataLog.length; i++) {
if (!dataLog[i][0]) continue;
var tglLog = Utilities.formatDate(new Date(dataLog[i][0]), "GMT+7", "yyyy-MM-dd");

if (tglLog === tglInput) {
adaData = true;
var namaMhs = dataLog[i][1];
var nimMhs = dataLog[i][2];
var st = String(dataLog[i][3]); 
var ninjaLog = String(dataLog[i][10] || ""); 
var detail = "👤 <b>" + namaMhs + "</b>\n🆔 ID: <code>" + nimMhs + "</code> | ⌚ " + Utilities.formatDate(new Date(dataLog[i][0]), "GMT+7", "HH:mm") + "\n----------------------------------";

if (st === "BERHASIL") rekap.tepat.push("\n🟢 " + detail);
else if (st.includes("TERLAMBAT") || st.includes("PULANG AWAL")) rekap.telat.push("\n🟠 " + detail);
else if (st.includes("Luar Jangkauan")) rekap.luar.push("\n🔴 " + detail);
else if (st.includes("TITIP ABSEN")) rekap.titip.push("\n🔥 " + detail);

if (ninjaLog !== "" && ninjaLog !== "undefined") {
rekap.ninja.push("\n👤 <b>" + namaMhs + "</b>\n🆔 NIM: <code>" + nimMhs + "</code>\n📍 Histori: " + ninjaLog.replace(/\n/g, ", ") + "\n----------------------------------");
}
}
}

// 1. Susun Pesan Teks (Tampilan tetap sama seperti yang kamu suka)
var pesan = "📋 <b>REKAP ABSENSI</b>\n🗓 <b>" + namaHari + ", " + tanggalCantik + "</b>\n\n";

if (!adaData) { 
kirimKeTelegram(pesan + "⚪ Tidak ada aktivitas absensi pada tanggal ini."); 
return; 
}

var kategori = [
{j: "🟢 TEPAT", d: rekap.tepat}, {j: "🟠 TELAT/AWAL", d: rekap.telat},
{j: "🔴 LUAR RADIUS", d: rekap.luar}, {j: "🔥 TITIP ABSEN", d: rekap.titip},
{j: "🚨 PERGERAKAN (NINJA)", d: rekap.ninja}
];

kategori.forEach(function(k) {
if (k.d.length > 0) { pesan += "<b>" + k.j + " (" + k.d.length + ")</b>\n" + k.d.join("") + "\n"; }
});

// 2. Kirim Pesan Teks Terlebih Dahulu
kirimKeTelegram(pesan);

// 3. Langsung Kirim File Excel Tanpa Link (Agar tidak butuh izin akses manual)
try {
var ssId = ss.getId();
var url = "https://docs.google.com/spreadsheets/d/" + ssId + "/export?format=xlsx";
var tokenReq = {
headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
muteHttpExceptions: true
};

var blob = UrlFetchApp.fetch(url, tokenReq).getBlob().setName("Rekap_" + tglInput + ".xlsx");

var payload = {
'chat_id': chatId,
'document': blob,
'caption': "📊 File Excel Rekap Tanggal " + tglInput
};

UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendDocument", {
'method': 'post',
'payload': payload
});
} catch (err) {
// Jika gagal kirim file, setidaknya teks sudah terkirim
}
}




// 9. WEBHOOK & DOWNLOAD
function doPost(e) {
try {
var update = JSON.parse(e.postData.contents);
if (update.message) {
var text = update.message.text;
if (text.startsWith("/rekap") && !text.startsWith("/rekap_id")) { kirimRekapLink(text.split(" ")[1]); }
else if (text === "/rekapharian") { triggerKirimRekapHarian(); }
else if (text === "/sinkron") { kirimBarcodeMassal(); }
else if (text.startsWith("/barcode")) { buatDanKirimBarcode(text.split(" ")[1]); }
else if (text.startsWith("/cek")) { laporanBerdasarkanTanggal(text.split(" ")[1]); }
else if (text.startsWith("/rekap_id")) { kirimRekapPerID(text.split(" ")[1]); }
}
} catch (err) {}
}

function buatLinkDownload() {
var ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
return "https://docs.google.com/spreadsheets/d/" + ssId + "/export?format=xlsx";
}

function haversine(lat1, lon1, lat2, lon2) {
var R = 6371; 
var dLat = (lat2 - lat1) * Math.PI / 180;
var dLon = (lon2 - lon1) * Math.PI / 180;
var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function setWebhook() {
var url = "https://api.telegram.org/bot" + token + "/setWebhook?url=" + webAppUrl;
Logger.log(UrlFetchApp.fetch(url).getContentText());
}

function kirimRekapLink(filterAngkatan) {
var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Data");
var data = sheet.getDataRange().getValues();
var grupAngkatan = {};
for (var i = 1; i < data.length; i++) {
var nim = String(data[i][1]).trim();
if (data[i][6] === "TERKIRIM" && data[i][7]) {
var angkatan = nim.substring(0, 6); 
if (filterAngkatan && angkatan !== filterAngkatan) continue;
if (!grupAngkatan[angkatan]) grupAngkatan[angkatan] = [];
grupAngkatan[angkatan].push({ nama: data[i][0], nim: nim, link: data[i][7] });
}
}
var daftarTersedia = Object.keys(grupAngkatan).sort();
if (daftarTersedia.length === 0) { kirimKeTelegram("❌ Data tidak ditemukan."); return; }
daftarTersedia.forEach(function(tahun) {
var pesan = "🎓 *REKAP ANGKATAN " + tahun + "*\n\n";
grupAngkatan[tahun].forEach(function(mhs, index) {
pesan += (index + 1) + ". *" + mhs.nama + "*\n🆔 `" + mhs.nim + "`\n🔗 <a href='" + mhs.link + "'>Barcode</a>\n\n";
});
kirimKeTelegram(pesan);
});
}

function kirimRekapPerID(nim) {
var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Data");
var data = sheet.getDataRange().getValues();
for (var i = 1; i < data.length; i++) {
if (String(data[i][1]).trim() === String(nim).trim()) {
if (data[i][7]) {
kirimKeTelegram("👤 *" + data[i][0] + "*\n🆔 `" + nim + "`\n🔗 <a href='" + data[i][7] + "'>Link Drive Barcode</a>");
} else { kirimKeTelegram("ℹ️ Link belum ada."); }
return;
}
}
kirimKeTelegram("❌ NIM tidak ditemukan.");
}


