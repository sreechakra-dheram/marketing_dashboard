# Raven Labs Marketing Dashboard

A unified marketing analytics dashboard built with Flask, integrating **Google Analytics 4**, **Google Search Console**, and **YouTube Analytics** into a single glassmorphism-styled interface. Deployed on **Google Cloud Run**.

**Live URL:** `https://marketing-dashboard-181044228314.us-central1.run.app`

---

## Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌──────────────────────┐
│   Browser    │ ───> │  Flask (gunicorn) │ ───> │  Google APIs          │
│  (SPA tabs)  │ <─── │  /api/ga4         │      │  - GA4 Data API v1β  │
│              │      │  /api/gsc         │      │  - Search Console v3  │
│              │      │  /api/youtube     │      │  - YouTube Data v3    │
│              │      │                   │      │  - YouTube Analytics  │
└─────────────┘      └──────────────────┘      └──────────────────────┘
                        │                          │
                        │ Service Account ─────────┤ (GA4, GSC)
                        │ OAuth Refresh Token ─────┤ (YouTube)
```

- **GA4 & GSC** use a GCP **service account** (server-to-server, no user login needed)
- **YouTube** uses a one-time **OAuth 2.0** flow — the channel owner authorizes once, and the refresh token is stored for all future requests

---

## Quick Start (Local)

### 1. Clone & install

```bash
git clone https://github.com/sreechakra-dheram/marketing_dashboard.git
cd marketing_dashboard
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. GCP setup

You need a GCP project with the following APIs enabled:

| API | Used for |
|-----|----------|
| Google Analytics Data API | GA4 metrics |
| Search Console API | GSC clicks, impressions, CTR |
| YouTube Data API v3 | Video stats (views, likes, comments) |
| YouTube Analytics API v2 | Daily trend data (views, watch time, subs) |

**Create a Service Account:**
1. Go to **GCP Console > IAM & Admin > Service Accounts**
2. Create a new service account and download the JSON key
3. Grant this service account **Viewer** access to your GA4 property (GA4 Admin > Property Access Management)
4. Add the service account email as a user in **Google Search Console** for your site

**Create OAuth 2.0 Credentials:**
1. Go to **GCP Console > APIs & Services > Credentials**
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Add authorized redirect URIs:
   - `http://localhost:5000/admin/auth/youtube/callback` (local dev)
   - `https://<your-cloud-run-url>/admin/auth/youtube/callback` (production)
4. Go to **OAuth consent screen** > add test users (your Google accounts)
5. Add these scopes to the consent screen:
   - `https://www.googleapis.com/auth/yt-analytics.readonly`
   - `https://www.googleapis.com/auth/youtube.readonly`

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# GA4
GA4_PROPERTY_ID=123456789

# Service Account key file path
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-service-account.json

# OAuth 2.0 (for YouTube)
GOOGLE_OAUTH_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxxx

# YouTube
YOUTUBE_CHANNEL_ID=UCxxxxx

# Flask
FLASK_SECRET_KEY=<run: python -c "import secrets; print(secrets.token_hex(32))">
FLASK_DEBUG=true
PORT=5000
```

### 4. Authorize YouTube (one-time)

```bash
python app.py
```

Visit `http://localhost:5000/admin/auth/youtube` in your browser. Sign in with the Google account that owns the YouTube channel. After authorization, the refresh token is automatically saved to `.env`.

### 5. Use the dashboard

Open `http://localhost:5000`. Switch between tabs:
- **GA4** — Sessions, active users, page views, events (7-day)
- **GSC** — Clicks, impressions, CTR, position (7-day)
- **YouTube** — Views, subscribers, watch time, recent videos

---

## Deploy to Google Cloud Run

### Prerequisites
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated
- Docker (for local builds) or use `--source` for Cloud Build

### Deploy

```bash
# Set your project
gcloud config set project YOUR_GCP_PROJECT_ID

# Deploy (builds in the cloud using Dockerfile)
gcloud run deploy marketing-dashboard \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --env-vars-file env.yaml \
  --port 8080 \
  --memory 512Mi \
  --timeout 120
```

**Important:** Create an `env.yaml` file with your environment variables (do NOT commit this):

```yaml
GA4_PROPERTY_ID: "123456789"
GOOGLE_APPLICATION_CREDENTIALS: "/app/your-service-account.json"
GOOGLE_OAUTH_CLIENT_ID: "xxxxx.apps.googleusercontent.com"
GOOGLE_OAUTH_CLIENT_SECRET: "GOCSPX-xxxxx"
YOUTUBE_CHANNEL_ID: "UCxxxxx"
FLASK_SECRET_KEY: "your-secret-key"
FLASK_DEBUG: "false"
YOUTUBE_REFRESH_TOKEN: "1//xxxxx"
```

> **Note:** The service account JSON file must be included in the Docker image. The `.gcloudignore` is configured to include `*.json` files (unlike `.gitignore` which excludes them). Never commit the JSON key to git.

After deployment, add the Cloud Run URL to your OAuth redirect URIs in GCP Console.

---

## Project Structure

```
marketing_dashboard/
├── app.py                  # Flask backend — API services, OAuth flow, routes
├── public/                 # Frontend (served as static files)
│   ├── index.html          # Main dashboard (tab-based SPA)
│   ├── login.html          # Login page (preserved for future use)
│   ├── css/style.css       # Glassmorphism UI styles
│   └── js/script.js        # Tab switching, API calls, Chart.js rendering
├── Dockerfile              # Cloud Run container config
├── requirements.txt        # Python dependencies
├── .env.example            # Environment variable template
├── .gcloudignore           # Files to exclude from Cloud Build (allows *.json)
└── .gitignore              # Files to exclude from git (excludes .env, *.json)
```

---

## Leveling Up: Future Integrations

### Google Ads
Requires a [Google Ads Developer Token](https://developers.google.com/google-ads/api/docs/get-started/dev-token). Once obtained:
1. Add `google-ads` to `requirements.txt`
2. Create a new `GoogleAdsService` class in `app.py` using the Google Ads API
3. Add a `/api/google-ads` endpoint
4. Add a new tab panel in `index.html` and fetch logic in `script.js`
5. Set env vars: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`

### Google Login (Authentication)
The OAuth login flow is already built into the codebase but currently disabled. To re-enable:
1. Apply the `@login_required` decorator to the API routes in `app.py`
2. Uncomment or wire up the `/oauth/start` and `/oauth/callback` routes
3. Configure `ALLOWED_EMAILS` in `.env` to restrict access to specific Google accounts
4. The login page is already at `public/login.html`

### Social Media (Meta/Instagram, LinkedIn, X/Twitter)
Each platform has its own API and auth flow:

| Platform | API | Auth | Key metrics |
|----------|-----|------|-------------|
| Meta/Instagram | Graph API | OAuth (Facebook Login) | Reach, impressions, engagement |
| LinkedIn | Marketing API | OAuth 2.0 (3-legged) | Followers, impressions, clicks |
| X/Twitter | X API v2 | OAuth 2.0 (PKCE) | Tweets, impressions, engagement |

For each:
1. Register an app on the platform's developer portal
2. Create a service class following the existing pattern (`AnalyticsService`, `YouTubeService`)
3. Add an API endpoint, tab panel, and chart rendering

### Email Marketing (Mailchimp, SendGrid)
Most email platforms offer REST APIs with API key auth:
1. Add the platform's SDK to `requirements.txt`
2. Create a service class to fetch campaign stats (open rate, click rate, subscribers)
3. Add a dashboard tab with KPIs and trend charts

### CRM (HubSpot, Salesforce)
1. Use the platform's REST API with OAuth or API key
2. Pull deal pipeline, contact growth, and revenue metrics
3. Add a dedicated tab with funnel visualization

### General Pattern for Adding Any Integration

```python
# 1. Add service class in app.py
class NewService:
    @staticmethod
    def get_report():
        try:
            # Call external API
            # Transform response into {dates: [], metric1: [], metric2: []}
            return data, 200
        except Exception as e:
            return {"error": str(e)}, 500

# 2. Add API endpoint
@app.route("/api/new-service", methods=["GET"])
def get_new_data():
    data, status = NewService.get_report()
    return jsonify(data), status
```

```html
<!-- 3. Add nav link in index.html sidebar -->
<a class="nav-link" data-tab="new-service">
    <svg class="nav-icon">...</svg>
    New Service
</a>

<!-- 4. Add tab panel -->
<div class="tab-panel" id="tab-new-service">
    <div class="kpi-grid">...</div>
    <div class="charts-grid">...</div>
</div>
```

```javascript
// 5. Add fetch + render in script.js
async function fetchNewService() {
    const res = await fetch(`${API_BASE}/api/new-service`);
    const data = await res.json();
    // Populate KPI cards and charts
}
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| GA4 shows N/A | Verify service account has Viewer access in GA4 property settings |
| GSC shows N/A | Add service account email as a user in Search Console |
| YouTube shows "Not Authorized" | Visit `/admin/auth/youtube` to complete the one-time OAuth flow |
| YouTube Analytics returns zeros | Normal for smaller channels — the Data API v3 stats (KPIs) are always accurate; Analytics API data may lag 2-3 days |
| OAuth 400: redirect_uri_mismatch | Add the exact callback URL to OAuth client redirect URIs in GCP Console |
| OAuth 403: access_denied | Add your email as a test user in OAuth consent screen settings |
| Cloud Run deploy: permission denied | Grant `roles/cloudbuild.builds.builder` and `roles/storage.admin` to the default compute service account |

---

## Tech Stack

- **Backend:** Python 3.12, Flask, Gunicorn
- **Frontend:** Vanilla JS, Chart.js, CSS (glassmorphism)
- **APIs:** Google Analytics Data API, Search Console API, YouTube Data/Analytics API
- **Auth:** Google Service Account (GA4, GSC) + OAuth 2.0 refresh token (YouTube)
- **Deployment:** Google Cloud Run, Cloud Build, Artifact Registry
