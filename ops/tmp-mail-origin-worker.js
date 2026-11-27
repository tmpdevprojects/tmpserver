const UPSTREAM = "https://tmpserver.com";
const FORWARDED_HEADERS = ["accept", "accept-language", "content-type", "if-none-match", "if-modified-since", "range", "user-agent"];

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const upstream = new URL(`${incoming.pathname}${incoming.search}`, UPSTREAM);
    const isHtmlRequest = ["GET", "HEAD"].includes(request.method) && (request.headers.get("accept") || "").toLowerCase().includes("text/html");
    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      if (isHtmlRequest && (name === "if-none-match" || name === "if-modified-since")) continue;
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    const response = await fetch(new Request(upstream, init));
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("X-Robots-Tag", "noindex, nofollow");
    responseHeaders.set("Referrer-Policy", "same-origin");
    if (isHtmlRequest && (responseHeaders.get("content-type") || "").toLowerCase().includes("text/html")) {
      responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      responseHeaders.delete("Expires");
    }

    const location = responseHeaders.get("Location");
    if (location) {
      try {
        const redirect = new URL(location, UPSTREAM);
        if (redirect.hostname === "tmpserver.com") {
          responseHeaders.set("Location", `${incoming.origin}${redirect.pathname}${redirect.search}${redirect.hash}`);
        }
      } catch {
        // Leave non-URL Location values unchanged.
      }
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  },
};
