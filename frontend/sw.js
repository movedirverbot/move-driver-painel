self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data.json(); } catch {}

  const title = data.title || "Move Driver";
  const body = data.body || "Atualização de corrida";
  const url = data.url || "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url, raw: data },
      requireInteraction: true
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(self.location.origin)) {
          w.focus();
          w.postMessage({ type: "OPEN_FROM_PUSH", url });
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
