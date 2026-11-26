# TMP Server Gmail mailbox setup

The dashboard mailbox uses the Google Identity Services popup authorization-code flow. It is restricted to the authenticated TMP Server owner, and the Google mailbox must match that owner's address. The dashboard requests only `gmail.readonly` and `gmail.send`. Email content is read directly by the browser from Gmail and is not stored or logged by the host agent. Short-lived access tokens stay in browser memory; the Google client secret and refresh token remain on the Linux host.

## Google Cloud setup

1. In Google Cloud Console, select or create a project and enable the Gmail API.
2. Configure the OAuth consent screen and the audience appropriate for the single owner. Add `charliehenworth92@gmail.com` as the authorized/test user if the consent-screen configuration requires it.
3. Create a **Web application** OAuth client. Add `https://tmpserver.com` under Authorized JavaScript origins. The popup code model uses the calling site's origin; it does not need a client secret in the frontend. Copy both the client ID and client secret privately.
4. Request only `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send`. Google classifies `gmail.readonly` as Restricted and `gmail.send` as Sensitive; follow the current Google verification and data-use requirements for the application's audience. See [Gmail scope classifications](https://developers.google.com/gmail/api/auth/scopes) and [Google's GIS code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model).

The dashboard build exposes only the **client ID**, which is a public OAuth identifier. In the GitHub repository settings for `tmpdevprojects/tmpserver`, open **Settings → Secrets and variables → Actions → Variables**, then add a repository variable named `VITE_GOOGLE_CLIENT_ID` with the Google client ID value. Set the host's `GMAIL_CLIENT_ID` to this exact same Web client ID; the browser obtains the authorization code for this client and the host exchanges it as that client. Do not store the client secret in this variable or in the frontend build.

## Private Linux host configuration

After the updated repository is installed on the server, create the private host-side environment file. Use `sudoedit` so the secret is not placed in a shell command or chat:

```bash
sudo install -d -o root -g root -m 0700 /etc/tmpserver
sudoedit /etc/tmpserver/gmail.env
```

Enter these three lines in the editor, replacing the placeholders locally with the values from Google Cloud Console:

```text
GMAIL_CLIENT_ID=REPLACE_WITH_GOOGLE_WEB_CLIENT_ID
GMAIL_CLIENT_SECRET=REPLACE_WITH_GOOGLE_WEB_CLIENT_SECRET
GMAIL_TOKEN_PATH=/var/lib/tmpserver-gmail/oauth.json
```

Save and close the editor, then secure the file and install the systemd drop-in:

```bash
sudo chown root:root /etc/tmpserver/gmail.env
sudo chmod 0600 /etc/tmpserver/gmail.env
sudo install -d -o root -g root -m 0755 /etc/systemd/system/tmpserver-host-agent.service.d
sudo install -m 0644 /opt/tmpserver/app/ops/tmpserver-host-agent-gmail.conf /etc/systemd/system/tmpserver-host-agent.service.d/20-gmail.conf
sudo install -d -o root -g root -m 0700 /var/lib/tmpserver-gmail
sudo systemctl daemon-reload
sudo systemctl restart tmpserver-host-agent
sudo systemctl is-active tmpserver-host-agent
```

Do not run `cat`, `env`, `systemctl show -p Environment`, or other commands that print the environment file or its values. Do not put the secret or refresh token in the repository, browser storage, email, or chat. The host agent creates the OAuth token file with mode `0600` after a successful owner authorization. The token directory must remain owned by the service user (the current host-agent setup runs as root) and mode `0700`.

## Connect and verify

After GitHub Pages has deployed a build containing the public client ID and the Linux host agent has restarted with the private settings, sign in at `https://tmpserver.com`, open **Mail**, and choose **Connect Google**. Sign in to `charliehenworth92@gmail.com` and approve the two requested scopes. The backend checks the Google account against the authenticated TMP Server owner before saving anything.

The Mail page should report **Gmail connected** only after the host status route confirms the stored account. If it reports an OAuth/API configuration error, do not paste credentials into chat. Recheck the Google API and consent-screen setup, the GitHub Actions variable, the private host file permissions, and the host-agent service status. A successful process restart alone does not verify authorization; the mailbox is not considered connected until the dashboard reports the connected owner account.
