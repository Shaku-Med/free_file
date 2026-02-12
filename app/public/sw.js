/* Service worker for Web Push – handle push and notification click */
self.addEventListener("push", function (event) {
  let payload = { title: "Memories", body: "", url: "/" };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch (_) {
      payload.body = event.data.text();
    }
  }
  const options = {
    body: payload.body || payload.title,
    icon: "/icons/web/icon-192.png",
    badge: "/icons/web/icon-192.png",
    data: { url: payload.url || "/" },
    tag: payload.tag || "memories-notification",
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(self.location.origin + (url.startsWith("/") ? url : "/" + url));
    })
  );
});
