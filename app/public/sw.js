/* Service worker for Web Push – handle push and notification click */
self.addEventListener("push", function (event) {
  console.log("[SW] Push event received");
  let payload = { title: "Memories", body: "", url: "/" };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
      console.log("[SW] Push payload:", JSON.stringify(payload));
    } catch (_) {
      payload.body = event.data.text();
      console.log("[SW] Push payload (text):", payload.body);
    }
  } else {
    console.log("[SW] Push event has no data");
  }
  const options = {
    body: payload.body || payload.title,
    icon: "/logo.svg",
    badge: "/logo.svg",
    data: { url: payload.url || "/" },
    tag: payload.tag || "memories-" + Date.now(),
    renotify: true,
  };
  event.waitUntil(
    self.registration.showNotification(payload.title, options).then(function () {
      console.log("[SW] Notification shown successfully");
    }).catch(function (err) {
      console.error("[SW] Failed to show notification:", err);
    })
  );
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
