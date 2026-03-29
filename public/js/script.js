// Chart.js defaults
Chart.defaults.color = '#475569';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.scale.grid.color = 'rgba(0, 0, 0, 0.05)';
Chart.defaults.scale.grid.borderColor = 'rgba(0, 0, 0, 0.05)';

let ga4ChartInstance = null;
let ga4EngagementChartInstance = null;
let gscChartInstance = null;
let ytViewsChartInstance = null;
let ytSubsChartInstance = null;

const API_BASE_URL = window.location.origin + '/api';

// Track which tabs have loaded data
const tabLoaded = { ga4: false, gsc: false, youtube: false, linkedin: false, social: false, 'google-ads': false };

function formatDateString(dateStr) {
    if (!dateStr || dateStr.length !== 8) return dateStr;
    const year = dateStr.substring(0, 4);
    const month = parseInt(dateStr.substring(4, 6)) - 1;
    const day = dateStr.substring(6, 8);
    return new Date(year, month, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function updateKPIValue(elementId, value) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.classList.remove('loading-shimmer');
    el.innerText = typeof value === 'string' ? value : value.toLocaleString();
    el.style.transform = 'scale(1.05)';
    setTimeout(() => { el.style.transform = 'scale(1)'; el.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'; }, 50);
}

function showKPIError(ids) {
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.innerText = "N/A"; el.classList.remove('loading-shimmer'); }
    });
}

async function apiFetch(endpoint) {
    const response = await fetch(`${API_BASE_URL}/${endpoint}`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
}

// ─── Tab Switching ──────────────────────────────────────────────────────────

function switchTab(tabName) {
    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.tab === tabName);
    });
    // Update panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === 'tab-' + tabName);
    });
    // Lazy-load data on first visit
    if (tabName === 'ga4' && !tabLoaded.ga4) { fetchGA4Data(); }
    if (tabName === 'gsc' && !tabLoaded.gsc) { fetchGSCData(); }
    if (tabName === 'youtube' && !tabLoaded.youtube) { fetchYouTubeData(); }
    if (tabName === 'linkedin' && !tabLoaded.linkedin) { fetchLinkedInData(); }
    if (tabName === 'social' && !tabLoaded.social) { fetchSocialData(); }
    if (tabName === 'google-ads' && !tabLoaded['google-ads']) { fetchGoogleAdsData(); }
}

// ─── GA4 ────────────────────────────────────────────────────────────────────

async function fetchGA4Data() {
    try {
        const data = await apiFetch('ga4');
        tabLoaded.ga4 = true;

        updateKPIValue('total-sessions', data.sessions.reduce((a, b) => a + b, 0));
        updateKPIValue('total-users', data.activeUsers.reduce((a, b) => a + b, 0));
        updateKPIValue('total-views', data.screenPageViews.reduce((a, b) => a + b, 0));
        updateKPIValue('total-events', data.eventCount.reduce((a, b) => a + b, 0));

        const labels = data.dates.map(formatDateString);
        renderGA4Chart(labels, data.sessions, data.activeUsers);
        renderEngagementChart(labels, data.screenPageViews, data.eventCount);
    } catch (error) {
        console.error("Failed fetching GA4 data:", error);
        showKPIError(['total-sessions', 'total-users', 'total-views', 'total-events']);
    }
}

// ─── GSC ────────────────────────────────────────────────────────────────────

async function fetchGSCData() {
    try {
        const data = await apiFetch('gsc');
        tabLoaded.gsc = true;

        updateKPIValue('total-clicks', data.clicks.reduce((a, b) => a + b, 0));
        updateKPIValue('total-impressions', data.impressions.reduce((a, b) => a + b, 0));

        let avgCtr = 0, avgPos = 0;
        if (data.ctr && data.ctr.length > 0) {
            avgCtr = (data.ctr.reduce((a, b) => a + b, 0) / data.ctr.length * 100).toFixed(2);
            avgPos = (data.position.reduce((a, b) => a + b, 0) / data.position.length).toFixed(1);
        }
        updateKPIValue('avg-ctr', avgCtr + "%");
        updateKPIValue('avg-position', avgPos);

        const labels = data.dates.map(formatDateString);
        renderGSCChart(labels, data.clicks, data.impressions);
    } catch (error) {
        console.error("Failed fetching GSC data:", error);
        showKPIError(['total-clicks', 'total-impressions', 'avg-ctr', 'avg-position']);
    }
}

// ─── YouTube ────────────────────────────────────────────────────────────────

async function fetchYouTubeData() {
    try {
        const response = await fetch(`${API_BASE_URL}/youtube`);
        if (response.status === 403) {
            const ytTab = document.getElementById('tab-youtube');
            if (ytTab) {
                ytTab.innerHTML = `
                    <div class="glass-panel" style="padding: 2rem; text-align: center;">
                        <h3 style="margin-bottom: 0.5rem;">YouTube Not Connected</h3>
                        <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1rem;">
                            The YouTube channel owner needs to authorize access once.
                        </p>
                        <a href="/admin/auth/youtube" style="display: inline-block; background: #FF0000; color: #fff; padding: 10px 24px; border-radius: 10px; text-decoration: none; font-weight: 500; font-size: 0.85rem;">
                            Authorize YouTube Access
                        </a>
                    </div>`;
            }
            return;
        }
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        tabLoaded.youtube = true;

        // KPIs — use Data API recent stats (always accurate)
        updateKPIValue('yt-total-views', data.recentViews);
        const watchHrs = data.analyticsAvailable
            ? (data.watchTimeMinutes.reduce((a, b) => a + b, 0) / 60).toFixed(1)
            : '—';
        updateKPIValue('yt-watch-time', watchHrs);
        updateKPIValue('yt-total-likes', data.recentLikes);
        updateKPIValue('yt-net-subs', data.totalSubscribers.toLocaleString());

        // Charts — use Analytics daily data if available, else show recent videos table
        if (data.analyticsAvailable && data.dates.length > 0) {
            const labels = data.dates.map(formatDateString);
            renderYTViewsChart(labels, data.dailyViews, data.watchTimeMinutes);
            renderYTSubsChart(labels, data.subscribersGained, data.subscribersLost);
        } else {
            // Analytics API has no data — render recent videos as a list instead
            renderYTVideosList(data.recentVideos || []);
        }
    } catch (error) {
        console.error("Failed fetching YouTube data:", error);
        showKPIError(['yt-total-views', 'yt-watch-time', 'yt-total-likes', 'yt-net-subs']);
    }
}

function renderYTVideosList(videos) {
    // Replace chart canvases with a recent videos table
    const chartsArea = document.querySelector('#tab-youtube .charts-grid');
    if (!chartsArea) return;

    if (videos.length === 0) {
        chartsArea.innerHTML = `<div class="glass-panel" style="grid-column: 1/-1; padding: 1.5rem;">
            <p style="color: var(--text-secondary); font-size: 0.85rem;">YouTube Analytics daily data is delayed. Channel stats above are live from the Data API.</p>
        </div>`;
        return;
    }

    let rows = videos.map(v => {
        const date = new Date(v.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<tr>
            <td style="padding: 6px 8px; font-size: 0.8rem; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${v.title}</td>
            <td style="padding: 6px 8px; font-size: 0.8rem; text-align: right;">${v.views.toLocaleString()}</td>
            <td style="padding: 6px 8px; font-size: 0.8rem; text-align: right;">${v.likes.toLocaleString()}</td>
            <td style="padding: 6px 8px; font-size: 0.8rem; text-align: right; color: var(--text-secondary);">${date}</td>
        </tr>`;
    }).join('');

    chartsArea.innerHTML = `<div class="glass-panel" style="grid-column: 1/-1; padding: 1rem;">
        <div class="chart-header"><h3>Recent Videos (Last 28 Days)</h3></div>
        <p style="color: var(--text-secondary); font-size: 0.75rem; margin-bottom: 0.75rem;">Daily chart data delayed by YouTube Analytics API. Per-video stats below are live.</p>
        <table style="width: 100%; border-collapse: collapse;">
            <thead><tr style="border-bottom: 1px solid var(--surface-border);">
                <th style="padding: 6px 8px; font-size: 0.75rem; text-align: left; color: var(--text-secondary);">VIDEO</th>
                <th style="padding: 6px 8px; font-size: 0.75rem; text-align: right; color: var(--text-secondary);">VIEWS</th>
                <th style="padding: 6px 8px; font-size: 0.75rem; text-align: right; color: var(--text-secondary);">LIKES</th>
                <th style="padding: 6px 8px; font-size: 0.75rem; text-align: right; color: var(--text-secondary);">DATE</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

// ─── LinkedIn ───────────────────────────────────────────────────────────────

async function fetchLinkedInData() {
    try {
        const data = await apiFetch('linkedin');
        tabLoaded.linkedin = true;
        updateKPIValue('li-followers', data.followerCount);
        updateKPIValue('li-posts', data.postCount);
        updateKPIValue('li-likes', data.totalLikes);
        updateKPIValue('li-reposts', data.totalReposts);
    } catch (error) {
        console.error("Failed fetching LinkedIn data:", error);
        showKPIError(['li-followers', 'li-posts', 'li-likes', 'li-reposts']);
    }
}

// ─── Social Media (Meta + Twitter) ──────────────────────────────────────────

async function fetchSocialData() {
    tabLoaded.social = true;

    // Facebook + Instagram
    try {
        const meta = await apiFetch('social/meta');
        const fb = meta.facebook || {};
        const ig = meta.instagram || {};
        updateKPIValue('fb-posts', fb.postCount ?? 0);
        updateKPIValue('fb-likes', fb.likes ?? 0);
        updateKPIValue('fb-impressions', fb.impressions ?? 0);
        updateKPIValue('fb-clicks', fb.clicks ?? 0);
        updateKPIValue('ig-followers', ig.followerCount ?? 0);
        updateKPIValue('ig-posts', ig.postCount ?? 0);
        updateKPIValue('ig-likes', ig.likes ?? 0);
        updateKPIValue('ig-impressions', ig.impressions ?? 0);
    } catch (error) {
        console.error("Failed fetching Meta data:", error);
        showKPIError(['fb-posts', 'fb-likes', 'fb-impressions', 'fb-clicks', 'ig-followers', 'ig-posts', 'ig-likes', 'ig-impressions']);
    }

    // Twitter/X
    try {
        const tw = await apiFetch('social/twitter');
        updateKPIValue('tw-posts', tw.postCount ?? 0);
        updateKPIValue('tw-impressions', tw.impressions ?? 0);
        updateKPIValue('tw-likes', tw.likes ?? 0);
        updateKPIValue('tw-clicks', tw.clicks ?? 0);
    } catch (error) {
        console.error("Failed fetching Twitter data:", error);
        showKPIError(['tw-posts', 'tw-impressions', 'tw-likes', 'tw-clicks']);
    }
}

// ─── Google Ads ──────────────────────────────────────────────────────────────

async function fetchGoogleAdsData() {
    tabLoaded['google-ads'] = true;
    try {
        const data = await apiFetch('google-ads');
        const el = document.getElementById('gads-status');
        if (el) el.textContent = data.message || 'Pending approval';
    } catch (error) {
        console.error("Failed fetching Google Ads data:", error);
        const el = document.getElementById('gads-status');
        if (el) el.textContent = 'Unavailable';
    }
}

// ─── Chart Renderers ────────────────────────────────────────────────────────

const chartTooltip = { backgroundColor: 'rgba(255,255,255,0.95)', titleColor: '#0f172a', bodyColor: '#475569', borderColor: 'rgba(0,0,0,0.1)', borderWidth: 1, padding: 10, usePointStyle: true };

function renderGA4Chart(labels, sessions, users) {
    const ctx = document.getElementById('ga4Chart').getContext('2d');
    if (ga4ChartInstance) ga4ChartInstance.destroy();
    const g = ctx.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, 'rgba(0, 86, 210, 0.2)');
    g.addColorStop(1, 'rgba(0, 86, 210, 0.0)');

    ga4ChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Sessions', data: sessions, borderColor: '#0056D2', backgroundColor: g, borderWidth: 2, fill: true, tension: 0.4, pointBackgroundColor: '#fff', pointBorderColor: '#0056D2', pointBorderWidth: 2, pointRadius: 3, pointHoverRadius: 5 },
                { label: 'Active Users', data: users, borderColor: '#1e293b', borderWidth: 1.5, borderDash: [5, 5], fill: false, tension: 0.4, pointBackgroundColor: '#fff', pointBorderColor: '#1e293b', pointRadius: 2 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } }, tooltip: chartTooltip }, scales: { y: { beginAtZero: true, border: { display: false } }, x: { grid: { display: false }, border: { display: false } } } }
    });
}

function renderEngagementChart(labels, views, events) {
    const ctx = document.getElementById('ga4EngagementChart').getContext('2d');
    if (ga4EngagementChartInstance) ga4EngagementChartInstance.destroy();

    ga4EngagementChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { type: 'line', label: 'Page Views', data: views, borderColor: '#1e293b', backgroundColor: '#1e293b', borderWidth: 1.5, tension: 0.3, yAxisID: 'y1' },
                { type: 'bar', label: 'Events', data: events, backgroundColor: 'rgba(0, 86, 210, 0.8)', borderRadius: 4, barPercentage: 0.6, yAxisID: 'y' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, font: { size: 11 } } } }, scales: { y: { type: 'linear', position: 'left', title: { display: true, text: 'Events', font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } }, y1: { type: 'linear', position: 'right', title: { display: true, text: 'Page Views', font: { size: 10 } }, grid: { display: false } }, x: { grid: { display: false } } } }
    });
}

function renderGSCChart(labels, clicks, impressions) {
    const ctx = document.getElementById('gscChart').getContext('2d');
    if (gscChartInstance) gscChartInstance.destroy();

    gscChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Clicks', data: clicks, borderColor: '#0056D2', backgroundColor: 'rgba(0, 86, 210, 0.1)', borderWidth: 2, fill: true, tension: 0.4, yAxisID: 'y', pointBackgroundColor: '#fff', pointBorderColor: '#0056D2' },
                { label: 'Impressions', data: impressions, borderColor: '#1e293b', borderWidth: 1.5, borderDash: [5, 5], fill: false, tension: 0.4, yAxisID: 'y1', pointBackgroundColor: '#fff', pointBorderColor: '#1e293b' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', align: 'end', labels: { font: { size: 11 } } }, tooltip: chartTooltip }, scales: { y: { type: 'linear', position: 'left', grid: { color: 'rgba(0,0,0,0.05)' }, title: { display: true, text: 'Clicks', font: { size: 10 } } }, y1: { type: 'linear', position: 'right', grid: { display: false }, title: { display: true, text: 'Impressions', font: { size: 10 } } }, x: { grid: { display: false } } } }
    });
}

function renderYTViewsChart(labels, views, watchTime) {
    const ctx = document.getElementById('ytViewsChart').getContext('2d');
    if (ytViewsChartInstance) ytViewsChartInstance.destroy();
    const g = ctx.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, 'rgba(255, 0, 0, 0.15)');
    g.addColorStop(1, 'rgba(255, 0, 0, 0.0)');

    ytViewsChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Views', data: views, borderColor: '#FF0000', backgroundColor: g, borderWidth: 2, fill: true, tension: 0.4, yAxisID: 'y', pointBackgroundColor: '#fff', pointBorderColor: '#FF0000', pointBorderWidth: 2, pointRadius: 2 },
                { label: 'Watch Time (min)', data: watchTime, borderColor: '#1e293b', borderWidth: 1.5, borderDash: [5, 5], fill: false, tension: 0.4, yAxisID: 'y1', pointRadius: 2 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } }, scales: { y: { type: 'linear', position: 'left', title: { display: true, text: 'Views', font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } }, y1: { type: 'linear', position: 'right', title: { display: true, text: 'Watch Time (min)', font: { size: 10 } }, grid: { display: false } }, x: { grid: { display: false } } } }
    });
}

function renderYTSubsChart(labels, gained, lost) {
    const ctx = document.getElementById('ytSubsChart').getContext('2d');
    if (ytSubsChartInstance) ytSubsChartInstance.destroy();

    ytSubsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Gained', data: gained, backgroundColor: 'rgba(34, 197, 94, 0.8)', borderRadius: 4, barPercentage: 0.6 },
                { label: 'Lost', data: lost.map(v => -v), backgroundColor: 'rgba(239, 68, 68, 0.8)', borderRadius: 4, barPercentage: 0.6 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, font: { size: 11 } } } }, scales: { y: { stacked: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { stacked: true, grid: { display: false } } } }
    });
}

// ─── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Bind tab clicks
    document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(link.dataset.tab);
        });
    });

    // Load GA4 tab by default
    setTimeout(() => fetchGA4Data(), 500);
});
