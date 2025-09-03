// Minimal GitHub OAuth proxy for Decap/Netlify CMS on Netlify Functions
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GIT_HOSTNAME = process.env.GIT_HOSTNAME || "github.com";

exports.handler = async (event) => {
  const url = new URL(event.rawUrl);
  const path = url.pathname;

  // Helper to return HTML that posts a message back to the CMS window
  const postBack = (msg) => ({
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: `
<!doctype html><html><body>
<script>
  (function() {
    function send(){ window.opener && window.opener.postMessage(${JSON.stringify(msg)}, "*"); window.close(); }
    send();
  })();
</script>
</body></html>`
  });

  if (path.endsWith("/oauth/authorize")) {
    // CMS will include ?provider=github&site_id=<yoursite>
    const state = url.searchParams.get("site_id") || "";
    const redirectUri = `${url.origin}/callback`;
    const authorize = `https://${GIT_HOSTNAME}/login/oauth/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,user&state=${encodeURIComponent(state)}`;
    return { statusCode: 302, headers: { Location: authorize } };
  }

  if (path.endsWith("/callback")) {
    const code = url.searchParams.get("code");
    if (!code) return postBack("authorization:github:error:missing_code");

    // Exchange code for token
    const tokenRes = await fetch(`https://${GIT_HOSTNAME}/login/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/callback`
      })
    });
    const data = await tokenRes.json();

    if (data.error || !data.access_token) {
      const reason = data.error_description || data.error || "unknown_error";
      return postBack(`authorization:github:error:${reason}`);
    }

    // What the CMS expects:
    return postBack(`authorization:github:success:${data.access_token}`);
  }

  return { statusCode: 404, body: "Not found" };
};
