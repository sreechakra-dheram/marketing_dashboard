import os
import json
import functools
import requests
from urllib.parse import quote
from flask import Flask, jsonify, redirect, request, session, url_for
from flask_cors import CORS
from dotenv import load_dotenv
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange,
    Dimension,
    Metric,
    RunReportRequest,
)
from googleapiclient.discovery import build
import google.auth
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from datetime import datetime, timedelta

app = Flask(__name__)
CORS(app, supports_credentials=True)

load_dotenv()

# Flask session secret
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret-change-in-production")

# GA4 — per org
GA4_PROPERTY_ID = {
    "ravenlabs": os.getenv("GA4_PROPERTY_ID_RAVENLABS"),
    "sdh":       os.getenv("GA4_PROPERTY_ID_SDH"),
    "linkstone": os.getenv("GA4_PROPERTY_ID_LINKSTONE"),
}

# GSC — per org
GSC_SITE_URL = {
    "ravenlabs": os.getenv("GSC_SITE_URL_RAVENLABS"),
    "sdh":       os.getenv("GSC_SITE_URL_SDH"),
    "linkstone": os.getenv("GSC_SITE_URL_LINKSTONE"),
}

YOUTUBE_CHANNEL_ID = os.getenv("YOUTUBE_CHANNEL_ID")

# LinkedIn
LINKEDIN_ACCESS_TOKEN = os.getenv("LINKEDIN_ACCESS_TOKEN")
LINKEDIN_ORGANIZATION_ID = os.getenv("LINKEDIN_ORG_ID_RAVENLABS")

# Meta — per org
FACEBOOK_ACCESS_TOKEN = {
    "ravenlabs": os.getenv("FACEBOOK_ACCESS_TOKEN_RAVENLABS"),
    "sdh":       os.getenv("FACEBOOK_ACCESS_TOKEN_SDH"),
}
FACEBOOK_PAGE_ID = {
    "ravenlabs": os.getenv("FACEBOOK_PAGE_ID_RAVENLABS"),
    "sdh":       os.getenv("FACEBOOK_PAGE_ID_SDH"),
}
INSTAGRAM_ACCESS_TOKEN = {
    "ravenlabs": os.getenv("INSTAGRAM_ACCESS_TOKEN_RAVENLABS"),
    "sdh":       os.getenv("INSTAGRAM_ACCESS_TOKEN_SDH"),
    "linkstone": os.getenv("INSTAGRAM_ACCESS_TOKEN_LINKSTONE"),
}
INSTAGRAM_ACCOUNT_ID = {
    "ravenlabs": os.getenv("INSTAGRAM_ACCOUNT_ID_RAVENLABS"),
    "sdh":       os.getenv("INSTAGRAM_ACCOUNT_ID_SDH"),
    "linkstone": os.getenv("INSTAGRAM_ACCOUNT_ID_LINKSTONE"),
}

# Twitter/X
TWITTER_BEARER_TOKEN = os.getenv("TWITTER_BEARER_TOKEN")
TWITTER_USER_ID = os.getenv("TWITTER_USER_ID")

# OAuth 2.0 config — Account B credentials (YouTube only)
OAUTH_CLIENT_ID = os.getenv("YOUTUBE_CLIENT_ID")
OAUTH_CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET")

# YouTube OAuth refresh token (stored after one-time admin auth)
YOUTUBE_REFRESH_TOKEN = os.getenv("YOUTUBE_REFRESH_TOKEN")

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/youtube.readonly",
]

# Allow HTTP for local dev (OAuth requires HTTPS in prod)
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"

# Path to .env file for writing the refresh token
ENV_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")


def get_youtube_credentials():
    """Build YouTube OAuth credentials from stored refresh token."""
    if not YOUTUBE_REFRESH_TOKEN:
        return None
    return Credentials(
        token=None,
        refresh_token=YOUTUBE_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=OAUTH_CLIENT_ID,
        client_secret=OAUTH_CLIENT_SECRET,
        scopes=YOUTUBE_SCOPES,
    )


# ─── Admin: One-time YouTube OAuth ──────────────────────────────────────────

@app.route("/admin/auth/youtube")
def admin_youtube_auth():
    """One-time route: channel owner visits this to grant YouTube access."""
    client_config = {
        "web": {
            "client_id": OAUTH_CLIENT_ID,
            "client_secret": OAUTH_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [url_for("admin_youtube_callback", _external=True)],
        }
    }
    flow = Flow.from_client_config(client_config, scopes=YOUTUBE_SCOPES)
    flow.redirect_uri = url_for("admin_youtube_callback", _external=True)

    authorization_url, state = flow.authorization_url(
        access_type="offline",
        prompt="consent",
    )
    session["yt_oauth_state"] = state
    return redirect(authorization_url)


@app.route("/admin/auth/youtube/callback")
def admin_youtube_callback():
    """Callback for YouTube OAuth — saves refresh token to .env."""
    client_config = {
        "web": {
            "client_id": OAUTH_CLIENT_ID,
            "client_secret": OAUTH_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [url_for("admin_youtube_callback", _external=True)],
        }
    }
    flow = Flow.from_client_config(client_config, scopes=YOUTUBE_SCOPES)
    flow.redirect_uri = url_for("admin_youtube_callback", _external=True)
    flow.fetch_token(authorization_response=request.url)

    credentials = flow.credentials
    refresh_token = credentials.refresh_token

    if not refresh_token:
        return "<h3>Error: No refresh token received.</h3><p>Try revoking app access at <a href='https://myaccount.google.com/permissions'>Google Permissions</a> and try again.</p>", 400

    # Save refresh token to .env file
    _save_refresh_token_to_env(refresh_token)

    # Update the global variable so it works immediately without restart
    global YOUTUBE_REFRESH_TOKEN
    YOUTUBE_REFRESH_TOKEN = refresh_token

    return (
        "<h3 style='font-family:Inter,sans-serif;color:#0f172a;'>YouTube authorized successfully!</h3>"
        "<p style='font-family:Inter,sans-serif;color:#475569;'>Refresh token saved to .env. "
        "YouTube Analytics data will now load on the dashboard.</p>"
        "<p style='font-family:Inter,sans-serif;'><a href='/'>Go to Dashboard</a></p>"
    )


def _save_refresh_token_to_env(token):
    """Append or update YOUTUBE_REFRESH_TOKEN in .env file."""
    lines = []
    found = False

    if os.path.exists(ENV_FILE_PATH):
        with open(ENV_FILE_PATH, "r") as f:
            lines = f.readlines()

    new_lines = []
    for line in lines:
        if line.strip().startswith("YOUTUBE_REFRESH_TOKEN="):
            new_lines.append(f"YOUTUBE_REFRESH_TOKEN={token}\n")
            found = True
        else:
            new_lines.append(line)

    if not found:
        new_lines.append(f"\n# YouTube OAuth refresh token (auto-saved by admin auth)\nYOUTUBE_REFRESH_TOKEN={token}\n")

    with open(ENV_FILE_PATH, "w") as f:
        f.writelines(new_lines)

    print(f"YouTube refresh token saved to {ENV_FILE_PATH}")


# ─── Dashboard (public) ─────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve the main dashboard."""
    return app.send_static_file("index.html")


@app.route("/<path:filename>")
def serve_static(filename):
    """Serve static assets from /public directory."""
    return app.send_static_file(filename)


# Set static folder to /public
app.static_folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
app.static_url_path = ""


# ─── GA4 Service ─────────────────────────────────────────────────────────────

class AnalyticsService:
    @staticmethod
    def get_ga4_report(org: str = "ravenlabs", days: int = 7):
        property_id = GA4_PROPERTY_ID.get(org)
        if not property_id:
            return {"error": f"GA4_PROPERTY_ID not configured for org: {org}"}, 500

        try:
            client = BetaAnalyticsDataClient()
            req = RunReportRequest(
                property=f"properties/{property_id}",
                dimensions=[Dimension(name="date")],
                metrics=[
                    Metric(name="sessions"),
                    Metric(name="activeUsers"),
                    Metric(name="screenPageViews"),
                    Metric(name="eventCount"),
                ],
                date_ranges=[DateRange(start_date=f"{days}daysAgo", end_date="today")],
            )

            response = client.run_report(req)

            data = {
                "dates": [], "sessions": [], "activeUsers": [],
                "screenPageViews": [], "eventCount": [],
            }

            sorted_rows = sorted(response.rows, key=lambda row: row.dimension_values[0].value)
            for row in sorted_rows:
                data["dates"].append(row.dimension_values[0].value)
                data["sessions"].append(int(row.metric_values[0].value))
                data["activeUsers"].append(int(row.metric_values[1].value))
                data["screenPageViews"].append(int(row.metric_values[2].value))
                data["eventCount"].append(int(row.metric_values[3].value))

            return data, 200

        except Exception as e:
            print(f"Error fetching GA4 data: {e}")
            return {"error": str(e)}, 500


# ─── Google Search Console Service ──────────────────────────────────────────

class SearchConsoleService:
    @staticmethod
    def get_gsc_report(org: str = "ravenlabs", days: int = 7):
        site_url = GSC_SITE_URL.get(org)
        if not site_url:
            return {"error": f"GSC_SITE_URL not configured for org: {org}"}, 500

        try:
            credentials, _ = google.auth.default(
                scopes=["https://www.googleapis.com/auth/webmasters.readonly"]
            )
            service = build("webmasters", "v3", credentials=credentials)

            end_date = datetime.now() - timedelta(days=2)
            start_date = end_date - timedelta(days=days - 1)

            req_body = {
                "startDate": start_date.strftime("%Y-%m-%d"),
                "endDate": end_date.strftime("%Y-%m-%d"),
                "dimensions": ["date"],
            }

            response = (
                service.searchanalytics()
                .query(siteUrl=site_url, body=req_body)
                .execute()
            )

            data = {"dates": [], "clicks": [], "impressions": [], "ctr": [], "position": []}

            if "rows" in response:
                sorted_rows = sorted(response["rows"], key=lambda row: row["keys"][0])
                for row in sorted_rows:
                    data["dates"].append(row["keys"][0].replace("-", ""))
                    data["clicks"].append(int(row["clicks"]))
                    data["impressions"].append(int(row["impressions"]))
                    data["ctr"].append(float(row["ctr"]))
                    data["position"].append(float(row["position"]))

            return data, 200

        except Exception as e:
            print(f"Error fetching GSC data: {e}")
            return {"error": str(e)}, 500


# ─── YouTube Service (Data API v3 + Analytics API hybrid) ────────────────────

class YouTubeService:
    @staticmethod
    def get_youtube_report(credentials):
        """Fetch YouTube data using Data API v3 for stats + Analytics API for daily trends."""
        try:
            yt_data = build("youtube", "v3", credentials=credentials)

            # ── Channel stats (lifetime, always accurate) ──
            channels = yt_data.channels().list(part="statistics,snippet", mine=True).execute()
            channel = channels["items"][0] if channels.get("items") else {}
            stats = channel.get("statistics", {})

            # ── Recent videos with per-video stats (last 50) ──
            search_resp = yt_data.search().list(
                part="id",
                channelId=channel.get("id", ""),
                order="date",
                maxResults=50,
                type="video",
                publishedAfter=(datetime.now() - timedelta(days=28)).strftime("%Y-%m-%dT00:00:00Z"),
            ).execute()

            video_ids = [item["id"]["videoId"] for item in search_resp.get("items", []) if item["id"].get("videoId")]

            recent_videos = []
            recent_views = 0
            recent_likes = 0
            recent_comments = 0

            if video_ids:
                videos_resp = yt_data.videos().list(
                    part="statistics,snippet,contentDetails",
                    id=",".join(video_ids),
                ).execute()

                for v in videos_resp.get("items", []):
                    vs = v.get("statistics", {})
                    views = int(vs.get("viewCount", 0))
                    likes = int(vs.get("likeCount", 0))
                    comments = int(vs.get("commentCount", 0))
                    recent_views += views
                    recent_likes += likes
                    recent_comments += comments
                    recent_videos.append({
                        "title": v["snippet"]["title"],
                        "publishedAt": v["snippet"]["publishedAt"],
                        "views": views,
                        "likes": likes,
                        "comments": comments,
                    })

            # ── Analytics API for daily trend (may be delayed/zeros for small channels) ──
            dates = []
            daily_views = []
            daily_watch = []
            daily_subs_gained = []
            daily_subs_lost = []

            try:
                yt_analytics = build("youtubeAnalytics", "v2", credentials=credentials)
                end_date = datetime.now().strftime("%Y-%m-%d")
                start_date = (datetime.now() - timedelta(days=28)).strftime("%Y-%m-%d")

                report = (
                    yt_analytics.reports()
                    .query(
                        ids="channel==MINE",
                        startDate=start_date,
                        endDate=end_date,
                        metrics="views,estimatedMinutesWatched,subscribersGained,subscribersLost",
                        dimensions="day",
                        sort="day",
                    )
                    .execute()
                )

                for row in report.get("rows", []):
                    dates.append(row[0].replace("-", ""))
                    daily_views.append(int(row[1]))
                    daily_watch.append(float(row[2]))
                    daily_subs_gained.append(int(row[3]))
                    daily_subs_lost.append(int(row[4]))
            except Exception as e:
                print(f"YouTube Analytics API unavailable (using Data API only): {e}")

            # ── Check if Analytics data is all zeros — use Data API totals instead ──
            analytics_total_views = sum(daily_views)
            use_data_api_totals = analytics_total_views == 0 and recent_views > 0

            data = {
                # Channel lifetime stats
                "totalViews": int(stats.get("viewCount", 0)),
                "totalSubscribers": int(stats.get("subscriberCount", 0)),
                "totalVideos": int(stats.get("videoCount", 0)),
                # Recent period stats (from Data API — always accurate)
                "recentViews": recent_views,
                "recentLikes": recent_likes,
                "recentComments": recent_comments,
                "recentVideoCount": len(recent_videos),
                "recentVideos": recent_videos[:10],
                # Daily trend data (from Analytics API — may lag)
                "dates": dates,
                "dailyViews": daily_views,
                "watchTimeMinutes": daily_watch,
                "subscribersGained": daily_subs_gained,
                "subscribersLost": daily_subs_lost,
                # Flag so frontend knows which source to trust
                "analyticsAvailable": not use_data_api_totals,
            }

            return data, 200

        except Exception as e:
            print(f"Error fetching YouTube data: {e}")
            return {"error": str(e)}, 500


# ─── LinkedIn Service ────────────────────────────────────────────────────────

class LinkedInService:
    BASE = "https://api.linkedin.com/v2"

    @staticmethod
    def get_linkedin_report():
        if not LINKEDIN_ACCESS_TOKEN or not LINKEDIN_ORGANIZATION_ID:
            return {"error": "LINKEDIN_ACCESS_TOKEN and LINKEDIN_ORGANIZATION_ID not configured"}, 500

        try:
            headers = {
                "Authorization": f"Bearer {LINKEDIN_ACCESS_TOKEN}",
                "X-Restli-Protocol-Version": "2.0.0",
            }
            org_urn = f"urn:li:organization:{LINKEDIN_ORGANIZATION_ID}"
            org_urn_encoded = quote(org_urn, safe="")

            # Follower count — URN must be URL-encoded in the path
            follower_resp = requests.get(
                f"{LinkedInService.BASE}/networkSizes/{org_urn_encoded}",
                params={"edgeType": "CompanyFollowedByMember"},
                headers=headers,
                timeout=10,
            )
            follower_resp.raise_for_status()
            follower_count = follower_resp.json().get("firstDegreeSize", 0)

            # Recent posts (ugcPosts)
            posts_resp = requests.get(
                f"{LinkedInService.BASE}/ugcPosts",
                params={"q": "authors", "authors": f"List({org_urn})", "count": 10},
                headers=headers,
                timeout=10,
            )
            posts_resp.raise_for_status()
            posts_data = posts_resp.json()
            post_elements = posts_data.get("elements", [])
            post_count = posts_data.get("paging", {}).get("total", len(post_elements))

            # Aggregate likes and reposts from share statistics
            total_likes = 0
            total_reposts = 0
            for post in post_elements:
                post_urn = post.get("id", "")
                stats_resp = requests.get(
                    f"{LinkedInService.BASE}/organizationalEntityShareStatistics",
                    params={"q": "organizationalEntity", "organizationalEntity": org_urn, "ugcPosts": f"List({post_urn})"},
                    headers=headers,
                    timeout=10,
                )
                if stats_resp.ok:
                    for el in stats_resp.json().get("elements", []):
                        total_stats = el.get("totalShareStatistics", {})
                        total_likes += total_stats.get("likeCount", 0)
                        total_reposts += total_stats.get("shareCount", 0)

            return {
                "followerCount": follower_count,
                "postCount": post_count,
                "totalLikes": total_likes,
                "totalReposts": total_reposts,
            }, 200

        except Exception as e:
            print(f"Error fetching LinkedIn data: {e}")
            return {"error": str(e)}, 500


# ─── Meta Service (Facebook + Instagram) ────────────────────────────────────

class MetaService:
    GRAPH = "https://graph.facebook.com/v19.0"

    @staticmethod
    def get_meta_report(org: str = "ravenlabs"):
        fb_token = FACEBOOK_ACCESS_TOKEN.get(org)
        fb_page  = FACEBOOK_PAGE_ID.get(org)
        ig_token = INSTAGRAM_ACCESS_TOKEN.get(org)
        ig_acct  = INSTAGRAM_ACCOUNT_ID.get(org)

        result = {
            "facebook":  {"postCount": 0, "likes": 0, "impressions": 0, "clicks": 0},
            "instagram": {"postCount": 0, "likes": 0, "impressions": 0, "clicks": 0, "followerCount": 0},
        }

        try:
            # ── Facebook ──
            if fb_token and fb_page:
                since = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
                until = datetime.now().strftime("%Y-%m-%d")

                # page_fans is a lifetime metric — must NOT be mixed with period=day
                fb_insights_resp = requests.get(
                    f"{MetaService.GRAPH}/{fb_page}/insights",
                    params={
                        "metric": "page_post_engagements,page_impressions",
                        "period": "day",
                        "since": since,
                        "until": until,
                        "access_token": fb_token,
                    },
                    timeout=10,
                )
                fb_likes = 0
                fb_impressions = 0
                if fb_insights_resp.ok:
                    for metric in fb_insights_resp.json().get("data", []):
                        values = metric.get("values", [])
                        total = sum(v.get("value", 0) for v in values if isinstance(v.get("value"), (int, float)))
                        if metric["name"] == "page_post_engagements":
                            fb_likes = total
                        elif metric["name"] == "page_impressions":
                            fb_impressions = total
                else:
                    print(f"FB insights error {fb_insights_resp.status_code}: {fb_insights_resp.text[:300]}")

                fb_posts_resp = requests.get(
                    f"{MetaService.GRAPH}/{fb_page}/posts",
                    params={"fields": "id", "limit": 100, "access_token": fb_token},
                    timeout=10,
                )
                fb_post_count = len(fb_posts_resp.json().get("data", [])) if fb_posts_resp.ok else 0
                result["facebook"] = {
                    "postCount": fb_post_count,
                    "likes": int(fb_likes),
                    "impressions": int(fb_impressions),
                    "clicks": 0,
                }

            # ── Instagram ──
            if ig_token and ig_acct:
                ig_insights_resp = requests.get(
                    f"{MetaService.GRAPH}/{ig_acct}/insights",
                    params={
                        "metric": "impressions,reach",
                        "period": "week",
                        "access_token": ig_token,
                    },
                    timeout=10,
                )
                ig_impressions = 0
                if ig_insights_resp.ok:
                    for metric in ig_insights_resp.json().get("data", []):
                        if metric["name"] == "impressions":
                            values = metric.get("values", [])
                            ig_impressions = values[-1].get("value", 0) if values else 0
                else:
                    print(f"IG insights error {ig_insights_resp.status_code}: {ig_insights_resp.text[:300]}")

                ig_media_resp = requests.get(
                    f"{MetaService.GRAPH}/{ig_acct}/media",
                    params={"fields": "id,like_count,comments_count", "limit": 50, "access_token": ig_token},
                    timeout=10,
                )
                ig_media = ig_media_resp.json().get("data", []) if ig_media_resp.ok else []
                ig_likes = sum(m.get("like_count", 0) for m in ig_media)

                ig_info_resp = requests.get(
                    f"{MetaService.GRAPH}/{ig_acct}",
                    params={"fields": "followers_count", "access_token": ig_token},
                    timeout=10,
                )
                ig_followers = ig_info_resp.json().get("followers_count", 0) if ig_info_resp.ok else 0

                result["instagram"] = {
                    "postCount": len(ig_media),
                    "likes": ig_likes,
                    "impressions": int(ig_impressions),
                    "clicks": 0,
                    "followerCount": ig_followers,
                }

            return result, 200

        except Exception as e:
            print(f"Error fetching Meta data: {e}")
            return {"error": str(e)}, 500


# ─── Twitter/X Service ────────────────────────────────────────────────────────

class TwitterService:
    BASE = "https://api.twitter.com/2"

    @staticmethod
    def get_twitter_report():
        if not TWITTER_BEARER_TOKEN or not TWITTER_USER_ID:
            return {"error": "TWITTER_BEARER_TOKEN and TWITTER_USER_ID not configured"}, 500

        try:
            headers = {"Authorization": f"Bearer {TWITTER_BEARER_TOKEN}"}

            # Recent tweets (last 7 days)
            start_time = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
            tweets_resp = requests.get(
                f"{TwitterService.BASE}/users/{TWITTER_USER_ID}/tweets",
                params={
                    "start_time": start_time,
                    "tweet.fields": "public_metrics",
                    "max_results": 100,
                },
                headers=headers,
                timeout=10,
            )
            tweets_resp.raise_for_status()
            tweets_data = tweets_resp.json()
            tweets = tweets_data.get("data", [])

            total_impressions = 0
            total_likes = 0
            total_clicks = 0

            for tweet in tweets:
                metrics = tweet.get("public_metrics", {})
                total_impressions += metrics.get("impression_count", 0)
                total_likes += metrics.get("like_count", 0)
                total_clicks += metrics.get("url_link_clicks", 0)

            return {
                "postCount": len(tweets),
                "impressions": total_impressions,
                "likes": total_likes,
                "clicks": total_clicks,
            }, 200

        except Exception as e:
            print(f"Error fetching Twitter data: {e}")
            return {"error": str(e)}, 500


# ─── API Endpoints ───────────────────────────────────────────────────────────

@app.route("/api/ga4", methods=["GET"])
def get_ga4_data():
    org = request.args.get("org", "ravenlabs")
    days = min(int(request.args.get("days", 7)), 90)
    data, status_code = AnalyticsService.get_ga4_report(org, days)
    return jsonify(data), status_code


@app.route("/api/gsc", methods=["GET"])
def get_gsc_data():
    org = request.args.get("org", "ravenlabs")
    days = min(int(request.args.get("days", 7)), 90)
    data, status_code = SearchConsoleService.get_gsc_report(org, days)
    return jsonify(data), status_code


@app.route("/api/youtube", methods=["GET"])
def get_youtube_data():
    """Endpoint serving YouTube Analytics data using stored refresh token."""
    creds = get_youtube_credentials()
    if not creds:
        return jsonify({
            "error": "YouTube not authorized. Admin must visit /admin/auth/youtube first."
        }), 403
    data, status_code = YouTubeService.get_youtube_report(creds)
    return jsonify(data), status_code


@app.route("/api/youtube/status", methods=["GET"])
def youtube_auth_status():
    """Check if YouTube is authorized."""
    return jsonify({"authorized": bool(YOUTUBE_REFRESH_TOKEN)})


@app.route("/api/youtube/debug", methods=["GET"])
def youtube_debug():
    """Debug endpoint — shows raw YouTube API response and channel info."""
    creds = get_youtube_credentials()
    if not creds:
        return jsonify({"error": "Not authorized"}), 403

    try:
        # First check which channel the token belongs to
        yt_data = build("youtube", "v3", credentials=creds)
        channels = yt_data.channels().list(part="snippet,statistics", mine=True).execute()

        channel_info = {}
        if channels.get("items"):
            ch = channels["items"][0]
            channel_info = {
                "id": ch["id"],
                "title": ch["snippet"]["title"],
                "subscriberCount": ch["statistics"].get("subscriberCount"),
                "viewCount": ch["statistics"].get("viewCount"),
            }

        # Now fetch analytics
        yt_analytics = build("youtubeAnalytics", "v2", credentials=creds)
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=28)).strftime("%Y-%m-%d")

        report = (
            yt_analytics.reports()
            .query(
                ids="channel==MINE",
                startDate=start_date,
                endDate=end_date,
                metrics="views,estimatedMinutesWatched,likes,subscribersGained",
                dimensions="day",
                sort="day",
            )
            .execute()
        )

        return jsonify({
            "channel": channel_info,
            "env_channel_id": YOUTUBE_CHANNEL_ID,
            "analytics_row_count": len(report.get("rows", [])),
            "analytics_sample": report.get("rows", [])[:5],
            "analytics_column_headers": report.get("columnHeaders", []),
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/linkedin", methods=["GET"])
def get_linkedin_data():
    data, status_code = LinkedInService.get_linkedin_report()
    return jsonify(data), status_code


@app.route("/api/social/meta", methods=["GET"])
def get_meta_data():
    org = request.args.get("org", "ravenlabs")
    data, status_code = MetaService.get_meta_report(org)
    return jsonify(data), status_code


@app.route("/api/social/twitter", methods=["GET"])
def get_twitter_data():
    data, status_code = TwitterService.get_twitter_report()
    return jsonify(data), status_code


@app.route("/api/google-ads", methods=["GET"])
def get_google_ads_data():
    return jsonify({
        "status": "pending",
        "message": "Google Ads integration pending developer account approval",
    }), 200


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    print("Starting Raven Labs Analytics API...")
    if not YOUTUBE_REFRESH_TOKEN:
        print("⚠ YouTube not authorized. Visit http://localhost:{}/admin/auth/youtube to authorize.".format(port))
    app.run(host="0.0.0.0", port=port, debug=os.getenv("FLASK_DEBUG", "true").lower() == "true")
