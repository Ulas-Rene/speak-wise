# SpeakWise

Basit, tek odalı yazılı ve sesli sohbet uygulaması. React istemci, Express + Socket.IO sunucu ve WebRTC mesh ses bağlantısı kullanır.

3-5 kişilik arkadaş grubu için tasarlandı. Mesajlar bellekte tutulur, veritabanı yoktur; servis yeniden başlarsa geçmiş temizlenir.

## Yerelde Çalıştırma

**Gereksinim:** Node.js 20+

```bash
npm install
npm run dev
```

Uygulama varsayılan olarak `http://localhost:3000` adresinde açılır.

## Render Deploy

Render üzerinde yeni bir Web Service oluşturup bu repoyu bağla. Komutlar:

```bash
Build Command: npm install && npm run build
Start Command: npm start
```

Alternatif olarak repodaki `render.yaml` Blueprint olarak kullanılabilir.

Render `PORT` değerini otomatik verir; sunucu bu değeri kullanır.

## Ortam Değişkenleri

`.env.example` dosyasındaki değerleri Render Environment bölümünde tanımlayabilirsin.

- `ROOM_KEY`: Opsiyonel oda anahtarı. Set edilirse girişte parola istenir.
- `MAX_USERS`: Aynı anda odaya girebilecek kişi sayısı. Varsayılan `10`.
- `MAX_MESSAGES_HISTORY`: Bellekte tutulacak son mesaj sayısı. Varsayılan `100`.
- `MESSAGE_RATE_LIMIT_MS`: Kişi başı mesaj gönderme aralığı. Varsayılan `650`.
- `ALLOWED_ORIGINS`: Ayrı domainlerden erişim gerekiyorsa virgülle ayrılmış origin listesi.

## Önemli Notlar

WebRTC ses P2P mesh çalışır. Aynı anda az kişi için hafiftir; 3-5 kişi hedefi için uygundur.

Sadece public STUN sunucuları kullanılıyor. Bazı katı ağlarda ses bağlantısı için TURN sunucusu gerekebilir. Ücretsiz ve sorunsuz 7/24 ses için bu en büyük gerçek dünya sınırlamasıdır.

Render Free plan maliyetsizdir fakat sürekli uyanık kalma garantisi vermez. 7/24 kesintisiz çalışma gerekiyorsa paid instance veya farklı bir her zaman açık host gerekir.
