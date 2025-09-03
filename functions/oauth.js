// Minimal GitHub OAuth proxy for Decap/Netlify CMS on Netlify Functions
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GIT_HOSTNAME = process.env.GIT_HOSTNAME || "github.com";

exports.handler = async (event) => {
  const url = new URL(event.rawUrl);
  const path = url.pathname;

  // Helper: return HTML that posts a message to the opener AND shows it on-screen for debug
  const respond = (type, payload) => {
    const msg = `authorization:github:${type}:${payload}`;
    const safe = msg.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: `<!doctype html><meta charset="utf-8">
<style>body{font-family:system-ui;padding:20px}</style>
<p><strong>OAuth result</strong>: <code id="m">${safe}</code></p>
<script>
  (function() {
    try {
      if (window.opener && typeof window.opener.postMessage === "function") {
        window.opener.postMessage(${JSON.stringify(msg)}, "*");
        // give the opener a moment to process, then close
        setTimeout(() => window.close(), 50);
      }
    } catch (e) { /* ignore */ }
  })();
</script>`,
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

    // Exchange code for token
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
      return respond("error", (data && (data.error_description || data.error)) || "unknown_error");
    }

    // Success: send to CMS
    return respond("success", data.access_token);
  }

  return { statusCode: 404, body: "Not found" };
};
