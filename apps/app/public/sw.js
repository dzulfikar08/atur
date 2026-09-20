// One-time healing stub. The PWA service worker was removed from the build;
// this file replaces the old precaching SW at the same path so clients still
// controlled by it install this script on their next update check, unregister,
// and reload — landing on network-served HTML. Delete once no clients remain
// (check DevTools > Application > Service Workers on app.diatur.com).
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});
