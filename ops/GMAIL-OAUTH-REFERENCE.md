# Gmail OAuth reference for TMP Server

The implementation uses Google's popup authorization-code model. Google documents the popup callback, `ux_mode`, `client_id`, and `scope` fields; in popup mode `redirect_uri` is ignored and defaults to the origin of the page that called `initCodeClient`. The authorization-code callback must send `X-Requested-With: XmlHttpRequest`, and the backend validates that header and the request origin before exchanging the code. Google documents `error_callback` for popup errors and `requestCode()` as the user-initiated flow starter. The documented CodeClientConfig does not include `access_type` or `prompt`; do not add undocumented token-flow parameters.

The backend code exchange uses the popup caller's origin as `redirect_uri`, verifies Gmail profile email against the Supabase owner, securely stores only the refresh token and account metadata, and returns short-lived access tokens only to the authenticated owner. The browser fetches Gmail data directly and does not persist tokens or message content.

References:

- [Google Identity Services authorization code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model)
- [Google Identity Services JavaScript API reference](https://developers.google.com/identity/oauth2/web/reference/js-reference)
- [Gmail OAuth scope classification](https://developers.google.com/gmail/api/auth/scopes)
