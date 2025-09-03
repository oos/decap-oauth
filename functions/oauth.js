// Minimal GitHub OAuth proxy for Decap/Netlify CMS on Netlify Functions
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GIT_HOSTNAME = process.env.GIT_HOSTNAME || "github.com";

exports.handler = async (event) => {
  const url = new URL(event.rawUrl);
  const path = url.pathname;

  // Helper to bail early if env is missing
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return {
      statusCode: 500,
      body: "Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET env vars.",
    };
  }

  /**
   * HTML responder:
   *  - Posts BOTH message formats (string + object) back to window.opener
   *  - Sends them every 300ms for ~8s (to survive timing of CMS listeners)
   *  - Uses targetOrigin (your site origin) taken from OAuth 'state'
   */
  const respond = (type, payload, targetOrigin = "*") => {
    const strMsg = `authorization:github:${type}:${payload}`;
    const objMsg = { provider: "github", type, token: payload };
    const safe = strMsg.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: `<!doctype html>
<meta charset="utf-8" />
<title>OAuth result</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;padding:24px;max-width:760px;margin:auto}</style>
<h2>OAuth result</h2>
<p><code>${safe}</code></p>
<p>This window will close automatically.</p>
<script>
(function () {
  var target = ${JSON.stringify(targetOrigin)} || "*";
  var msgStr = ${JSON.stringify(strMsg)};
  var msgObj = ${JSON.stringify(objMsg)};

  var start = Date.now();
  var maxMs = 8000;        // ~8 seconds
  var intervalMs = 300;    // send every 300ms

  function sendOnce() {
    try {
      if (window.opener && typeof window.opener.postMessage === "function") {
        window.opener.postMessage(msgStr, target);
        window.opener.postMessage(msgObj, target);
      }
    } catch (e) {}
  }

  // Initial send immediately
  sendOnce();

  // Burst for a few seconds so CMS definitely catches it
  var id = setInterval(function() {
    if (Date.now() - start > maxMs) {
      clearInterval(id);
      setTimeout(function(){ try { window.close(); } catch(e){} }, 400);
      return;
    }
    sendOnce();
  }, intervalMs);
})();
</script>`,
    };
  };

  // --- 1) Start OAuth: redirect to GitHub with state=site_origin ---

  if (path.endsWith("/oauth/authorize")) {
    // Decap/Netlify CMS calls this with ?site_id=<your_admin_site_origin>
    const siteOrigin = url.searchParams.get("site_id") || "";
    const redirectUri = `${url.origin}/callback`;

    const authorize = `https://${GIT_HOSTNAME}/login/oauth/authorize?client_id=${encodeURIComponent(
      CLIENT_ID
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(
      "repo,user"
    )}&state=${encodeURIComponent(siteOrigin)}`;

    return { statusCode: 302, headers: { Location: authorize } };
  }

  // --- 2) Callback: exchange code for access token and post it back ---

  if (path.endsWith("/callback")) {
    const code = url.searchParams.get("code");
    const targetOrigin = url.searchParams.get("state") || "*"; // your site origin from step 1

    if (!code) return respond("error", "missing_code", targetOrigin);

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
      return respond("error", "bad_token_response", targetOrigin);
    }

    if (!tokenRes.ok || data.error || !data.access_token) {
      return respond(
        "error",
        (data && (data.error_description || data.error)) || "unknown_error",
        targetOrigin
      );
    }

    // Success: burst post the token back to the admin page (at targetOrigin)
    return respond("success", data.access_token, targetOrigin);
  }

  return { statusCode: 404, body: "Not found" };
};
