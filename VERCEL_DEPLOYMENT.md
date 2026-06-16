# Vercel Deployment — Frontend Only

> **Important**: Vercel hosts the React frontend. The FastAPI backend, MongoDB,
> MQTT broker and the four background tasks **MUST run on a persistent host**
> (DigitalOcean Droplet, Railway, Render or Fly.io). See `/app/do-deploy/DEPLOYMENT.md`
> for the recommended DigitalOcean setup.

---

## What you'll deploy where

| Component | Host | URL |
| --------- | ---- | --- |
| React UI         | **Vercel**          | `https://www.envirolyticsmonitoring.com` |
| FastAPI backend  | DigitalOcean / Railway / Render | `https://api.envirolyticsmonitoring.com` |
| MongoDB          | MongoDB Atlas (M0, ap-south-1)  | (Atlas-managed)                          |

---

## Step-by-step Vercel deployment (5 minutes)

### 1. Push to GitHub
- Emergent chat input → **Save to GitHub** → copy the repo URL.

### 2. Spin up the backend first (so you have a URL for Vercel)
Cheapest options:
- **DigitalOcean Droplet** — follow `/app/do-deploy/DEPLOYMENT.md` (the playbook you already have).
- **Railway** — easier 1-click. Create project from GitHub, set the root to `/backend`, add MongoDB plug-in OR external Atlas URI, paste env vars from `/app/backend/.env`. Generates `https://<project>.up.railway.app` automatically.
- **Render** — same flow as Railway. Free tier sleeps after 15 min idle (bad for MQTT) — use the $7/mo Starter plan.

Whichever you pick, **note the backend URL** (e.g. `https://api.envirolyticsmonitoring.com` after DNS setup).

### 3. Connect Vercel
1. <https://vercel.com> → **Import Git Repository** → pick your repo.
2. **Root Directory**: `frontend` (this matters — the repo has both `frontend/` and `backend/`).
3. **Framework Preset**: Create React App (auto-detected).
4. **Build Command**: `yarn build` (auto from `vercel.json`).
5. **Output Directory**: `build` (auto from `vercel.json`).

### 4. Environment variables (Vercel → Settings → Environment Variables)
Add **one** required variable:

| Key                       | Value                                                  | Environments |
| ------------------------- | ------------------------------------------------------ | ------------ |
| `REACT_APP_BACKEND_URL`   | `https://api.envirolyticsmonitoring.com`               | Production, Preview, Development |

Optional but recommended:
| `REACT_APP_WEATHER_API_KEY` | Your OpenWeatherMap key (already in `frontend/.env`)  | Production |

### 5. Custom domain
- Vercel → Settings → Domains → add `www.envirolyticsmonitoring.com` → follow the DNS instructions
  (one CNAME for `www` → `cname.vercel-dns.com`, and an A record for the apex → `76.76.21.21`).
- Wait 5–30 min for the TLS certificate to issue automatically.

### 6. Backend CORS
Already configured in `/app/backend/server.py` to allow `*` — works out of the box.
For tighter security, set `CORS_ORIGINS=https://www.envirolyticsmonitoring.com` in the backend `.env` post-deploy.

---

## Why not just deploy the whole app on Vercel?

| Capability you have | Vercel serverless | Persistent host (DO/Railway/Render) |
| ------------------- | ----------------- | ----------------------------------- |
| Paho MQTT persistent connection                  | ❌ killed every 10 s | ✅ |
| Background tasks (offline alerts, limits, renewals, simulator) | ❌ stateless    | ✅ |
| Long-running Open-Meteo fetch on cold-start       | ⚠️ may timeout       | ✅ |
| Certificate file uploads stored on disk          | ❌ ephemeral fs       | ✅ |
| MongoDB connection-pool reuse                    | ⚠️ cold-start churn   | ✅ |

You'd have to rewrite ~60% of the backend to make it Vercel-compatible (move MQTT to a 3rd-party
worker like Inngest, move scheduled tasks to Vercel cron, move uploads to S3, etc.). Hybrid wins.

---

## Cost summary for the hybrid

| Item                                | Monthly |
| ----------------------------------- | ------- |
| Vercel Hobby (frontend)             | **Free** |
| DigitalOcean Droplet `s-2vcpu-4gb` BLR1 | $24 |
| MongoDB Atlas M0 (Mumbai)           | Free   |
| Total                               | **~$24** |

If you'd rather skip DigitalOcean, **Railway Starter** is $5 + usage (≈ $10/mo total) and is the
quickest non-DO path.

---

## After Vercel deploy

1. Confirm `https://<your-app>.vercel.app/` loads the login screen.
2. Log in as admin (`admin@envirolytics.com` / your prod password).
3. Open browser DevTools → Network tab → confirm `/api/*` requests go to your backend host, not Vercel.
4. Add the `RESEND_API_KEY` to the backend host (Vercel doesn't see this — it's a backend secret).
5. Test the dashboard offline-alert banner, limits, renewals all work end-to-end.

That's it.
