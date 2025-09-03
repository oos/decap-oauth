// Minimal GitHub OAuth proxy for Decap/Netlify CMS on Netlify Functions
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GIT_HOSTNAME = process.env.GIT_HOSTNAME || "github.com";

exports.handler = async (event) => {
  const url = new URL(event.rawUrl);
  const path = url.pathname;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return { statusCode: 500, body: "Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET." };
  }

  // HTML responder: blast BOTH formats every 300ms for ~8s, then close.
  const respond = (type, payload) => {
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
  var msgStr = ${JSON.stringify(strMsg)};
  var msgObj = ${JSON.stringify(objMsg)};

  function sendOnce() {
    try {
      if (window.opener && typeof window.opener.postMessage === "function") {
        // IMPORTANT: send to '*' to avoid origin mismatches
        window.opener.postMessage(msgStr, '*');
        window.opener.postMessage(msgObj, '*');
      }
    } catch (e) {}
  }

  var start = Date.now();
  var maxMs = 8000;        // ~8 seconds
  var intervalMs = 300;    // send every 300ms

  // initial send
  sendOnce();

  // burst send
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

  // Step 1: redirect to GitHub
  if (path.endsWith("/oauth/authorize")) {
    // Decap passes ?site_id=...; we don’t need it here now
    const redirectUri = `${url.origin}/callback`;
    const authorize = `https://${GIT_HOSTNAME}/login/oauth/authorize?client_id=${encodeURIComponent(
      CLIENT_ID
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent("repo,user")}&state=${encodeURIComponent(
      url.searchParams.get("site_id") || ""
    )}`;
    return { statusCode: 302, headers: { Location: authorize } };
  }

  // Step 2: callback – exchange code for token and blast it back
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
      return respond(
        "error",
        (data && (data.error_description || data.error)) || "unknown_error"
      );
    }

    return respond("success", data.access_token);
  }

  return { statusCode: 404, body: "Not found" };
};
