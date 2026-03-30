// ═══════════════════════════════════════════════════════════════
//  Marketing Dashboard — script.js
// ═══════════════════════════════════════════════════════════════

// ── Chart.js Defaults ──────────────────────────────────────────
Chart.defaults.color = '#64748b';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.scale.grid.color = '#f1f5f9';
Chart.defaults.scale.grid.borderColor = '#f1f5f9';

// ── State ──────────────────────────────────────────────────────
let currentOrg = 'ravenlabs';
let currentDays = 7;
let activeTab = 'ga4';

// Cache: key = `${tab}-${org}-${days}` (youtube ignores org/days)
const tabLoaded = {};

// Store original panel HTML so we can restore it when org changes
const panelOriginalHTML = {};

// ── Chart Instances ────────────────────────────────────────────
let ga4ChartInstance = null;
let ga4EngagementChartInstance = null;
let gscChartInstance = null;
let ytViewsChartInstance = null;
let ytSubsChartInstance = null;
let gadsChartInstance = null;

// ── Org Config ─────────────────────────────────────────────────
const ORG_CONFIG = {
  ravenlabs: { name: 'Raven Labs', supportedTabs: ['ga4', 'gsc', 'youtube', 'linkedin', 'social', 'twitter', 'google-ads'] },
  sdh:       { name: 'SDH',        supportedTabs: ['ga4', 'gsc', 'social'] },
  linkstone: { name: 'Linkstone',  supportedTabs: ['ga4', 'gsc', 'social'] },
};

// No tabs are always-visible — each org controls its own tab set
const ALWAYS_VISIBLE_TABS = [];

function updateTabBar(org) {
  const supported = ORG_CONFIG[org]?.supportedTabs || [];
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    const tab = btn.dataset.tab;
    if (ALWAYS_VISIBLE_TABS.includes(tab)) return; // always show
    btn.style.display = supported.includes(tab) ? '' : 'none';
  });

  // If active tab just got hidden, switch to first supported tab
  if (!supported.includes(activeTab) && !ALWAYS_VISIBLE_TABS.includes(activeTab)) {
    switchTab(supported[0] || 'ga4');
  }
}

// ── API ────────────────────────────────────────────────────────
const API = window.location.origin + '/api';

async function apiFetch(path) {
  const response = await fetch(`${API}/${path}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  
  const el = document.getElementById('last-synced');
  if (el) el.textContent = `Last synced: ${new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})}`;
  
  return response.json();
}

// ── Helpers ────────────────────────────────────────────────────
function formatDate(str) {
  if (!str || str.length !== 8) return str;
  const year = str.substring(0, 4);
  const month = parseInt(str.substring(4, 6), 10) - 1;
  const day = str.substring(6, 8);
  return new Date(year, month, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatNumber(n) {
  if (n == null || n === '') return '0';
  return Number(n).toLocaleString();
}

function updateKPI(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('loading-shimmer');
  el.textContent = typeof value === 'string' ? value : formatNumber(value);
  el.style.transform = 'scale(1.04)';
  requestAnimationFrame(() => {
    el.style.transition = 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    el.style.transform = 'scale(1)';
  });
}

function showKPIError(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('loading-shimmer');
      el.textContent = 'N/A';
    }
  });
}

function resetKPIShimmer(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = '--';
      el.classList.add('loading-shimmer');
    }
  });
}

// ── Not-Available State ────────────────────────────────────────
function showNotAvailable(tabId, message) {
  const panel = document.getElementById(tabId);
  if (!panel) return;
  // Store original HTML once
  if (!panelOriginalHTML[tabId]) {
    panelOriginalHTML[tabId] = panel.innerHTML;
  }
  const orgName = ORG_CONFIG[currentOrg]?.name || currentOrg;
  const msg = message || `${orgName} does not have access to this integration.`;
  panel.innerHTML = `
    <div class="not-available">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="8" y1="8" x2="16" y2="16"></line>
        <line x1="16" y1="8" x2="8" y2="16"></line>
      </svg>
      <h3>Not available for this organisation</h3>
      <p>${msg}</p>
    </div>`;
}

function restorePanel(tabId) {
  const panel = document.getElementById(tabId);
  if (!panel) return;
  if (panelOriginalHTML[tabId]) {
    panel.innerHTML = panelOriginalHTML[tabId];
  }
}

// ── Tab Switching ──────────────────────────────────────────────
function switchTab(name) {
  activeTab = name;

  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });

  // Update panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === 'tab-' + name);
  });

  // Sync date pills to currentDays for this panel
  syncDatePills(name);

  // Skip "coming soon" tabs
  if (name === 'twitter') {
    return;
  }

  // Check if org supports this tab
  const orgCfg = ORG_CONFIG[currentOrg];
  if (orgCfg && !orgCfg.supportedTabs.includes(name)) {
    showNotAvailable('tab-' + name);
    return;
  }

  // Build cache key (youtube doesn't use org/days)
  const cacheKey = name === 'youtube'
    ? `youtube-${currentOrg}`
    : `${name}-${currentOrg}-${currentDays}`;

  if (tabLoaded[cacheKey]) return;

  loadTab(name);
}

function loadTab(name) {
  if (name === 'ga4')       fetchGA4();
  else if (name === 'gsc')  fetchGSC();
  else if (name === 'youtube') fetchYouTube();
  else if (name === 'linkedin') fetchLinkedIn();
  else if (name === 'social')  fetchSocial();
  else if (name === 'google-ads') fetchGoogleAds();
}

// ── Sync date pills ────────────────────────────────────────────
function syncDatePills(tabName) {
  const panel = document.getElementById('tab-' + tabName);
  if (!panel) return;
  panel.querySelectorAll('.date-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.days, 10) === currentDays);
  });
}

// ── Org Switcher ───────────────────────────────────────────────
function handleOrgChange(newOrg) {
  if (newOrg === currentOrg) return;
  currentOrg = newOrg;

  // Invalidate all loaded state
  Object.keys(tabLoaded).forEach(k => delete tabLoaded[k]);

  // Reset social sub-tab to Facebook so the new org loads fresh from the start
  activeSocialPlatform = 'facebook';
  document.querySelectorAll('.social-nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.platform === 'facebook'));
  document.querySelectorAll('.social-platform-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'panel-facebook'));
  // Reset KPI shimmers so stale numbers don't persist while loading
  ['fb-page-followers','fb-impressions','fb-reach','fb-engagements','fb-page-views','fb-new-followers',
   'ig-followers','ig-following','ig-media-count','ig-impressions','ig-reach','ig-profile-views']
    .forEach(id => { const el = document.getElementById(id); if (el) { el.textContent = '--'; el.classList.add('loading-shimmer'); } });
  const fbList = document.getElementById('fb-posts-list'); if (fbList) fbList.innerHTML = '';
  const igList = document.getElementById('ig-media-list'); if (igList) igList.innerHTML = '';

  // Restore any panels that were replaced with "not available"
  ['tab-linkedin', 'tab-youtube', 'tab-social', 'tab-ga4', 'tab-gsc', 'tab-google-ads'].forEach(id => {
    if (panelOriginalHTML[id]) restorePanel(id);
  });

  // Show/hide tabs for this org (may also call switchTab if active tab is hidden)
  updateTabBar(newOrg);

  // If active tab is still valid, reload it
  const supported = ORG_CONFIG[currentOrg]?.supportedTabs || [];
  if (supported.includes(activeTab) || ALWAYS_VISIBLE_TABS.includes(activeTab)) {
    loadTab(activeTab);
  }
}

// ── Date Filter ────────────────────────────────────────────────
// Handled via event delegation on .content-area
function handleDateBtn(btn) {
  const newDays = parseInt(btn.dataset.days, 10);
  if (newDays === currentDays) return;
  currentDays = newDays;

  // Update pills only in the active panel
  syncDatePills(activeTab);

  // Invalidate cache for tabs that use days
  Object.keys(tabLoaded).forEach(k => {
    if (k !== 'youtube') delete tabLoaded[k];
  });

  // Reload current tab if it's one that uses days
  if (activeTab !== 'youtube' && activeTab !== 'linkedin' && activeTab !== 'social' && activeTab !== 'twitter') {
    loadTab(activeTab);
  }
}

// ── Refresh Buttons ────────────────────────────────────────────
function handleRefresh(btn) {
  const tabName = btn.dataset.refresh;
  if (!tabName) return;

  btn.classList.add('spinning');
  setTimeout(() => btn.classList.remove('spinning'), 800);

  // Force re-fetch by clearing cache for this tab
  Object.keys(tabLoaded).forEach(k => {
    if (k.startsWith(tabName + '-')) delete tabLoaded[k];
  });

  loadTab(tabName);
}

// ── GA4 ────────────────────────────────────────────────────────
async function fetchGA4() {
  const cacheKey = `ga4-${currentOrg}-${currentDays}`;
  resetKPIShimmer(['total-sessions', 'total-users', 'total-views', 'total-events']);
  try {
    const data = await apiFetch(`ga4?org=${currentOrg}&days=${currentDays}`);
    tabLoaded[cacheKey] = true;

    updateKPI('total-sessions', data.sessions.reduce((a, b) => a + b, 0));
    updateKPI('total-users',   data.activeUsers.reduce((a, b) => a + b, 0));
    updateKPI('total-views',   data.screenPageViews.reduce((a, b) => a + b, 0));
    updateKPI('total-events',  data.eventCount.reduce((a, b) => a + b, 0));

    const labels = data.dates.map(formatDate);
    renderGA4Chart(labels, data.sessions, data.activeUsers);
    renderEngagementChart(labels, data.screenPageViews, data.eventCount);
  } catch (err) {
    console.error('GA4 fetch failed:', err);
    showKPIError(['total-sessions', 'total-users', 'total-views', 'total-events']);
  }
}

// ── GSC ────────────────────────────────────────────────────────
async function fetchGSC() {
  const cacheKey = `gsc-${currentOrg}-${currentDays}`;
  resetKPIShimmer(['total-clicks', 'total-impressions', 'avg-ctr', 'avg-position']);
  try {
    const data = await apiFetch(`gsc?org=${currentOrg}&days=${currentDays}`);
    tabLoaded[cacheKey] = true;

    updateKPI('total-clicks',      data.clicks.reduce((a, b) => a + b, 0));
    updateKPI('total-impressions', data.impressions.reduce((a, b) => a + b, 0));

    let avgCtr = '0%', avgPos = '0';
    if (data.ctr && data.ctr.length > 0) {
      avgCtr = (data.ctr.reduce((a, b) => a + b, 0) / data.ctr.length * 100).toFixed(2) + '%';
      avgPos = (data.position.reduce((a, b) => a + b, 0) / data.position.length).toFixed(1);
    }
    updateKPI('avg-ctr',      avgCtr);
    updateKPI('avg-position', avgPos);

    const labels = data.dates.map(formatDate);
    renderGSCChart(labels, data.clicks, data.impressions);
  } catch (err) {
    console.error('GSC fetch failed:', err);
    showKPIError(['total-clicks', 'total-impressions', 'avg-ctr', 'avg-position']);
  }
}

// ── YouTube ────────────────────────────────────────────────────
// YouTube channel is RavenLabs only
async function fetchYouTube() {
  const cacheKey = `youtube-${currentOrg}`;

  if (currentOrg !== 'ravenlabs') {
    showNotAvailable('tab-youtube', 'The YouTube channel is only connected for Raven Labs.');
    return;
  }

  resetKPIShimmer(['yt-total-views', 'yt-watch-time', 'yt-total-likes', 'yt-net-subs']);

  try {
    const response = await fetch(`${API}/youtube`);

    if (response.status === 403) {
      const panel = document.getElementById('tab-youtube');
      if (!panelOriginalHTML['tab-youtube']) {
        panelOriginalHTML['tab-youtube'] = panel.innerHTML;
      }
      panel.innerHTML = `
        <div class="yt-auth-panel">
          <h3>YouTube Not Connected</h3>
          <p>The YouTube channel owner needs to authorise access once.</p>
          <a href="/admin/auth/youtube" class="yt-auth-btn">Authorise YouTube Access</a>
        </div>`;
      return;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    tabLoaded[cacheKey] = true;

    updateKPI('yt-total-views', data.recentViews);

    const watchHrs = (data.analyticsAvailable && data.watchTimeMinutes && data.watchTimeMinutes.length > 0)
      ? (data.watchTimeMinutes.reduce((a, b) => a + b, 0) / 60).toFixed(1)
      : '—';
    updateKPI('yt-watch-time', watchHrs);
    updateKPI('yt-total-likes', data.recentLikes);
    updateKPI('yt-net-subs', data.totalSubscribers);

    if (data.analyticsAvailable && data.dates && data.dates.length > 0) {
      const labels = data.dates.map(formatDate);
      renderYTViewsChart(labels, data.dailyViews, data.watchTimeMinutes);
      renderYTSubsChart(labels, data.subscribersGained, data.subscribersLost);
    } else {
      renderYTVideosList(data.recentVideos || []);
    }
  } catch (err) {
    console.error('YouTube fetch failed:', err);
    showKPIError(['yt-total-views', 'yt-watch-time', 'yt-total-likes', 'yt-net-subs']);
  }
}

function renderYTVideosList(videos) {
  const chartsGrid = document.querySelector('#tab-youtube .charts-grid');
  if (!chartsGrid) return;

  if (!videos || videos.length === 0) {
    chartsGrid.innerHTML = `
      <div class="video-table-card">
        <p style="color:#94a3b8;font-size:0.82rem;">YouTube Analytics daily data is delayed. Channel stats above are live from the Data API.</p>
      </div>`;
    return;
  }

  const rows = videos.map(v => {
    const date = new Date(v.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `<tr>
      <td class="video-title">${v.title}</td>
      <td class="right">${formatNumber(v.views)}</td>
      <td class="right">${formatNumber(v.likes)}</td>
      <td class="right" style="color:#94a3b8;">${date}</td>
    </tr>`;
  }).join('');

  chartsGrid.innerHTML = `
    <div class="video-table-card">
      <div class="chart-title">Recent Videos — Last 28 Days</div>
      <p style="color:#94a3b8;font-size:0.75rem;margin-bottom:0.75rem;">Daily chart data is delayed by the YouTube Analytics API. Per-video stats below are live.</p>
      <table class="video-table">
        <thead>
          <tr>
            <th>Video</th>
            <th class="right">Views</th>
            <th class="right">Likes</th>
            <th class="right">Date</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── LinkedIn ───────────────────────────────────────────────────
async function fetchLinkedIn() {
  const cacheKey = `linkedin-${currentOrg}-${currentDays}`;

  if (currentOrg !== 'ravenlabs') {
    showNotAvailable('tab-linkedin', 'LinkedIn integration is only available for Raven Labs.');
    return;
  }

  resetKPIShimmer(['li-followers', 'li-posts', 'li-likes', 'li-reposts']);

  try {
    const data = await apiFetch(`linkedin?org=${currentOrg}`);
    tabLoaded[cacheKey] = true;

    updateKPI('li-followers', data.followerCount);
    updateKPI('li-posts',     data.postCount);
    updateKPI('li-likes',     data.totalLikes);
    updateKPI('li-reposts',   data.totalReposts);
  } catch (err) {
    console.error('LinkedIn fetch failed:', err);
    showKPIError(['li-followers', 'li-posts', 'li-likes', 'li-reposts']);
  }
}

// ── Social ─────────────────────────────────────────────────────
let fbChartInstance  = null;
let igChartInstance  = null;
let activeSocialPlatform  = 'facebook';
let socialNavReady    = false;   // attach listeners only once

function initSocialNav() {
  if (socialNavReady) return;
  socialNavReady = true;
  document.querySelectorAll('.social-nav-btn[data-platform]').forEach(btn => {
    btn.addEventListener('click', () => {
      const platform = btn.dataset.platform;
      if (platform === activeSocialPlatform) return;
      activeSocialPlatform = platform;
      document.querySelectorAll('.social-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.social-platform-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`panel-${platform}`)?.classList.add('active');
      // Only fetch if not already cached for this org+days
      if (platform === 'facebook') fetchFacebook();
      else fetchInstagram();
    });
  });
}

// Called when the Social top-tab is opened
async function fetchSocial() {
  initSocialNav();
  // Only load the currently-active platform sub-tab
  if (activeSocialPlatform === 'facebook') fetchFacebook();
  else fetchInstagram();
}

async function fetchFacebook() {
  const cacheKey = `social-facebook-${currentOrg}-${currentDays}`;
  if (tabLoaded[cacheKey]) return;   // already rendered for this org+days

  if (currentOrg === 'linkstone') {
    const panel = document.getElementById('panel-facebook');
    if (panel) panel.innerHTML = `<div class="not-available" style="padding:3rem 1rem;text-align:center;"><p style="color:#94a3b8;font-size:0.85rem;">Facebook is not connected for Linkstone.</p></div>`;
    tabLoaded[cacheKey] = true;
    return;
  }

  const fbKPIs = ['fb-page-followers','fb-impressions','fb-reach','fb-engagements','fb-page-views','fb-new-followers'];
  resetKPIShimmer(fbKPIs);

  try {
    const data = await apiFetch(`social/facebook?org=${currentOrg}&days=${currentDays}`);

    if (data.error) {
      showKPIError(fbKPIs);
      console.warn('Facebook error:', data.error);
      return;
    }

    const page    = data.page    || {};
    const summary = data.summary || {};
    const daily   = data.daily   || {};

    updateKPI('fb-page-followers', page.followers         ?? 0);
    updateKPI('fb-impressions',    summary.impressions     ?? 0);
    updateKPI('fb-reach',          summary.reach           ?? 0);
    updateKPI('fb-engagements',    summary.engagements     ?? 0);
    updateKPI('fb-page-views',     summary.page_views      ?? 0);
    updateKPI('fb-new-followers',  summary.new_followers   ?? 0);

    renderSocialChart('fbChart', fbChartInstance, daily, '#1877F2', '#e2efff',
      ins => { fbChartInstance = ins; });
    renderPostsList('fb-posts-list', data.posts || [], 'facebook');

    tabLoaded[cacheKey] = true;

  } catch (err) {
    console.error('Facebook fetch failed:', err);
    showKPIError(fbKPIs);
  }
}

async function fetchInstagram() {
  const cacheKey = `social-instagram-${currentOrg}-${currentDays}`;
  if (tabLoaded[cacheKey]) return;   // already rendered for this org+days

  const igKPIs = ['ig-followers','ig-following','ig-media-count','ig-impressions','ig-reach','ig-profile-views'];
  resetKPIShimmer(igKPIs);

  try {
    const data = await apiFetch(`social/instagram?org=${currentOrg}&days=${currentDays}`);

    if (data.error) {
      showKPIError(igKPIs);
      console.warn('Instagram error:', data.error);
      return;
    }

    const account = data.account || {};
    const summary = data.summary || {};
    const daily   = data.daily   || {};

    updateKPI('ig-followers',     account.followers    ?? 0);
    updateKPI('ig-following',     account.following    ?? 0);
    updateKPI('ig-media-count',   account.media_count  ?? 0);
    updateKPI('ig-impressions',   summary.impressions  ?? 0);
    updateKPI('ig-reach',         summary.reach        ?? 0);
    updateKPI('ig-profile-views', summary.profile_views ?? 0);

    renderSocialChart('igChart', igChartInstance, daily, '#e1306c', '#fce4ec',
      ins => { igChartInstance = ins; });
    renderPostsList('ig-media-list', data.media || [], 'instagram');

    tabLoaded[cacheKey] = true;

  } catch (err) {
    console.error('Instagram fetch failed:', err);
    showKPIError(igKPIs);
  }
}

function renderSocialChart(canvasId, existingInstance, daily, color, fillColor, setInstance) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (existingInstance) existingInstance.destroy();
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 240);
  grad.addColorStop(0, fillColor);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  const labels = (daily.dates || []).map(d => {
    if (d.length === 6) return d.slice(2,4) + '/' + d.slice(4,6);
    return d;
  });
  setInstance(new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Impressions',
          data: daily.impressions || [],
          borderColor: color,
          backgroundColor: grad,
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.35,
          fill: true,
        },
        {
          label: 'Reach',
          data: daily.reach || [],
          borderColor: '#94a3b8',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          pointRadius: 2,
          tension: 0.35,
          borderDash: [4, 3],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
      },
    },
  }));
}

function renderPostsList(containerId, items, platform) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<p style="color:#94a3b8;font-size:0.82rem;padding:1rem 0;">No recent posts found.</p>';
    return;
  }
  el.innerHTML = items.map(item => {
    const date     = platform === 'instagram' ? (item.timestamp || '') : (item.created_time || '');
    const text     = platform === 'instagram' ? (item.caption || '') : (item.message || '');
    const likes    = platform === 'instagram' ? item.like_count : item.likes;
    const comments = platform === 'instagram' ? item.comments_count : item.comments;
    const extra    = platform === 'facebook'
      ? `<span class="post-stat"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>${item.shares ?? 0} shares</span>`
      : `<span class="post-stat">${item.media_type || ''}</span>`;
    return `
      <div class="post-row">
        ${item.thumbnail ? `<img class="post-thumb" src="${item.thumbnail}" alt="" onerror="this.style.display='none'">` : '<div class="post-thumb post-thumb-empty"></div>'}
        <div class="post-body">
          <p class="post-text">${text || '<em style="color:#94a3b8">No caption</em>'}</p>
          <div class="post-meta">
            <span class="post-date">${date}</span>
            <span class="post-stat"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>${likes ?? 0}</span>
            <span class="post-stat"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>${comments ?? 0}</span>
            ${extra}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Google Ads ───────────────────────────────────────────────────
async function fetchGoogleAds() {
  const cacheKey = `google-ads-${currentOrg}-${currentDays}`;

  if (currentOrg !== 'ravenlabs') {
    showNotAvailable('tab-google-ads', 'Google Ads integration is only connected for Raven Labs.');
    return;
  }

  resetKPIShimmer(['gads-clicks', 'gads-impressions', 'gads-cost', 'gads-conversions']);

  try {
    const data = await apiFetch(`google-ads?org=${currentOrg}&days=${currentDays}`);
    if (data.error) {
      const panel = document.getElementById('tab-google-ads');
      if (!panelOriginalHTML['tab-google-ads']) {
        panelOriginalHTML['tab-google-ads'] = panel.innerHTML;
      }
      const isAuthError = data.error.includes('credentials not completely configured');
      panel.innerHTML = `
        <div class="yt-auth-panel" style="margin-top:2rem;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#EA4335" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:1rem;"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg>
          <h3>${isAuthError ? 'Google Ads Not Connected' : 'Google Ads Error'}</h3>
          <p style="max-width:480px;color:#64748b;font-size:0.85rem;">${isAuthError ? 'You need to authorise access once to fetch live data.' : data.error}</p>
          ${isAuthError ? '<a href="/admin/auth/google-ads" class="yt-auth-btn" style="background:#202124;">Authorise Google Ads</a>' : ''}
        </div>`;
      return;
    }

    tabLoaded[cacheKey] = true;

    updateKPI('gads-clicks', data.clicks.reduce((a, b) => a + b, 0));
    updateKPI('gads-impressions', data.impressions.reduce((a, b) => a + b, 0));
    updateKPI('gads-cost', '$' + data.cost.reduce((a, b) => a + b, 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}));
    updateKPI('gads-conversions', data.conversions.reduce((a, b) => a + b, 0).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}));

    const labels = data.dates.map(formatDate);
    renderGadsChart(labels, data.clicks, data.conversions);

  } catch (err) {
    console.error('Google Ads fetch failed:', err);
    showKPIError(['gads-clicks', 'gads-impressions', 'gads-cost', 'gads-conversions']);
  }
}

function renderGadsChart(labels, clicks, conversions) {
  const canvas = document.getElementById('gadsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (gadsChartInstance) gadsChartInstance.destroy();

  const grad = ctx.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0, 'rgba(66, 133, 244, 0.15)');
  grad.addColorStop(1, 'rgba(66, 133, 244, 0.0)');

  gadsChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Clicks',
          data: clicks,
          borderColor: '#4285F4',
          backgroundColor: grad,
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          yAxisID: 'y',
          pointBackgroundColor: '#fff',
          pointBorderColor: '#4285F4',
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: 'Conversions',
          data: conversions,
          borderColor: '#34A853',
          borderWidth: 1.5,
          borderDash: [5, 4],
          fill: false,
          tension: 0.4,
          yAxisID: 'y1',
          pointBackgroundColor: '#fff',
          pointBorderColor: '#34A853',
          pointRadius: 2,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } },
        tooltip: chartTooltip,
      },
      scales: {
        y:  { type: 'linear', position: 'left',  beginAtZero: true, border: { display: false }, title: { display: true, text: 'Clicks', font: { size: 10 } } },
        y1: { type: 'linear', position: 'right', beginAtZero: true, border: { display: false }, grid: { display: false }, title: { display: true, text: 'Conversions', font: { size: 10 } } },
        x:  { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

// ── Chart Tooltip Config ───────────────────────────────────────
const chartTooltip = {
  backgroundColor: 'rgba(255,255,255,0.97)',
  titleColor: '#0f172a',
  bodyColor: '#475569',
  borderColor: '#e2e8f0',
  borderWidth: 1,
  padding: 10,
  usePointStyle: true,
  boxPadding: 4,
};

// ── Render GA4 Chart ───────────────────────────────────────────
function renderGA4Chart(labels, sessions, users) {
  const canvas = document.getElementById('ga4Chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (ga4ChartInstance) ga4ChartInstance.destroy();

  const grad = ctx.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0, 'rgba(37,99,235,0.15)');
  grad.addColorStop(1, 'rgba(37,99,235,0.0)');

  ga4ChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Sessions',
          data: sessions,
          borderColor: '#2563eb',
          backgroundColor: grad,
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#2563eb',
          pointBorderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: 'Active Users',
          data: users,
          borderColor: '#94a3b8',
          borderWidth: 1.5,
          borderDash: [5, 4],
          fill: false,
          tension: 0.4,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#94a3b8',
          pointRadius: 2,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } },
        tooltip: chartTooltip,
      },
      scales: {
        y: { beginAtZero: true, border: { display: false }, ticks: { font: { size: 10 } } },
        x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

// ── Render GA4 Engagement Chart ────────────────────────────────
function renderEngagementChart(labels, views, events) {
  const canvas = document.getElementById('ga4EngagementChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (ga4EngagementChartInstance) ga4EngagementChartInstance.destroy();

  ga4EngagementChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: 'Page Views',
          data: views,
          borderColor: '#94a3b8',
          backgroundColor: '#94a3b8',
          borderWidth: 1.5,
          tension: 0.3,
          yAxisID: 'y1',
          pointRadius: 2,
          pointHoverRadius: 4,
        },
        {
          type: 'bar',
          label: 'Events',
          data: events,
          backgroundColor: 'rgba(37,99,235,0.75)',
          borderRadius: 4,
          barPercentage: 0.6,
          yAxisID: 'y',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, font: { size: 11 } } },
        tooltip: chartTooltip,
      },
      scales: {
        y:  { type: 'linear', position: 'left',  beginAtZero: true, border: { display: false }, title: { display: true, text: 'Events', font: { size: 10 } } },
        y1: { type: 'linear', position: 'right', beginAtZero: true, border: { display: false }, grid: { display: false }, title: { display: true, text: 'Page Views', font: { size: 10 } } },
        x:  { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

// ── Render GSC Chart ───────────────────────────────────────────
function renderGSCChart(labels, clicks, impressions) {
  const canvas = document.getElementById('gscChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (gscChartInstance) gscChartInstance.destroy();

  const grad = ctx.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0, 'rgba(37,99,235,0.12)');
  grad.addColorStop(1, 'rgba(37,99,235,0.0)');

  gscChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Clicks',
          data: clicks,
          borderColor: '#2563eb',
          backgroundColor: grad,
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          yAxisID: 'y',
          pointBackgroundColor: '#fff',
          pointBorderColor: '#2563eb',
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: 'Impressions',
          data: impressions,
          borderColor: '#94a3b8',
          borderWidth: 1.5,
          borderDash: [5, 4],
          fill: false,
          tension: 0.4,
          yAxisID: 'y1',
          pointBackgroundColor: '#fff',
          pointBorderColor: '#94a3b8',
          pointRadius: 2,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } },
        tooltip: chartTooltip,
      },
      scales: {
        y:  { type: 'linear', position: 'left',  beginAtZero: true, border: { display: false }, title: { display: true, text: 'Clicks', font: { size: 10 } } },
        y1: { type: 'linear', position: 'right', beginAtZero: true, border: { display: false }, grid: { display: false }, title: { display: true, text: 'Impressions', font: { size: 10 } } },
        x:  { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

// ── Render YouTube Views Chart ─────────────────────────────────
function renderYTViewsChart(labels, views, watchTime) {
  const canvas = document.getElementById('ytViewsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (ytViewsChartInstance) ytViewsChartInstance.destroy();

  const grad = ctx.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0, 'rgba(37,99,235,0.15)');
  grad.addColorStop(1, 'rgba(37,99,235,0.0)');

  ytViewsChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Views',
          data: views,
          borderColor: '#2563eb',
          backgroundColor: grad,
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          yAxisID: 'y',
          pointBackgroundColor: '#fff',
          pointBorderColor: '#2563eb',
          pointBorderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5,
        },
        {
          label: 'Watch Time (min)',
          data: watchTime,
          borderColor: '#94a3b8',
          borderWidth: 1.5,
          borderDash: [5, 4],
          fill: false,
          tension: 0.4,
          yAxisID: 'y1',
          pointRadius: 2,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } },
        tooltip: chartTooltip,
      },
      scales: {
        y:  { type: 'linear', position: 'left',  beginAtZero: true, border: { display: false }, title: { display: true, text: 'Views', font: { size: 10 } } },
        y1: { type: 'linear', position: 'right', beginAtZero: true, border: { display: false }, grid: { display: false }, title: { display: true, text: 'Watch Time (min)', font: { size: 10 } } },
        x:  { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

// ── Render YouTube Subscribers Chart ───────────────────────────
function renderYTSubsChart(labels, gained, lost) {
  const canvas = document.getElementById('ytSubsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (ytSubsChartInstance) ytSubsChartInstance.destroy();

  ytSubsChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Gained',
          data: gained,
          backgroundColor: 'rgba(34,197,94,0.75)',
          borderRadius: 4,
          barPercentage: 0.6,
        },
        {
          label: 'Lost',
          data: (lost || []).map(v => -Math.abs(v)),
          backgroundColor: 'rgba(239,68,68,0.75)',
          borderRadius: 4,
          barPercentage: 0.6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, font: { size: 11 } } },
        tooltip: chartTooltip,
      },
      scales: {
        y: { stacked: true, beginAtZero: true, border: { display: false }, ticks: { font: { size: 10 } } },
        x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Set header date
  const dateEl = document.getElementById('header-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Bind tab buttons
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Bind org switcher (pill buttons)
  document.querySelectorAll('.org-btn[data-org]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.org-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      handleOrgChange(btn.dataset.org);
    });
  });

  // Event delegation: date buttons and refresh buttons inside .content-area
  const contentArea = document.querySelector('.content-area');
  if (contentArea) {
    contentArea.addEventListener('click', e => {
      const dateBtn = e.target.closest('.date-btn');
      if (dateBtn) {
        handleDateBtn(dateBtn);
        return;
      }
      const refreshBtn = e.target.closest('.refresh-btn');
      if (refreshBtn) {
        handleRefresh(refreshBtn);
      }
    });
  }

  // Apply tab visibility for default org on load
  updateTabBar(currentOrg);

  // Load GA4 by default
  switchTab('ga4');
});
