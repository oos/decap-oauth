// Minimal GitHub OAuth proxy for Netlify/Decap CMS
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GIT_HOSTNAME = process.env.GIT_HOSTNAME || "github.com";

exports.handler = async (event) => {
  const url = new URL(event.rawUrl);
  const path = url.pathname;

  const respond = (type, payload) => {
    const strMsg = `authorization:github:${type}:${payload}`;
    const safe = strMsg.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: `<!doctype html><meta charset="utf-8">
<style>body{font-family:system-ui;padding:24px;max-width:720px;margin:auto}</style>
<h2>OAuth result</h2>
<p><code>${safe}</code></p>
<p>This window will auto-close after a moment.</p>
<script>
  (function () {
    try {
      if (window.opener && typeof window.opener.postMessage === "function") {
        window.opener.postMessage(${JSON.stringify(strMsg)}, "*");
      }
    } catch (_) {}
    setTimeout(() => window.close(), 1500);
  })();
</script>`
    };
  };

  if (path.endsWith("/oauth/authorize")) {
    const state = url.searchParams.get("site_id") || "";
    const redirectUri = `${url.origin}/callback`;
    const authorize = `https://${GIT_HOSTNAME}/login/oauth/authorize?client_id=${encodeURIComponent(
      CLIENT_ID
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,user&state=${encodeURIComponent(
      state
    )}`;
    return { statusCode: 302, headers: { Location: authorize } };
  }

  if (path.endsWith("/callback")) {
    const code = url.searchParams.get("code");
    if (!code) return respond("error", "missing_code");

    const tokenRes = await fetch(`https://${GIT_HOSTNAME}/login/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/callback`,
      }),
    });

    let data;
    try {
      data = await tokenRes.json();
    } catch {
      return respond("error", "bad_token_response");
    }

    if (!tokenRes.ok || data.error || !data.access_token) {
      return respond("error", data.error_description || data.error || "unknown_error");
    }

    return respond("success", data.access_token);
  }

  return { statusCode: 404, body: "Not found" };
};
