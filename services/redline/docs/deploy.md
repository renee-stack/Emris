# Deploying Redline

Redline is one service: the API in `demo/server.ts`. It runs the agent on Claude through Google Vertex AI and serves the research tools in the same process. Emris on Vercel calls it over HTTPS with a shared key.

```
Emris on Vercel ── HTTPS, x-redline-key ──► Caddy :443 ──► API :8792 ──► Claude on Vertex AI
                                            (same VM)       research tools in-process
```

Until the hackathon, Redline used TrueForge and a separate MCP server, which made three services. Those are gone, along with their Fly.io config.

## Running now

| | |
|---|---|
| **Project** | `emris-redline` ("Emris"), on the existing billing account |
| **VM** | `redline`, e2-micro in `us-central1-a`, Debian 12, 30 GB standard disk, 2 GB swap |
| **Address** | static `136.119.7.65`, served as `https://136-119-7-65.sslip.io` until there's a real domain |
| **Identity** | service account `redline-vm@emris-redline.iam.gserviceaccount.com`, with Vertex AI User |
| **Open ports** | 80 and 443 for Caddy, and 22 for SSH. The API listens on `127.0.0.1:8792` only |
| **Code** | `/opt/redline`, settings in `/opt/redline/deploy/.env` (mode 600) |

**Cost:** the e2-micro and its 30 GB standard disk fall within Google's always-free tier in `us-central1`, as long as the billing account has no other e2-micro. The static address and model calls are billed. Check Google's pricing pages for current rates.

## Deploy on a Google Cloud VM

These are the steps that made the VM above. `G` is `gcloud`, and `P` is the project.

1. **Project and APIs:** create the project, link billing, then enable `compute.googleapis.com` and `aiplatform.googleapis.com`.
2. **Claude:** in [Model Garden](https://console.cloud.google.com/vertex-ai/model-garden), enable Claude Haiku 4.5 for the project. This means accepting Anthropic's terms, and access can take a day or two.
3. **Service account:** create `redline-vm` and grant it `roles/aiplatform.user` on the project.
4. **Address and firewall:** reserve a static address in the VM's region, and allow `tcp:80,tcp:443` to the tag `redline-web`.
5. **VM:** an e2-micro with the address, the tag, the service account and the `cloud-platform` scope. A startup script adds 2 GB of swap, so the small machine can build images, and installs Docker.
6. **Code and settings:** clone the repo to `/opt/redline`, copy `deploy/.env.example` to `deploy/.env`, and fill it in: a new `REDLINE_API_KEY` (`openssl rand -hex 32`), `REDLINE_PUBLIC_PORT=127.0.0.1:8792`, `VERTEX_PROJECT_ID`, `REDLINE_DOMAIN` and `REDLINE_GIT_SHA`.
7. **Build and start** from `/opt/redline/deploy`. The first build takes about 25 minutes on an e2-micro. Run it with `systemd-run`, so it survives the SSH session ending.

```bash
sudo systemd-run --unit redline-build --working-directory /opt/redline/deploy bash -c "docker compose -f compose.yaml -f compose.gcp.yaml up -d --build > /var/log/redline-build.log 2>&1"
```

8. **Check:** `curl https://<REDLINE_DOMAIN>/health`, then run the service check inside the container. It confirms the credentials, the tools and Seattle's past comments, with no model calls.

```bash
sudo docker compose -f compose.yaml -f compose.gcp.yaml exec api npm run check:services
```

9. **Emris:** set `REDLINE_API_URL` to `https://<REDLINE_DOMAIN>` and `REDLINE_API_KEY` to the same key in the Vercel project, for Preview first.

## Updating

Pull the branch you deploy and rebuild. Reports live in the `redline-data` volume and survive rebuilds.

```bash
cd /opt/redline && sudo git pull && cd deploy && sudo systemd-run --unit redline-build-$(date +%s) bash -c "docker compose -f compose.yaml -f compose.gcp.yaml up -d --build > /var/log/redline-build.log 2>&1"
```

Set `REDLINE_GIT_SHA` in `.env` to the new commit first, so reports record what ran.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `REDLINE_API_KEY` | none, required | The key Emris sends as `x-redline-key` |
| `VERTEX_PROJECT_ID` | the credentials' project | Where Claude runs and bills |
| `VERTEX_REGION` | `global` | Vertex AI location |
| `REDLINE_MODEL` | from `agent/agent.json` | A Vertex model id, e.g. `claude-haiku-4-5@20251001` |
| `STRIPE_PAYMENT_LINK`, `STRIPE_SECRET_KEY` | empty | Empty keeps unlocking as the free design-partner offer. See `docs/stripe-setup.md` |
| `REDLINE_DOMAIN` | none | The name Caddy gets a certificate for |
| `REDLINE_GIT_SHA` | `unknown` | Stands in for git inside the image |

### Seattle's past comments

`jurisdictions/seattle/comments.jsonl` isn't committed. The image builds it from Seattle's public data, with no keys and no model calls, and strips staff names as it goes. Without network access at build time, pass `--build-arg SKIP_SEATTLE_COMMENTS=1`, and `similar_comments` returns nothing for Seattle.

## Known risks

- **One small VM:** there's no failover, and a rebuild briefly takes the API down. Fine for demos, not for paying customers.
- **SSH is open to the internet** on port 22, as Google's default network allows. Restricting it to Google's IAP range is a later step.
- **Report text isn't encrypted by this code.** It sits on the VM's disk, which Google encrypts at rest.
- **Model access:** if Claude isn't enabled in Model Garden, every letter fails with a permission error, and the customer sees the "couldn't read this letter" message without being charged.
