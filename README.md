# Tarmoq darslari

Kompyuter tarmoqlari bo'yicha 11 ta video darslik sayti. React + TypeScript + Vite.
Kirish majburiy: username + parol (ro'yxatdan o'tish), sessiya tokeni cookie'da; progress va test natijalari PostgreSQL'da saqlanadi.

## Tuzilma

- **Frontend** (`src/`): React + TypeScript + Vite. `npm run build` → `dist/`.
- **Backend** (`backend/`): Go. Saytni (`dist/`), videolarni (`media/<id>.<til>.dat`) va API'ni bitta portda beradi: **http://192.168.168.12**.
- **Baza:** PostgreSQL, `network_tutorial` (jadvallar backend ishga tushganda o'zi yaratiladi).

## Ishga tushirish

Sayt **faqat serverda** ishlaydi va **faqat domen orqali** ochiladi: **https://network.asadbekr.uz**. Lokal kompyuterda sayt ishga tushirilmaydi.

Lokal ishlab chiqish (faqat shu kompyuterning o'zida, tarmoqqa ochiq emas): backend `127.0.0.1:8080` (`backend/.env`), `npm run dev` → `http://127.0.0.1:5173`.
O'zgarishlarni serverga chiqarish: `bash scripts/deploy.sh`.

## Server (production)

Sayt **https://network.asadbekr.uz** (server **185.191.141.166**) da ishlaydi (Ubuntu 22.04, 2 GB RAM, disk 79 GB).

- `/opt/networktutorial/backend` — Go dasturi, `.env` (baza paroli shu yerda), `content/`
- `/opt/networktutorial/dist` — frontend, `/opt/networktutorial/media` — shifrlangan videolar
- systemd xizmati `networktutorial` (127.0.0.1:8080, `TRUST_PROXY=true`), nginx `:80` → backend
- Baza: PostgreSQL 14, `network_tutorial` (egasi `networktutorial`)
- Serverdagi videolar siqilgan (CRF 28, ~2.5x kichik): `media-web/` → `media-server/`

Yangilash: `bash scripts/deploy.sh` (videolar bilan: `bash scripts/deploy.sh --media`).
- Domen: `network.asadbekr.uz` (ahost DNS'ida A yozuv → 185.191.141.166). `http://` (domen yoki IP) → `https://network.asadbekr.uz` ga yo'naltiriladi; `https://<IP>` yoki boshqa nom bilan kelgan so'rov yopiladi (nginx `return 444`).
- `asadbekr.uz` va `www.asadbekr.uz` ham shu serverga qaraydi (A `@` → 185.191.141.166, `www` CNAME, `*` yozuvi o'chirilgan) va `https://network.asadbekr.uz` ga yo'naltiriladi (sertifikat `/etc/nginx/ssl/main.{crt,key}`).
- SSL: Let's Encrypt, `acme.sh` (`/root/.acme.sh`), sertifikat `/etc/nginx/ssl/network.{crt,key}`; har kuni `acme-renew.timer` tekshiradi va muddatidan oldin yangilaydi (nginx o'zi qayta yuklanadi).
- HTTPS'da foydalanuvchi cookie'si `Secure`.

## Foydalanuvchilar

- Token bo'lmasa sayt faqat kirish/ro'yxatdan o'tish oynasini ko'rsatadi. Ro'yxatdan o'tishda **username'ni sayt o'zi beradi** (`Admin` + `users.id`: Admin16, Admin17…, maydon o'chirilgan), odam faqat parol qo'yadi (6–72 belgi, PBKDF2-SHA256). Keyin beriladigan nom `GET /api/auth/next` da ko'rinadi; ro'yxatdan so'ng nom katta qilib ko'rsatiladi.
- Kirgandan so'ng tasodifiy token beriladi: brauzerda httpOnly + Secure cookie `nt_session`, bazada faqat uning SHA-256 xeshi (`sessions`), 30 kun, foydalanilsa uzayadi. Chiqish faqat shu sessiyani o'chiradi.
- Noto'g'ri parol: bitta IP'dan 15 daqiqada 10 ta xatodan keyin 429.
- API: `POST /api/auth/register` (faqat parol) `|login|logout`, `GET /api/auth/next`, `GET /api/history` (test tarixi). Token yo'q bo'lsa barcha API va videolar 401.
- Eski avtomatik AdminNN yozuvlari bazada qoladi (paroli yo'q, kira olmaydi, nomlari band).

## Darslar, qulf va testlar

- Darslar ro'yxati: `backend/content/lessons.json`; testlar: `backend/content/tests/<dars-id>.json` (har birida 10 ta savol, `answer` — to'g'ri variant indeksi, brauzerga yuborilmaydi).
- N-dars faqat (N-1)-darsning videosi oxirigacha ko'rilib, testidan **kamida 7/10** olingandan keyin ochiladi. Qoidani server tekshiradi: qulflangan dars videosi va testi berilmaydi.
- "Video ko'rildi" faqat haqiqiy ko'rish vaqti (har 5 soniyalik signal) videoning 85% iga yetsa qabul qilinadi.
- **Reyting** (AdminNN tugmasi → profil): ball = dars testlaridagi eng yaxshi natijalar yig'indisi (max 110). Teng bo'lsa ko'proq tugatilgan dars, keyin natijaga birinchi erishgan oldinda. Top-10 + o'z o'rni (`GET /api/rating`).
- Jadvallar: `users`, `progress` (pozitsiya, ko'rilgan vaqt, video/test holati, eng yaxshi ball), `test_attempts` (dars testi urinishlari). (`quiz_attempts` — olib tashlangan aralash testdan qolgan eski jadval, ishlatilmaydi.)

## Umumiy test

Header'dagi "Umumiy test" tugmasi (`src/components/Exam.tsx`, server: `backend/exam.go`, `backend/exam_gen.go`). Hamma kirgan foydalanuvchiga ochiq, qayta topshirsa bo'ladi.
- Har bir urinishda **20 ta yangi tasodifiy savol**: har darsdan 1–2 tadan. Savollar ikki manbadan olinadi:
  - nazariy savollar bazasi: `backend/content/exam.json`, 74 ta, `lesson` — dars raqami;
  - hisoblash savollari: har safar yangi sonlar bilan yasaladi (ikkilik ↔ o'nlik, ikkilik IP, keyingi manzil, mask ↔ prefiks, network/broadcast, hostlar soni, subnet, IP turi, private IP).
- Javob variantlari ham aralashtiriladi. Dars testlaridagi savollar bu yerda ishlatilmaydi, chunki umumiy test oxirida to'g'ri javoblar ko'rsatiladi.
- Savollar (javobi bilan) urinish boshlanganda serverda saqlanadi. Natija bir marta qabul qilinadi, so'ng ball, foiz, eng yaxshi natija va har savol bo'yicha to'g'ri javob ko'rsatiladi.
- **Reytingga ta'sir qilmaydi:** urinishlar alohida `exam_attempts` jadvalida turadi, `progress` va `test_attempts` ga tegmaydi.
- API: `GET /api/exam` (statistika), `POST /api/exam/new` (yangi urinish), `POST /api/exam/{id}` (`{answers}`).
- Test: `cd backend && go test ./...` (3000 ta tasodifiy testda takror savol/variant yo'qligi, har darsdan 1–2 ta savol).

## Interfeys tillari

Header'da **UZ | RU | EN** tanlovi bor (tanlov brauzerda eslab qolinadi; birinchi kirishda brauzer tiliga qarab tanlanadi).
- Barcha interfeys yozuvlari: `src/i18n/strings.ts` (uz, ru, en). Yangi yozuv qo'shilsa uchala tilga ham yoziladi.
- Dars nomlari: `backend/content/lessons.json` — `title` (o'zbekcha) va `titles.ru`, `titles.en`.
- Dars testlari hozircha faqat o'zbekcha.
- Video tili alohida tanlanadi (video oynasida); interfeys inglizcha bo'lsa va video tili hali tanlanmagan bo'lsa, inglizcha video ochiladi.

## Tarmoq laboratoriyasi

Headerdagi "Laboratoriya" tugmasi; bosilganda to'liq ekranli tarmoq simulyatori ochiladi (kodi `src/lab/`, alohida yuklanadi).

- Qurilmalar: kompyuter, noutbuk, server, switch (12 port), router (3 port, boshida o'chiq — `no shutdown` kerak). Surish, kabel bilan ulash (port tanlanadi), o'chirish.
- Mexanizm (`engine.ts`): ARP, switch MAC o'rganishi va flood, STP (halqada ortiqcha port bloklanadi), router: connected + statik marshrut (longest prefix), TTL, ICMP Echo/Unreachable/Time Exceeded, DHCP (DORA, APIPA), DNS.
- Kompyuter buyruqlari (`hostCli.ts`, Windows uslubida): `ipconfig [/all|/renew|/release]`, `ping [-n N|-t]`, `tracert`, `arp -a|-d`, `nslookup`, `hostname`, `cls`, `help`.
- Router/switch CLI (`iosCli.ts`): `enable`, `configure terminal`, `interface`, `ip address`, `[no] shutdown`, `[no] ip route`, `hostname`, `show ip interface brief|ip route|running-config|arp|mac address-table`, `ping`, `traceroute`, `do`.
- Rejimlar: real vaqt; simulyatsiya (qadamma-qadam, tezlik, hodisalar ro'yxati, paket tarkibi qatlamlar bo'yicha).
- Asboblar: tanlash, kabel, **Ping (PDU)** — sichqoncha bilan yuboruvchi va qabul qiluvchini bosish (ICMP echo; router uchun yuboruvchi tarmog'idagi port IP'si), **Ko'rish** — qurilma jadvallari (ipconfig/arp yoki show ip route/arp/mac address-table), o'chirish.
- Pastki panel: real vaqtda protokollar statistikasi (ARP/ICMP/DHCP/DNS, yo'ldagi va tashlangan paketlar), simulyatsiyada hodisalar + protokol filtri; o'ngda PDU ro'yxati (holat, qayta yuborish, o'chirish).
- Tarix: qurilma qo'shish/o'chirish, kabel, sozlama, terminal buyruqlari, ping natijalari, misol yuklash (oxirgi 500 ta).
- Tayyor misollar, brauzerda avtomatik saqlash (har bir foydalanuvchi uchun alohida: `network-lab-v1:<username>`, `network-lab-history:<username>`), JSON faylga eksport/import.
- Testlar: `node tests/lab.test.ts` (41 ta ssenariy).
- Hozircha yo'q: VLAN, dinamik marshrutlash (RIP/OSPF), NAT, Wi-Fi, kabel turlari (avto).

## Videolar va tillar

Har bir dars uch tilgacha: o'zbekcha (`uz`), inglizcha (`en`), ruscha (`ru`). Video oynasining tepasida shu darsda mavjud tillar (**O'zbekcha | English | Русский**) chiqadi; tanlangan til eslab qolinadi, birinchi marta interfeys tili tanlanadi.
Til almashtirilganda video **o'sha gapdan** davom etadi: `backend/content/timelines/<id>.json` da ikkala tildagi har bir diktor gapining boshlanish/tugash vaqtlari bor, pozitsiya shular orqali moslanadi. Progress har doim o'zbekcha video vaqtida saqlanadi.

Kurs papkasidan videolarni olib kelish (faqat tayyorlari; qayta ishga tushirsa bo'ladi):

    bash scripts/import-videos.sh          # media-src/, muqovalar, vaqt xaritalari
    bash scripts/deploy.sh --media         # siqish, shifrlash, serverga yuklash

Qo'lda qo'shish:

1. Videolarni `media-src/<id>.uz.mp4` va `media-src/<id>.en.mp4` qilib qo'ying (`<id>` — `backend/content/lessons.json` dagi id).
2. `npm run media` — shifrlangan `media/<id>.<til>.dat` (faqat yangi/o'zgargan fayllar).
3. `node scripts/build-timelines.mjs` — kurs papkasidagi `lessonNN/timing.json` va `timing_en.json` dan vaqt moslamalari.
4. Muqovalar: `public/posters/<id>.uz.jpg` va `<id>.en.jpg` (masalan `ffmpeg -ss 200 -i media-src/<id>.en.mp4 -frames:v 1 -vf scale=1280:-2 public/posters/<id>.en.jpg`).
5. Yangi dars bo'lsa: `lessons.json` ga qo'shing va `backend/content/tests/<id>.json` ga 10 ta savol yozing.
6. `npm run build`, keyin backend'ni qayta ishga tushiring.

## Himoya (nima qiladi va nimani qila olmaydi)

- **Yuklab olish:** serverda video `.dat` ko'rinishida shifrlangan turadi. U faqat sayt ichida ochiladi, to'g'ridan-to'g'ri yuklab olingan fayl pleyerda ishlamaydi. Yuklash tugmasi, PiP va o'ng tugma menyusi o'chirilgan.
- **F12 / kodni ko'rish:** F12, Ctrl+Shift+I/J/C/K, Ctrl+U, Ctrl+S, Ctrl+P va o'ng tugma bloklangan. DevTools ochilsa, sahifa yopilib "Sahifa himoyalangan" yozuvi chiqadi. Build versiyada manba kod siqilgan holda turadi.
- **Ekran yozish:** sahifadan chiqilganda (boshqa oynaga o'tilganda) video to'xtaydi, PrintScreen bosilganda ekran yashirinadi, videoda harakatlanuvchi "Tarmoq darslari" belgisi bor.

Cheklovlar: bular oddiy foydalanuvchini to'xtatadi, tajribali dasturchini emas. Shifrlash kaliti sayt kodining ichida turadi. OBS kabi dasturlar bilan ekran yozishni brauzer umuman to'xtata olmaydi. To'liq himoya faqat DRM orqali bo'ladi (Widevine/PlayReady): bunda yozib olingan videoda qora ekran chiqadi. Buning uchun VdoCipher, Bunny Stream yoki Mux kabi pullik xizmat kerak.

## Tuzilishi

- `backend/` — Go server: `handlers.go` (API, video, statik fayllar), `course.go` (qulf, progress), `rating.go` (reyting), `users.go` (ro'yxat, login, sessiya tokenlari), `db.go` (jadvallar)
- `src/lib/api.ts` — backend bilan aloqa
- `src/i18n/` — interfeys tillari (`strings.ts`, `context.ts`, `I18nProvider.tsx`)
- `src/components/TestView.tsx` — test oynasi
- `src/components/ProfileModal.tsx` — profil va reyting
- `src/components/QuestionSteps.tsx` — savol-javob oynasi
- `src/pages/Dashboard.tsx` — bosh sahifa: xarita, "Boshlash" tugmasi, darslar
- `src/components/VideoModal.tsx` — video oynasi, katta ekran, suv belgisi
- `src/components/ProtectedVideo.tsx` + `src/lib/media.ts` — shifrlangan videoni yuklash va ochish
- `src/security/guard.ts` — F12, PrintScreen, DevTools himoyasi (faqat build versiyada)
- `scripts/encode-media.mjs` — `npm run media`
- `scripts/build-timelines.mjs` — tillar orasidagi vaqt moslamalari; `src/lib/timeline.ts` — pozitsiyani tilga o'tkazish

## Amaliy mashqlar

Header'dagi "Mashqlar" tugmasi (`src/components/Practice.tsx`, server: `backend/practice.go`). Har bir tur uchun **250 tadan raqamlangan, bir-biriga o'xshamaydigan** mashq bazasi server ishga tushganda qat'iy seed'lardan quriladi (№N doim bir xil). Oyna ochilganda tugallanmagan mashq qaytadi; yangi tasodifiy mashq faqat "Keyingi mashq" bosilganda beriladi (avval ko'rilmaganlaridan). To'g'ri javob faqat bazada (`practice_tasks`, `num` ustuni), bir marta tekshiriladi.

- **Switch va MAC jadvali** — 12 portli switch, 3–8 kompyuter, 70% hollarda hub (2–3 kompyuter), tasodifiy MAC nomlari, MAC jadvali va freym (manba/qabul qiluvchi). 1-savol: freym qaysi portlarga chiqadi; 2-savol: qaysi fikrlar to'g'ri (MAC o'rganish, broadcast, unicast bitta port / flood / tashlash).
- **Subnet jadvali** — IP/25…/30: tarmoq, broadcast, birinchi va oxirgi manzil (oxirgi oktet ikkilik va o'nlik, to'liq manzil) — 12 katak.
- **IP va maska** — IP va maska (o'nlik + ikkilik), /9…/30: birinchi va oxirgi yaroqli, broadcast, keyingi tarmoq — 16 katak.
- API: `GET /api/practice/current/{kind}`, `POST /api/practice/new/{switch|subnet|range}`, `POST /api/practice/check/{id}`, `GET /api/practice` (statistika). Reytingga qo'shilmaydi.
- Generatorlar testi: `cd backend && go test ./...`

## Atamalar

Header'dagi "Atamalar" tugmasi — bitta sahifa (`src/components/Glossary.tsx`, alohida yuklanadi): 157 ta tarmoq atamasi (`src/data/glossary.json`, o'z matnimiz), har biri uz/ru/en nomi va ma'nosi, qisqartmaning to'liq shakli, bo'lim va bog'liq atamalar (bosilsa o'sha atamaga o'tadi). Qidiruv nom, qisqartma va ma'no bo'yicha ishlaydi (apostrof turlari farq qilmaydi), bo'limlar bo'yicha filtr bor.

## Moslashuvchan dizayn

Sayt 390 px telefondan 1920 px ekrangacha tekshirilgan: header tor ekranda ikonkalarga o'tadi va telefonda 2 qatorga bo'linadi; mashqlar jadvali telefonda 3/6 ustunli to'rga o'tadi; video oynasi tugmalari bir qatorda. Laboratoriya: zoom (g'ildirak, +/−, 100%, "hammasini ko'rsatish", klaviatura + − 0, telefonda ikki barmoq), bo'sh joyni sudrab siljitish, tor ekranda tugmalar ikonkaga o'tadi, pastki panelni yig'ish mumkin (telefonda yig'ilgan holda ochiladi).
