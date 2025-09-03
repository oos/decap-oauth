// Minimal GitHub OAuth proxy for Netlify/Decap CMS on Netlify Functions
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GIT_HOSTNAME = process.env.GIT_HOSTNAME || "github.com";

exports.handler = async (event) => {
  const url = new URL(event.rawUrl);
  const path = url.pathname;

  // Utility: HTML that posts a message AND has a redirect fallback
  const respond = (type, payload, state) => {
    const strMsg = `authorization:github:${type}:${payload}`;
    const objMsg = { provider: "github", type, token: payload };
    const safe = String(strMsg).replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // If we can’t reach opener, we’ll bounce back to the admin page with the token
    // We passed `site_id` as the domain (e.g. omarosullivan.netlify.app).
    const fallbackHref =
      state
        ? `https://${state}/admin/#/oauth?token=${encodeURIComponent(payload)}`
        : `/`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: `<!doctype html><meta charset="utf-8">
<style>body{font-family:system-ui;padding:24px;max-width:720px;margin:auto}</style>
<h2>OAuth result</h2>
<p><code id="m">${safe}</code></p>
<p>This window will close shortly. If it doesn't, <a id="fb" href="${fallbackHref}">click here</a>.</p>
<script>
(function () {
  var sent = false;
  try {
    if (window.opener && typeof window.opener.postMessage === "function") {
      window.opener.postMessage(${JSON.stringify(strMsg)}, "*");
      window.opener.postMessage(${JSON.stringify(objMsg)}, "*");
      sent = true;
    }
  } catch (e) {}

  // If no opener, or message failed, redirect back with token in URL.
  if (!sent) {
    location.replace(document.getElementById('fb').href);
    return;
  }

  // Otherwise close after a short delay.
  setTimeout(function(){ window.close(); }, 1200);
})();
</script>`
    };
  };

  if (path.endsWith("/oauth/authorize")) {
    const state = url.searchParams.get("site_id") || "";
    const redirectUri = `${url.origin}/callback`;
    const authorize =
      `https://${GIT_HOSTNAME}/login/oauth/authorize` +
      `?client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=repo,user` +
      `&state=${encodeURIComponent(state)}`;
    return { statusCode: 302, headers: { Location: authorize } };
  }

  if (path.endsWith("/callback")) {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || "";
    if (!code) return respond("error", "missing_code", state);

    // Exchange code -> token
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
    try { data = await tokenRes.json(); }
    catch { return respond("error", "bad_token_response", state); }

    if (!tokenRes.ok || data.error || !data.access_token) {
      return respond("error", (data && (data.error_description || data.error)) || "unknown_error", state);
    }

    // Success
    return respond("success", data.access_token, state);
  }

  return { statusCode: 404, body: "Not found" };
};
