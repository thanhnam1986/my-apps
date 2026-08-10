// ============================================
// SERVICE WORKER - My Apps (Thành Nam)
// ============================================
// MỖI LẦN ANH SỬA CODE (index.html, css, app con...) 
// PHẢI ĐỔI SỐ VERSION DƯỚI ĐÂY (vd: v1 -> v2)
// Nếu không đổi, điện thoại sẽ tiếp tục dùng bản cache cũ.
const CACHE_VERSION = 'v1';
const CACHE_NAME = `myapps-cache-${CACHE_VERSION}`;

// Các file "khung" cần cache ngay khi cài đặt
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// --- CÀI ĐẶT: cache trước các file khung ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting(); // kích hoạt bản mới ngay, không cần đóng hết tab cũ
});

// --- KÍCH HOẠT: xóa cache phiên bản cũ ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// --- FETCH: ưu tiên lấy mạng mới nhất, nếu mất mạng thì dùng cache ---
// Chiến lược "Network First" - phù hợp vì anh hay sửa code,
// luôn muốn thấy bản mới nhất khi có mạng, chỉ dùng cache khi mất mạng.
self.addEventListener('fetch', (event) => {
  // Chỉ xử lý GET, bỏ qua request khác domain (vd gọi API ngoài)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Lấy được mạng -> lưu lại bản mới vào cache để lần sau offline vẫn dùng được
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        // Mất mạng -> lấy từ cache
        return caches.match(event.request);
      })
  );
});
