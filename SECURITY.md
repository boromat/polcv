# Security policy

PolCV keeps a person's profile, CVs and API keys on their own computer and sends only what a CV
needs to the model they pick. If you find a way for another website or another machine to read the
profile, spend the OpenRouter credit or make the server run a command, for a key to leave
`data/settings.json` in clear text, or for personal data to reach the model while masking is on,
please report it privately from the repository's **Security** tab (*Report a vulnerability*), or
write to kontaktboromat@gmail.com, instead of opening a public issue. A public issue would publish
the way in before there is a fix. You will get an acknowledgement within 7 days. Fixes are
released as a new version and noted in [CHANGELOG.md](CHANGELOG.md); only the latest release is
supported.

## What the app assumes

- The server listens on `127.0.0.1` and has no login. The API answers only requests sent to
  `localhost`, `127.0.0.1` or `[::1]`, and refuses a request that changes data from another
  origin (`server/security.ts`), so a page open in the same browser cannot read the profile or
  run anything, also after DNS rebinding.
- `CV_HOST=0.0.0.0` opens the app to the local network on purpose, and the app has no login:
  everyone on that network can then use all of it as the user does, read and change the data,
  spend the OpenRouter credit and run the update and install commands. That is a documented
  choice, not a vulnerability; a request answered under a name that is neither local, nor this
  computer's, nor in `CV_ALLOWED_HOSTS` is one.
- The OpenRouter key sits in plain text in `data/settings.json`, which only the user's account
  should be able to read; `OPENROUTER_API_KEY` takes precedence and is never written to disk. The
  browser only ever gets keys masked.
- The server runs a program (`git pull --ff-only`, `npm install`, `npm run build`, `pip install`)
  only when the request carries exactly the commands the user was shown and confirmed.
- A posting link is fetched as `PolCV/<version>`, and the app does not try to get past a site that
  blocks automated requests. A link, or a redirect from it, to this computer or the local network
  (127.0.0.0/8, 10/8, 172.16/12, 192.168/16, link-local addresses such as 169.254.169.254, and
  their IPv6 counterparts) is not fetched.

## Masking (polanon)

Masking is pseudonymisation, not anonymisation. With it switched on, what
[polanon](https://github.com/boromat/polanon) detects (name, e-mail, phone, address, company
names, profile links) is replaced with tokens before any text reaches the model, and when masking
is on but polanon is not working, nothing is sent at all. A value polanon does not recognise is a
detection gap rather than a bypass: report it in the polanon repository, with invented text of
the same shape. A way past the masking that does not depend on PolCV goes privately to polanon, as
its [security policy](https://github.com/boromat/polanon/blob/main/SECURITY.md) describes.
