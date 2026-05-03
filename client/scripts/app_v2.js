/**
 * civik.link — Main Application
 * SPA router + page renderers + accessibility engine
 * All data comes from DataService — nothing hardcoded here
 *
 * AI: calls /api/chat (Vercel serverless) — Groq key never in browser
 * SOS: Option C — WhatsApp blast + phone dialer to primary contact
 */

import CONFIG from './config.js';
import DataService from './dataService.js';
import AuthService from './authService.js';

// Redirect to localhost if using 127.0.0.1 (fixes Firebase auth error)
if (window.location.hostname === '127.0.0.1') {
  window.location.hostname = 'localhost';
}

// ── FORCE RESET: Get rid of Ramesh automatically ─────────────────────────────
if (localStorage.getItem('civik_user_profile')?.includes("Ramesh Sharma")) {
  console.log("[App] Force clearing Ramesh mock data...");
  localStorage.clear();
}


// ── App State ──────────────────────────────────────────────────────────────────

const State = {
  user:          null,
  health:        null,
  schemes:       null,
  notifications: null,
  currentPage:   CONFIG.DEFAULT_PAGE,
  ttsEnabled:    CONFIG.DEFAULT_TTS_ENABLED,
  highContrast:  CONFIG.DEFAULT_HIGH_CONTRAST,
  fontSize:      CONFIG.DEFAULT_FONT_SIZE,
  chatHistory:   [],
};

// ── Boot ───────────────────────────────────────────────────────────────────────

async function boot() {
  console.log("[App] Booting...");

  // STEP 1: If no valid auth cookie → show login screen immediately, done.
  if (!(await AuthService.isAuthenticated())) {
    console.log("[App] Not authenticated → login screen");
    try { await loadMockFallback(); } catch(e) {}
    renderLanding();
    return;
  }

  // STEP 2: Has auth cookie — load data then show dashboard
  try {
    // Load mock data as fallback first
    await loadMockFallback();

    // Try to fetch real data from server (non-blocking — any failure = use mock)
    try {
      const pRes = await fetch('/api/profile', { credentials: 'same-origin' });

      if (pRes.status === 401) {
        // Server says token is bad → clear it → show login
        console.warn("[App] Token rejected by server → forcing login");
        AuthService.logout();
        return;
      }

      if (pRes.ok) {
        const d = await pRes.json();
        if (d.profile) State.user = { ...State.user, ...d.profile };
      }

      const hRes = await fetch('/api/health-data', { credentials: 'same-origin' });
      if (hRes.ok) {
        const d = await hRes.json();
        if (d.health) State.health = d.health;
      }
    } catch (e) {
      console.warn("[App] Server unreachable, using mock data:", e.message);
    }

    // Apply preferences
    const prefs = State.user?.preferences || {};
    applyFontSize(prefs.font_size || CONFIG.DEFAULT_FONT_SIZE);
    applyHighContrast(prefs.high_contrast || false);
    State.ttsEnabled = prefs.tts_enabled || false;

    if (!State.user?.profile_completed) {
      renderOnboarding();
      return;
    }

    // STEP 3: Show dashboard after the required profile exists
    initUI();

  } catch (err) {
    console.error("[App] Boot Error:", err.message);
    const root = document.getElementById('page-root');
    if (root) root.innerHTML = `<div style="padding:2rem;color:red;"><b>Error:</b> ${h(err.message)}</div>`;
  }
}

// Loads mock/local data into State as baseline fallback
async function loadMockFallback() {
  const [mockUser, mockHealth, schemes, notifications] = await Promise.all([
    DataService.getUserProfile(),
    DataService.getHealthData(),
    DataService.getSchemes(),
    DataService.getNotifications(),
  ]);
  State.user          = mockUser          || { name: 'Citizen', preferences: {} };
  State.health        = mockHealth        || { vitals: {}, medications: [], appointments: [] };
  State.schemes       = schemes           || { schemes: [], categories: [] };
  State.notifications = notifications     || { notifications: [] };
  State.fontSize      = CONFIG.DEFAULT_FONT_SIZE;
  State.highContrast  = false;
  State.ttsEnabled    = false;
}


function initUI() {
  buildNav();
  buildSidebarUser();
  buildHeader();
  buildNotificationBadge();
  initAccessibilityControls();
  initMobileMenu();

  navigateTo(CONFIG.DEFAULT_PAGE);
}

// ── Navigation Builder ─────────────────────────────────────────────────────────

function buildNav() {
  const navList = document.getElementById('nav-list');
  navList.innerHTML = CONFIG.PAGES.map(page => `
    <li role="none">
      <button
        class="nav-link${page.id === 'sos' ? ' sos-link' : ''}"
        data-page="${page.id}"
        aria-label="${page.ariaLabel}"
        aria-current="${page.id === State.currentPage ? 'page' : 'false'}"
        role="menuitem"
        type="button"
      >
        <span class="material-symbols-rounded" aria-hidden="true">${page.icon}</span>
        <span>${page.label}</span>
      </button>
    </li>
  `).join('');

  navList.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
}

function buildSidebarUser() {
  if (!State.user) return;
  const nameEl   = document.getElementById('sidebar-user-name');
  const idEl     = document.getElementById('sidebar-user-id');
  const avatarEl = document.getElementById('user-avatar');
  
  if (nameEl)   nameEl.textContent = State.user.name;
  
  // UDID badge — copyable on click
  if (idEl) {
    const udid = State.user.udid;
    if (udid) {
      idEl.innerHTML = `
        <span id="udid-badge" title="Click to copy UDID"
          style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;
                 background:var(--clr-primary-light);color:var(--clr-primary);
                 font-size:0.65rem;font-weight:700;letter-spacing:0.04em;
                 padding:2px 7px;border-radius:99px;
                 border:1px solid var(--clr-primary);font-family:monospace;
                 transition:opacity 0.15s;">
          <span class="material-symbols-rounded" style="font-size:0.75rem;">fingerprint</span>
          ${h(udid)}
        </span>`;
      document.getElementById('udid-badge')?.addEventListener('click', () => window._copyUDID(udid));
    } else {
      idEl.textContent = 'UDID: Generating…';
    }
  }

  window._copyUDID = (udid) => {
    navigator.clipboard?.writeText(udid).then(() => {
      const badge = document.getElementById('udid-badge');
      if (badge) {
        const orig = badge.innerHTML;
        badge.innerHTML = '<span class="material-symbols-rounded" style="font-size:0.75rem;">check</span> Copied!';
        badge.style.opacity = '0.7';
        setTimeout(() => { badge.innerHTML = orig; badge.style.opacity = '1'; }, 1500);
      }
    });
  };
  
  if (avatarEl) {
    const photoUrl = safeImageUrl(State.user.profile_photo);
    if (photoUrl) {
      avatarEl.innerHTML = `<img src="${h(photoUrl)}" alt="profile" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
    } else {
      avatarEl.textContent = State.user.name?.charAt(0)?.toUpperCase() || 'U';
    }
  }

  // ── Logout Button ──
  const logoutContainer = document.querySelector('.sidebar-footer');
  if (logoutContainer && !document.getElementById('sidebar-logout-container')) {
    const logoutBtn = document.createElement('div');
    logoutBtn.id = 'sidebar-logout-container';
    logoutBtn.innerHTML = `
      <button id="btn-logout" class="btn btn-ghost" style="width:100%; justify-content:flex-start; color:var(--clr-danger); margin-top: 1rem; border-top: 1px solid var(--clr-border-light); padding-top: 1rem;">
        <span class="material-symbols-rounded">logout</span>
        <span>Logout &amp; Reset</span>
      </button>
    `;
    logoutContainer.appendChild(logoutBtn);
    
    document.getElementById('btn-logout').onclick = () => {
      if (confirm("Logout and clear all local data?")) {
        AuthService.logout();
        localStorage.clear();
        window.location.reload();
      }
    };
  }
}

function buildHeader() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const greetEl = document.getElementById('header-greeting');
  const dateEl  = document.getElementById('header-date');
  if (greetEl) greetEl.textContent = `${greeting}, ${State.user?.name?.split(' ')[0] || ''}`;
  if (dateEl)  dateEl.textContent  = now.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

function buildNotificationBadge() {
  const unread = State.notifications?.notifications?.filter(n => !n.read)?.length || 0;
  const badge = document.getElementById('notif-badge');
  const btn   = document.getElementById('btn-notifications');
  if (badge) badge.style.display = unread > 0 ? 'block' : 'none';
  if (btn)   btn.setAttribute('aria-label', `Notifications — ${unread} unread`);
}

// ── Router ─────────────────────────────────────────────────────────────────────

const PAGE_RENDERERS = {
  dashboard: renderDashboard,
  health:    renderHealth,
  schemes:   renderSchemes,
  sos:       renderSOS,
  assistant: renderAssistant,
  caregiver: renderCaregiver,
};

function navigateTo(pageId) {
  if (!PAGE_RENDERERS[pageId]) return;

  State.currentPage = pageId;

  // Update nav active state + ARIA
  document.querySelectorAll('.nav-link').forEach(btn => {
    const isActive = btn.dataset.page === pageId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  // Animate out → render → animate in
  const root = document.getElementById('page-root');
  root.style.opacity   = '0';
  root.style.transform = 'translateY(12px)';

  setTimeout(() => {
    root.innerHTML = '';
    const pageEl = document.createElement('div');
    pageEl.className = 'page-content';
    root.appendChild(pageEl);

    // Always restore opacity — even if renderer throws
    try {
      PAGE_RENDERERS[pageId](pageEl);
    } catch (err) {
      console.error(`[navigateTo] Renderer "${pageId}" threw:`, err);
      pageEl.innerHTML = `<div style="padding:2rem;color:red;font-family:monospace;">
        <b>Page Error (${h(pageId)}):</b><br>${h(err.message)}
        <br><br><small>Check console for details.</small>
      </div>`;
    }

    root.style.transition = 'all 0.28s ease';
    root.style.opacity    = '1';
    root.style.transform  = 'translateY(0)';

    const pageConfig = CONFIG.PAGES.find(p => p.id === pageId);
    document.title = `${pageConfig?.label || pageId} — ${CONFIG.APP_NAME}`;
    announce(`Navigated to ${pageConfig?.label || pageId}`);

    if (State.ttsEnabled && pageId === 'dashboard') {
      const score = State.health?.health_score?.value;
      if (score) speak(`Your health score today is ${score}. ${State.health.health_score.tip}`);
    }
  }, 150);
}

// ── Utility Helpers ────────────────────────────────────────────────────────────

function getStatusConfig(statusKey) {
  return CONFIG.STATUS_LABELS[statusKey] || { label: statusKey, class: 'status-muted' };
}

function getHealthScoreBand(score) {
  return CONFIG.HEALTH_SCORE_BANDS.find(b => score >= b.min && score <= b.max)
    || CONFIG.HEALTH_SCORE_BANDS[0];
}

function sparklineHTML(history, colorClass = 'primary') {
  if (!history?.length) return '';
  const max = Math.max(...history);
  return `
    <div class="sparkline" aria-hidden="true">
      ${history.map((v, i) => {
        const pct  = Math.round((v / max) * 100);
        const isLatest = i === history.length - 1;
        return `<div class="sparkline-bar${isLatest ? ' latest' : ''}"
                     style="height:${pct}%"></div>`;
      }).join('')}
    </div>
  `;
}


function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function announce(message) {
  const el = document.getElementById('sr-announcer');
  if (el) { el.textContent = ''; setTimeout(() => { el.textContent = message; }, 50); }
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

const h = escapeHTML;

function safePhone(value) {
  return String(value ?? '').replace(/(?!^\+)[^\d]/g, '');
}

function safeToken(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function safeImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(url)) return url;
  if (url.startsWith('https://') || url.startsWith('http://')) return url;
  return '';
}

function numberFromInput(id) {
  const value = document.getElementById(id)?.value?.trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusFromRange(value, normalMin, normalMax, warnMin, warnMax) {
  if (value == null) return 'normal';
  if (value >= normalMin && value <= normalMax) return 'normal';
  if (value >= warnMin && value <= warnMax) return 'borderline';
  return value < normalMin ? 'low' : 'high';
}

function bloodPressureStatus(systolic, diastolic) {
  if (systolic == null || diastolic == null) return 'normal';
  if (systolic <= 120 && diastolic <= 80) return 'normal';
  if (systolic <= 140 && diastolic <= 90) return 'borderline';
  return 'high';
}

function buildInitialHealthData() {
  const systolic = numberFromInput('ob-bp-sys');
  const diastolic = numberFromInput('ob-bp-dia');
  const fasting = numberFromInput('ob-sugar');
  const heartRate = numberFromInput('ob-heart-rate');
  const oxygen = numberFromInput('ob-spo2');
  const weight = numberFromInput('ob-weight');
  const height = numberFromInput('ob-height');
  const now = new Date().toISOString();

  let score = 100;
  if (bloodPressureStatus(systolic, diastolic) === 'borderline') score -= 8;
  if (bloodPressureStatus(systolic, diastolic) === 'high') score -= 18;
  if (statusFromRange(fasting, 70, 100, 101, 125) === 'borderline') score -= 8;
  if (statusFromRange(fasting, 70, 100, 101, 125) === 'high') score -= 18;
  if (statusFromRange(heartRate, 60, 100, 50, 110) !== 'normal') score -= 8;
  if (oxygen != null && oxygen < 95) score -= 12;
  score = Math.max(35, Math.min(100, score));

  return {
    vitals: {
      last_updated: now,
      blood_pressure: {
        systolic,
        diastolic,
        unit: 'mmHg',
        status: bloodPressureStatus(systolic, diastolic),
        history: systolic && diastolic ? [{ date: now.slice(0, 10), systolic, diastolic }] : []
      },
      blood_sugar: {
        fasting,
        post_meal: null,
        unit: 'mg/dL',
        status: statusFromRange(fasting, 70, 100, 101, 125),
        history: fasting ? [{ date: now.slice(0, 10), fasting, post_meal: null }] : []
      },
      heart_rate: {
        value: heartRate,
        unit: 'bpm',
        status: statusFromRange(heartRate, 60, 100, 50, 110),
        history: heartRate ? [heartRate] : []
      },
      oxygen_saturation: {
        value: oxygen,
        unit: '%',
        status: oxygen == null || oxygen >= 95 ? 'normal' : 'low',
        history: oxygen ? [oxygen] : []
      },
      weight: {
        value: weight,
        unit: 'kg',
        height_cm: height,
        history: weight ? [weight] : []
      }
    },
    medications: [],
    appointments: [],
    health_score: {
      value: score,
      label: getHealthScoreBand(score).label,
      breakdown: { vitals: score, medication_adherence: 0, activity: 0, sleep: 0 },
      tip: score >= 80
        ? 'Your baseline health details look good. Keep tracking your vitals regularly.'
        : 'Some baseline readings need attention. Please monitor them and consult a doctor if symptoms continue.'
    }
  };
}

async function persistCurrentProfile() {
  const response = await fetch('/api/profile', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: State.user }),
  });
  if (!response.ok) throw new Error('Profile save failed: ' + response.status);
  const data = await response.json();
  if (data.profile) {
    State.user = { ...State.user, ...data.profile };
    localStorage.setItem('civik_user_profile', JSON.stringify(State.user));
  }
  return data;
}

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
// PAGE RENDERERS
// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

// ── Dashboard ─────────────────────────────────────────────────────────────────

function renderDashboard(container) {
    const user    = State.user || {};
    const health  = State.health || { health_score: { value: 0 }, vitals: {}, medications: [], appointments: [] };
    const notifs  = State.notifications?.notifications || [];
    const unread  = notifs.filter(n => !n.read);
    const score   = health?.health_score?.value || 0;
    const band    = getHealthScoreBand(score);
    const circumference = 2 * Math.PI * 54;

    const quickActions = [
      { icon: 'medical_services', label: 'Health Hub',      page: 'health',    color: 'var(--clr-secondary)', bg: 'var(--clr-secondary-light)' },
      { icon: 'account_balance',  label: 'Govt. Schemes',   page: 'schemes',   color: 'var(--clr-accent)',    bg: 'var(--clr-accent-light)' },
      { icon: 'sos',              label: 'Emergency SOS',   page: 'sos',       color: 'var(--clr-danger)',    bg: 'var(--clr-danger-light)' },
      { icon: 'smart_toy',        label: 'AI Assistant',    page: 'assistant', color: 'var(--clr-primary)',   bg: 'var(--clr-primary-light)' },
    ];

    const vitals = health?.vitals;
    const meds   = health?.medications || [];
    const pendingMeds = meds.filter(m =>
      Object.values(m.today_status || {}).includes('pending') ||
      Object.values(m.today_status || {}).includes('missed')
    );

    container.innerHTML = `
      <!-- Page Header -->
      <div class="section-header">
        <div>
          <span class="section-eyebrow">Your Dashboard</span>
          <h2 class="section-title">Namaste, ${h(user?.name?.split(' ')[0] || 'Friend')} 🙏</h2>
        </div>
      </div>

      <!-- Top Row: Health Score + Notifications -->
      <div class="grid-2 dashboard-top-row mb-lg">
        <!-- Health Score Gauge Card -->
        <div class="card card-padded flex-col flex-center" style="text-align:center; gap: var(--space-md);"
             role="region" aria-label="Health score">
          <p class="section-eyebrow" style="margin:0">Overall Health Score</p>
          <div style="position:relative; width:140px; height:140px;">
            <svg class="gauge-svg" width="140" height="140" viewBox="0 0 120 120"
                 aria-label="Health score gauge showing ${score} out of 100" role="img">
              <circle class="gauge-track" cx="60" cy="60" r="54"
                      fill="none" stroke="var(--clr-border-light)" stroke-width="10"/>
              <circle id="gauge-fill" class="gauge-fill" cx="60" cy="60" r="54"
                      fill="none" stroke="var(--clr-primary)" stroke-width="10"
                      stroke-linecap="round"
                      stroke-dasharray="${circumference}"
                      stroke-dashoffset="${circumference}"/>
            </svg>
            <div style="position:absolute; inset:0; display:flex; flex-direction:column;
                        align-items:center; justify-content:center;">
              <span id="gauge-score-text" class="font-heading font-bold ${band.class}"
                    style="font-size:2.25rem; line-height:1;">0</span>
              <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">/ 100</span>
            </div>
          </div>
          <div>
            <p class="font-bold ${band.class}" style="font-size:1.125rem;">${band.label}</p>
            <p class="text-muted" style="font-size:0.8125rem; max-width:180px; margin:0 auto;">${h(health?.health_score?.tip || '')}</p>
          </div>
        </div>

        <!-- Notification Feed -->
        <div class="card" role="region" aria-label="Recent notifications">
          <div class="card-header">
            <h3>Alerts &amp; Reminders</h3>
            <span class="status-badge status-danger">${unread.length} unread</span>
          </div>
          <div class="card-body flex-col gap-sm" style="max-height:280px; overflow-y:auto;">
            ${unread.length === 0
              ? `<p class="text-muted">All caught up! No unread alerts.</p>`
              : unread.map(n => `
                <div class="notif-item unread priority-${safeToken(n.priority)}"
                     role="alert" aria-label="${h(n.title)}">
                  <div class="notif-dot ${safeToken(n.priority)}"></div>
                  <div>
                    <p class="font-bold" style="font-size:0.9rem;">${h(n.title)}</p>
                    <p class="text-muted" style="font-size:0.8125rem; margin:0.2rem 0;">${h(n.message)}</p>
                    <button class="btn btn-ghost btn-sm mt-sm"
                            onclick="window.navigateTo('${safeToken(n.action.page)}')"
                            aria-label="${h(n.action.label)}">
                      ${h(n.action.label)}
                      <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem;">arrow_forward</span>
                    </button>
                  </div>
                </div>
              `).join('')
            }
          </div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="mb-lg">
        <div class="section-header" style="margin-bottom: var(--space-md);">
          <h3 style="font-size:1.0625rem;">Quick Actions</h3>
        </div>
        <div class="grid-4 grid-2-mobile">
          ${quickActions.map(a => `
            <button class="stat-card flex-center gap-md"
                    style="cursor:pointer; border:none; text-align:left; background:var(--clr-surface);"
                    onclick="window.navigateTo('${a.page}')"
                    aria-label="Go to ${a.label}">
              <div class="stat-icon" style="color:${a.color}; background:${a.bg};">
                <span class="material-symbols-rounded" aria-hidden="true">${a.icon}</span>
              </div>
              <span class="font-bold" style="font-size:0.9375rem;">${a.label}</span>
              <span class="material-symbols-rounded text-muted" aria-hidden="true"
                    style="margin-left:auto; font-size:1.125rem;">chevron_right</span>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Today's Vitals Summary -->
      <div class="mb-lg">
        <div class="section-header">
          <div>
            <h3 style="font-size:1.0625rem;">Today's Vitals</h3>
          </div>
          <button class="section-link" onclick="window.navigateTo('health')"
                  aria-label="View full health hub">
            View all
            <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem;">arrow_forward</span>
          </button>
        </div>
        <div class="grid-3 grid-2-mobile">
          ${renderVitalMiniCard('Blood Pressure',
              `${vitals?.blood_pressure?.systolic || '—'}/${vitals?.blood_pressure?.diastolic || '—'}`,
              vitals?.blood_pressure?.unit, vitals?.blood_pressure?.status,
              'monitor_heart', 'var(--clr-danger)', 'var(--clr-danger-light)')}
          ${renderVitalMiniCard('Blood Sugar (Fasting)',
              vitals?.blood_sugar?.fasting,
              vitals?.blood_sugar?.unit, vitals?.blood_sugar?.status,
              'bloodtype', 'var(--clr-primary)', 'var(--clr-primary-light)')}
          ${renderVitalMiniCard('Heart Rate',
              vitals?.heart_rate?.value,
              vitals?.heart_rate?.unit, vitals?.heart_rate?.status,
              'favorite', 'var(--clr-secondary)', 'var(--clr-secondary-light)',
              vitals?.heart_rate?.history)}
        </div>
      </div>

      <!-- Pending Medications -->
      ${pendingMeds.length > 0 ? `
      <div class="card" role="region" aria-label="Pending medications">
        <div class="card-header">
          <h3>Medicines Due</h3>
          <button class="section-link" onclick="window.navigateTo('health')" aria-label="View all medications">
            View all <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem;">arrow_forward</span>
          </button>
        </div>
        <div class="card-body flex-col gap-sm">
          ${pendingMeds.map(m => `
            <div class="flex-between" style="padding: 0.5rem 0; border-bottom: 1px solid var(--clr-border-light);">
              <div class="flex-center gap-sm">
                <div class="med-pill ${safeToken(m.colour)}"></div>
                <div>
                  <p class="font-bold" style="font-size:0.9375rem;">${h(m.name)} — ${h(m.dosage)}</p>
                  <p class="text-muted" style="font-size:0.8125rem;">${h(m.purpose)}</p>
                </div>
              </div>
              <div class="flex-center gap-sm">
                ${Object.entries(m.today_status || {}).filter(([,s]) => s !== 'taken').map(([t, s]) => {
                  const cfg = getStatusConfig(s);
                  return `<span class="med-time-chip ${safeToken(s)}" aria-label="${h(m.name)} at ${h(formatTime(t))} is ${h(cfg.label)}">${h(formatTime(t))} · ${h(cfg.label)}</span>`;

              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}
  `;

  // Animate gauge after render
  setTimeout(() => animateGauge(score, circumference), 200);
}

function renderVitalMiniCard(label, value, unit, status, icon, color, bgColor, history) {
  const cfg = getStatusConfig(status);
  return `
    <div class="stat-card" role="region" aria-label="${h(label)}: ${h(value)} ${h(unit || '')}, status ${h(cfg.label)}">
      <div class="flex-between">
        <div class="stat-icon" style="color:${color}; background:${bgColor};">
          <span class="material-symbols-rounded" aria-hidden="true">${icon}</span>
        </div>
        <span class="status-badge ${cfg.class}">${cfg.label}</span>
      </div>
      <p class="stat-label mt-sm">${h(label)}</p>
      <p class="stat-value">${h(value ?? '—')} <span class="stat-unit">${h(unit || '')}</span></p>
      ${history ? sparklineHTML(history) : ''}
    </div>
  `;
}

function animateGauge(score, circumference) {
  const gaugeFill = document.getElementById('gauge-fill');
  const scoreText = document.getElementById('gauge-score-text');
  if (!gaugeFill || !scoreText) return;

  const offset = circumference - (score / 100) * circumference;
  gaugeFill.style.strokeDashoffset = offset;

  let current = 0;
  const interval = setInterval(() => {
    current++;
    scoreText.textContent = current;
    if (current >= score) clearInterval(interval);
  }, 12);
}

// ── Health Hub ─────────────────────────────────────────────────────────────────

function renderHealth(container) {
  const health = State.health;
  const vitals = health?.vitals;
  const meds   = health?.medications || [];
  const apts   = health?.appointments || [];

  container.innerHTML = `
    <div class="section-header">
      <div>
        <span class="section-eyebrow">Your Wellness</span>
        <h2 class="section-title">Health Hub</h2>
      </div>
    </div>

    <!-- Vitals Section -->
    <div class="mb-lg" role="region" aria-labelledby="vitals-heading">
      <h3 id="vitals-heading" style="font-size:1.0625rem; margin-bottom:var(--space-md);">Today's Vitals</h3>
      <p class="text-muted" style="margin: -0.5rem 0 1rem; font-size:0.8125rem;">
        Last updated: ${vitals?.last_updated ? new Date(vitals.last_updated).toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'}) : 'Not recorded'}
      </p>
      <div class="grid-3 grid-2-mobile">
        ${renderVitalCard('Blood Pressure', `${vitals?.blood_pressure?.systolic}/${vitals?.blood_pressure?.diastolic}`,
            vitals?.blood_pressure?.unit, vitals?.blood_pressure?.status,
            'monitor_heart', 'var(--clr-danger)', 'var(--clr-danger-light)',
            vitals?.blood_pressure?.history?.map(h => h.systolic))}
        ${renderVitalCard('Blood Sugar (Fasting)', vitals?.blood_sugar?.fasting,
            vitals?.blood_sugar?.unit, vitals?.blood_sugar?.status,
            'bloodtype', 'var(--clr-primary)', 'var(--clr-primary-light)',
            vitals?.blood_sugar?.history?.map(h => h.fasting))}
        ${renderVitalCard('Heart Rate', vitals?.heart_rate?.value,
            vitals?.heart_rate?.unit, vitals?.heart_rate?.status,
            'favorite', '#EF4444', '#FEE2E2',
            vitals?.heart_rate?.history)}
        ${renderVitalCard('SpO₂ (Oxygen)', vitals?.oxygen_saturation?.value,
            vitals?.oxygen_saturation?.unit, vitals?.oxygen_saturation?.status,
            'air', '#3B82F6', '#DBEAFE',
            vitals?.oxygen_saturation?.history)}
        ${renderVitalCard('Weight', vitals?.weight?.value,
            vitals?.weight?.unit, null,
            'monitor_weight', '#8B5CF6', '#EDE9FE',
            vitals?.weight?.history)}
      </div>
    </div>

    <hr class="divider">

    <!-- Medications Section -->
    <div class="mb-lg" role="region" aria-labelledby="meds-heading">
      <h3 id="meds-heading" style="font-size:1.0625rem; margin-bottom:var(--space-md);">Today's Medications</h3>
      <div class="flex-col gap-sm">
        ${meds.map(m => `
          <div class="card card-padded" aria-label="${h(m.name)} — ${h(m.dosage)}">
            <div class="flex-between">
              <div class="flex-center gap-md">
                <div class="med-pill ${safeToken(m.colour)}" style="width:16px; height:28px; border-radius:4px;"></div>
                <div>
                  <p class="font-bold" style="font-size:1rem;">${h(m.name)}
                    <span class="text-muted" style="font-weight:400;"> — ${h(m.dosage)}</span>
                  </p>
                  <p class="text-muted" style="font-size:0.8125rem;">${h(m.purpose)} · ${h(m.frequency)}</p>
                  <p class="text-muted" style="font-size:0.75rem;">
                    <span class="material-symbols-rounded" aria-hidden="true" style="font-size:0.875rem; vertical-align:middle;">info</span>
                    ${h(m.instructions)}
                  </p>
                </div>
              </div>
              <div class="flex-col" style="align-items:flex-end; gap:0.25rem;">
                ${m.times.map(t => {
                  const status = m.today_status?.[t] || 'pending';
                  const cfg = getStatusConfig(status);
                   return `<span class="med-time-chip ${safeToken(status)}"
                               aria-label="${h(m.name)} at ${h(formatTime(t))}: ${h(cfg.label)}">
                    ${h(formatTime(t))} · ${h(cfg.label)}
                  </span>`;
                }).join('')}
                <span class="text-muted" style="font-size:0.75rem;">
                  Refill by ${h(formatDate(m.refill_date))}
                </span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <hr class="divider">

    <!-- Appointments Section -->
    <div role="region" aria-labelledby="apts-heading">
      <h3 id="apts-heading" style="font-size:1.0625rem; margin-bottom:var(--space-md);">Upcoming Appointments</h3>
      <div class="flex-col gap-sm">
        ${apts.map(a => {
          const cfg = getStatusConfig(a.status);
          return `
          <div class="card card-padded" aria-label="Appointment with ${h(a.doctor)} on ${h(formatDate(a.date))}">
            <div class="flex-between">
              <div class="flex-center gap-md">
                <div class="stat-icon" style="color:var(--clr-secondary); background:var(--clr-secondary-light); width:48px; height:48px;">
                  <span class="material-symbols-rounded" aria-hidden="true">
                    ${a.type === 'video' ? 'videocam' : 'local_hospital'}
                  </span>
                </div>
                <div>
                  <p class="font-bold" style="font-size:1rem;">${h(a.doctor)}</p>
                  <p class="text-muted" style="font-size:0.875rem;">${h(a.speciality)} · ${h(a.hospital)}</p>
                  <p class="font-bold" style="font-size:0.875rem; color:var(--clr-primary); margin-top:0.25rem;">
                    <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem; vertical-align:middle;">calendar_today</span>
                    ${h(formatDate(a.date))} at ${h(formatTime(a.time))}
                  </p>
                </div>
              </div>
              <div class="flex-col" style="align-items:flex-end; gap:0.5rem;">
                <span class="status-badge ${cfg.class}">${cfg.label}</span>
                <span class="status-badge status-info">
                  <span class="material-symbols-rounded" aria-hidden="true" style="font-size:0.875rem;">
                    ${a.type === 'video' ? 'videocam' : 'directions_walk'}
                  </span>
                  ${a.type === 'video' ? 'Video Call' : 'In Person'}
                </span>
              </div>
            </div>
            ${a.notes ? `<p class="text-muted mt-sm" style="font-size:0.8125rem; padding-top:0.75rem; border-top:1px solid var(--clr-border-light);">
              <span class="font-bold">Note:</span> ${h(a.notes)}
            </p>` : ''}
          </div>
        `}).join('')}
      </div>
    </div>
  `;
}

function renderVitalCard(label, value, unit, status, icon, color, bgColor, history) {
  const cfg = status ? getStatusConfig(status) : null;
  return `
    <div class="stat-card" role="region" aria-label="${h(label)}: ${h(value)} ${h(unit || '')} ${cfg ? ', status: ' + h(cfg.label) : ''}">
      <div class="flex-between">
        <div class="stat-icon" style="color:${color}; background:${bgColor};">
          <span class="material-symbols-rounded" aria-hidden="true">${icon}</span>
        </div>
        ${cfg ? `<span class="status-badge ${cfg.class}">${cfg.label}</span>` : ''}
      </div>
      <p class="stat-label mt-sm">${h(label)}</p>
      <p class="stat-value">${h(value ?? '—')} <span class="stat-unit">${h(unit || '')}</span></p>
      <p class="stat-trend">Last 7 days</p>
      ${history ? sparklineHTML(history) : ''}
    </div>
  `;
}

// ── Government Schemes ─────────────────────────────────────────────────────────

function renderSchemes(container) {
  const { schemes = [], categories = [] } = State.schemes || {};

  container.innerHTML = `
    <div class="section-header">
      <div>
        <span class="section-eyebrow">Benefits & Services</span>
        <h2 class="section-title">Government Schemes</h2>
      </div>
    </div>

    <!-- Category Filter -->
    <div class="flex-center gap-sm mb-lg" style="flex-wrap:wrap;" role="group" aria-label="Filter schemes by category">
      ${categories.map(c => `
        <button class="filter-chip ${c.id === 'all' ? 'active' : ''}"
                data-category="${c.id}"
                aria-label="Filter by ${c.label}"
                aria-pressed="${c.id === 'all'}">
          <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem;">${c.icon}</span>
          ${c.label}
        </button>
      `).join('')}
    </div>

    <!-- Schemes Grid -->
    <div class="grid-auto" id="schemes-grid" role="list" aria-label="Government schemes">
      ${schemes.map(s => renderSchemeCard(s)).join('')}
    </div>
  `;

  // Filter logic
  container.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.filter-chip').forEach(c => {
        c.classList.remove('active');
        c.setAttribute('aria-pressed', 'false');
      });
      chip.classList.add('active');
      chip.setAttribute('aria-pressed', 'true');

      const cat = chip.dataset.category;
      const grid = document.getElementById('schemes-grid');
      const filtered = cat === 'all' ? schemes : schemes.filter(s => s.category === cat);
      grid.innerHTML = filtered.map(s => renderSchemeCard(s)).join('');
      announce(`Showing ${filtered.length} schemes for ${chip.textContent.trim()}`);
    });
  });
}

function renderSchemeCard(scheme) {
  const statusCfg = getStatusConfig(scheme.user_status);
  return `
    <div class="scheme-card" role="listitem" aria-label="${scheme.name}">
      <div class="flex-between">
        <span class="scheme-category-chip">
          <span class="material-symbols-rounded" aria-hidden="true" style="font-size:0.875rem;">
            ${State.schemes?.categories?.find(c => c.id === scheme.category)?.icon || 'label'}
          </span>
          ${scheme.category}
        </span>
        <span class="status-badge ${statusCfg.class}">${statusCfg.label}</span>
      </div>
      <h4 style="font-size:1rem; margin-top:0.5rem;">${scheme.name}</h4>
      <p style="font-size:0.875rem; color:var(--clr-text-secondary);">${scheme.description}</p>
      <div style="padding: 0.5rem 0.75rem; background:var(--clr-surface-raised);
                  border-radius:var(--radius-sm); border: 1px solid var(--clr-border-light);">
        <p class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">Benefit</p>
        <p class="font-bold" style="font-size:0.9375rem; color:var(--clr-secondary);">${scheme.benefit_amount}</p>
      </div>
      <div>
        <p class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:0.375rem;">Eligibility</p>
        <ul style="list-style:none; display:flex; flex-direction:column; gap:0.2rem;">
          ${scheme.eligibility.map(e => `
            <li style="font-size:0.8125rem; color:var(--clr-text-secondary); display:flex; gap:0.25rem; align-items:flex-start;">
              <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem; color:var(--clr-success); flex-shrink:0;">check_circle</span>
              ${e}
            </li>
          `).join('')}
        </ul>
      </div>
      <div class="flex-center gap-sm" style="margin-top:auto; padding-top:0.5rem;">
        ${scheme.user_status === 'not_applied' ? `
          <a href="${scheme.application_url}" target="_blank" rel="noopener"
             class="btn btn-primary btn-sm" style="flex:1; justify-content:center;"
             aria-label="Apply for ${scheme.name} (opens in new tab)">
            Apply Now
            <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem;">open_in_new</span>
          </a>
        ` : ''}
        <a href="tel:${scheme.helpline}" class="btn btn-ghost btn-sm"
           aria-label="Call helpline ${scheme.helpline} for ${scheme.name}">
          <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem;">call</span>
          ${scheme.helpline}
        </a>
      </div>
    </div>
  `;
}

// ── Emergency SOS ──────────────────────────────────────────────────────────────

function renderSOS(container) {
  const user     = State.user;
  const contacts = user?.emergency_contacts || [];
  const primary  = contacts.find(c => c.is_primary) || contacts[0] || null;
  const ringC    = +(2 * Math.PI * 85).toFixed(2);

  if (State.ttsEnabled) {
    speak('Emergency SOS page. Hold the SOS button for 3 seconds to alert your emergency contacts.');
  }

  container.innerHTML = `
    <div class="section-header">
      <div>
        <span class="section-eyebrow" style="color:var(--clr-danger);">Emergency</span>
        <h2 class="section-title" style="color:var(--clr-danger);">Emergency SOS</h2>
      </div>
    </div>

    ${primary ? `
    <div style="background:var(--clr-danger-light);border:1.5px solid var(--clr-danger);
                border-radius:var(--radius-md);padding:var(--space-md) var(--space-lg);
                display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-xl);"
         role="note" aria-label="SOS will alert ${h(primary.name)}">
      <span class="material-symbols-rounded" aria-hidden="true"
            style="color:var(--clr-danger);font-size:1.5rem;flex-shrink:0;">emergency_home</span>
      <div>
        <p class="font-bold" style="color:var(--clr-danger);">SOS will alert: ${h(primary.name)} (${h(primary.relation)})</p>
        <p style="font-size:0.8125rem;color:var(--clr-text-secondary);margin:0;">
          WhatsApp message + phone call to ${h(primary.phone)}
        </p>
      </div>
    </div>
    ` : `
    <div style="background:var(--clr-warning-light);border:1.5px solid var(--clr-warning);
                border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-xl);">
      <p class="font-bold" style="color:var(--clr-warning);">No emergency contacts found. Please add one in your profile.</p>
    </div>
    `}

    <div style="display:flex;flex-direction:column;align-items:center;padding:var(--space-xl) 0;"
         role="region" aria-label="Emergency SOS hold button">
      <div style="position:relative;width:220px;height:220px;">
        <svg width="220" height="220" viewBox="0 0 220 220"
             style="position:absolute;inset:0;transform:rotate(-90deg);" aria-hidden="true">
          <circle cx="110" cy="110" r="85" fill="none" stroke="rgba(220,38,38,0.15)" stroke-width="8"/>
          <circle id="sos-countdown-ring" cx="110" cy="110" r="85"
                  fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="8"
                  stroke-linecap="round"
                  stroke-dasharray="${ringC}"
                  stroke-dashoffset="${ringC}"
                  style="transition:stroke 0.1s ease;"/>
        </svg>
        <button class="sos-button" id="sos-btn"
                style="position:absolute;inset:20px;width:180px;height:180px;"
                aria-label="Hold for 3 seconds to activate emergency SOS">
          <span class="material-symbols-rounded" aria-hidden="true">sos</span>
          <span>HOLD FOR SOS</span>
          <span style="font-size:0.75rem;font-weight:500;opacity:0.85;">3 seconds</span>
        </button>
      </div>
      <p id="sos-status" class="text-muted mt-lg"
         style="font-size:0.9375rem;text-align:center;max-width:340px;min-height:60px;">
        Hold the button for 3 seconds to alert your contacts
      </p>
    </div>

    <hr class="divider">

    <div class="card card-padded mb-lg" role="region" aria-label="Medical information card">
      <h3 style="font-size:1.0625rem;margin-bottom:var(--space-md);">
        <span class="material-symbols-rounded" aria-hidden="true"
              style="vertical-align:middle;color:var(--clr-danger);">emergency</span>
        Medical Info Card
      </h3>
      <div class="grid-3">
        <div>
          <p class="text-muted" style="font-size:0.75rem;font-weight:700;text-transform:uppercase;">Blood Group</p>
          <p class="font-bold" style="font-size:1.5rem;color:var(--clr-danger);">${h(user?.blood_group || '—')}</p>
        </div>
        <div>
          <p class="text-muted" style="font-size:0.75rem;font-weight:700;text-transform:uppercase;">Conditions</p>
          ${(user?.medical_conditions || []).map(cond =>
            '<span class="status-badge status-warning" style="margin:2px;">' + h(cond) + '</span>'
          ).join('')}
        </div>
        <div>
          <p class="text-muted" style="font-size:0.75rem;font-weight:700;text-transform:uppercase;margin-bottom:4px;">Allergies</p>
          ${(user?.allergies || []).map(al =>
            '<span class="status-badge status-danger" style="margin:2px;">' + h(al) + '</span>'
          ).join('') || '<span class="text-muted">None listed</span>'}
        </div>
      </div>
    </div>

    <div role="region" aria-label="Emergency contacts">
      <div class="flex-between" style="margin-bottom:var(--space-md);">
        <h3 style="font-size:1.0625rem;">Emergency Contacts</h3>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('add-contact-form').style.display='block'" aria-label="Add new contact">
          <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem;">add</span> Add New
        </button>
      </div>

      <!-- Add Contact Form (Hidden by default) -->
      <div id="add-contact-form" class="card card-padded mb-md" style="display:none; border:1.5px solid var(--clr-primary);">
        <h4 style="margin-bottom:0.5rem; font-size:0.9375rem; color:var(--clr-primary);">Add Emergency Contact</h4>
        <div class="flex-col gap-sm">
          <input type="text" id="new-contact-name" placeholder="Name (e.g. Priya)" 
                 style="padding:0.5rem; border-radius:4px; border:1px solid var(--clr-border); font-family:inherit;">
          <input type="text" id="new-contact-rel" placeholder="Relation (e.g. Daughter)" 
                 style="padding:0.5rem; border-radius:4px; border:1px solid var(--clr-border); font-family:inherit;">
          <input type="tel" id="new-contact-phone" placeholder="Phone Number (e.g. +91 9876543210)" 
                 style="padding:0.5rem; border-radius:4px; border:1px solid var(--clr-border); font-family:inherit;">
          <div class="flex-center gap-sm" style="margin-top:0.25rem;">
            <button class="btn btn-primary btn-sm" onclick="window.saveNewContact()">Save</button>
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('add-contact-form').style.display='none'">Cancel</button>
          </div>
        </div>
      </div>

      <div class="flex-col gap-sm">
        ${contacts.map(ct => `
           <div class="card card-padded flex-between"
                aria-label="${h(ct.name)}, ${h(ct.relation)}${ct.is_primary ? ', primary SOS contact' : ''}">
             <div class="flex-center gap-md">
              <div class="user-avatar" aria-hidden="true">${h(ct.name.charAt(0))}</div>
              <div>
                <p class="font-bold">${h(ct.name)}
                  ${ct.is_primary
                    ? '<span class="status-badge status-danger" style="margin-left:0.5rem;">Primary SOS</span>'
                    : ''}
                </p>
                <p class="text-muted" style="font-size:0.875rem;">${h(ct.relation)} · ${h(ct.phone)}</p>
              </div>
            </div>
            <div class="flex-center gap-sm">
              <a href="tel:${safePhone(ct.phone)}" class="btn btn-primary btn-sm"
                 aria-label="Call ${h(ct.name)}">
                <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem;">call</span>
                Call Now
              </a>
              <button class="btn btn-ghost btn-sm" style="color:var(--clr-danger);" 
                      onclick="window.deleteContact('${h(safePhone(ct.phone))}')"
                      aria-label="Delete ${h(ct.name)}">
                <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1.125rem;">delete</span>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Attach dynamic save function to window
  window.saveNewContact = () => {
    const name = document.getElementById('new-contact-name')?.value.trim();
    const rel = document.getElementById('new-contact-rel')?.value.trim();
    const phone = safePhone(document.getElementById('new-contact-phone')?.value.trim());

    if (!name || !phone) {
      alert("Name and Phone Number are required!");
      return;
    }

    if (!State.user.emergency_contacts) {
      State.user.emergency_contacts = [];
    }

    // New contact becomes primary if it's the only one
    const isPrimary = State.user.emergency_contacts.length === 0;

    State.user.emergency_contacts.push({
      name: name,
      relation: rel || 'Friend',
      phone: phone,
      is_primary: isPrimary
    });

    persistCurrentProfile()
      .catch(err => {
        console.error('[SOS] Contact save failed:', err);
        alert('Contact was added locally but could not be saved to the server.');
      })
      .finally(() => {
        renderSOS(document.getElementById('page-root').querySelector('.page-content') || container);
      });

    // Announce to screen readers
    announce(`Added emergency contact ${name}`);
  };

  // Attach dynamic delete function to window
  window.deleteContact = (phone) => {
    if (!confirm("Are you sure you want to delete this contact?")) return;

    if (State.user.emergency_contacts) {
      State.user.emergency_contacts = State.user.emergency_contacts.filter(c => c.phone !== phone);
      
      // If the primary contact was deleted and others remain, make the first one primary
      if (State.user.emergency_contacts.length > 0 && !State.user.emergency_contacts.some(c => c.is_primary)) {
        State.user.emergency_contacts[0].is_primary = true;
      }

      persistCurrentProfile()
        .catch(err => {
          console.error('[SOS] Contact delete failed:', err);
          alert('Contact was deleted locally but could not be saved to the server.');
        });
    }

    // Re-render SOS page
    renderSOS(document.getElementById('page-root').querySelector('.page-content'));
    announce(`Contact deleted`);
  };

  initSOSButton();
}

function initSOSButton() {
  const btn    = document.getElementById('sos-btn');
  const status = document.getElementById('sos-status');
  const ring   = document.getElementById('sos-countdown-ring');
  if (!btn) return;

  const HOLD_DURATION = 3000; // 3 seconds, like a real phone SOS
  let holdTimer    = null;
  let startTime    = null;
  let rafId        = null;
  let activated    = false;

  // Get primary contact from loaded user data
  function getPrimaryContact() {
    const contacts = State.user?.emergency_contacts || [];
    return contacts.find(c => c.is_primary) || contacts[0] || null;
  }

  // Format phone for WhatsApp (remove +, spaces, dashes)
  function toWhatsAppNumber(phone) {
    return phone.replace(/[^0-9]/g, '');
  }

  // Build WhatsApp SOS message
  function buildSOSMessage(contact) {
    const user = State.user;
    const vitals = State.health?.vitals;
    const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    return encodeURIComponent(
      `🚨 *EMERGENCY SOS from civik.link* 🚨\n\n` +
      `*${user?.name || 'Your family member'}* needs immediate help!\n\n` +
      `⏰ Time: ${time}, ${date}\n` +
      `🩸 Blood Group: ${user?.blood_group || 'Unknown'}\n` +
      `💊 Conditions: ${user?.medical_conditions?.join(', ') || 'None listed'}\n` +
      `❗ Allergies: ${user?.allergies?.join(', ') || 'None listed'}\n\n` +
      `📍 Please contact them immediately or call 112 (Emergency Services)\n\n` +
      `_Sent automatically via civik.link_`
    );
  }


  function updateRing(progress) {
    if (!ring) return;
    const circumference = 2 * Math.PI * 85; 
    const offset = circumference * (1 - progress);
    ring.style.strokeDashoffset = offset;
    const r = Math.round(217 + (220 - 217) * progress);
    const g = Math.round(96  + (38  - 96)  * progress);
    const b = Math.round(10  + (38  - 10)  * progress);
    ring.style.stroke = `rgb(${r},${g},${b})`;
  }

  function startHold() {
    if (activated) return;
    startTime = Date.now();
    function tick() {
      const elapsed  = Date.now() - startTime;
      const progress = Math.min(elapsed / HOLD_DURATION, 1);
      const remaining = Math.ceil((HOLD_DURATION - elapsed) / 1000);
      updateRing(progress);
      status.textContent = remaining > 0
        ? `Hold for ${remaining} more second${remaining !== 1 ? 's' : ''}…`
        : 'Activating SOS…';
      status.style.color  = 'var(--clr-danger)';
      status.style.fontWeight = '700';
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        triggerSOS();
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  function cancelHold() {
    if (activated) return;
    cancelAnimationFrame(rafId);
    startTime = null;
    updateRing(0);
    ring.style.stroke = 'rgba(255,255,255,0.3)';
    status.textContent = 'Hold the button for 3 seconds to alert your contacts';
    status.style.color = '';
    status.style.fontWeight = '';
  }

  function triggerSOS() {
    activated = true;
    const contact = getPrimaryContact();
    btn.style.background = 'linear-gradient(145deg, #991B1B, #7F1D1D)';
    status.innerHTML = `
      <strong style="color:var(--clr-danger);font-size:1rem;">🚨 SOS Activated!</strong><br>
      <span>Alerting <strong>${h(contact?.name || 'your contacts')}</strong>…</span>
    `;
    announce(`Emergency SOS activated. Alerting ${contact?.name || 'your emergency contacts'}.`);
    if (State.ttsEnabled) speak(`Emergency alert sent. Help is on the way.`);

    if (contact) {
      const waNumber  = toWhatsAppNumber(contact.phone);
      const waMessage = buildSOSMessage(contact);
      const waURL     = `https://wa.me/${waNumber}?text=${waMessage}`;
      window.open(waURL, '_blank', 'noopener');
      setTimeout(() => {
        window.location.href = `tel:${contact.phone.replace(/[^0-9+]/g, '')}`;
      }, 1500);
    }
  }

  btn.addEventListener('mousedown',  startHold);
  btn.addEventListener('mouseup',    cancelHold);
  btn.addEventListener('mouseleave', cancelHold);
  btn.addEventListener('touchstart', startHold,  { passive: true });
  btn.addEventListener('touchend',   cancelHold);
  btn.addEventListener('touchcancel',cancelHold);
}

// ── AI Assistant ───────────────────────────────────────────────────────────────

function renderAssistant(container) {
  const suggestedQuestions = [
    'Am I eligible for Ayushman Bharat?',
    'What is my health score today?',
    'How do I get a UDID card?',
    'When is my next appointment?',
    'What medicines do I need to take today?',
  ];

  container.innerHTML = `
    <div class="section-header">
      <div>
        <span class="section-eyebrow">AI Powered</span>
        <h2 class="section-title">AI Assistant</h2>
      </div>
    </div>

    <div class="chat-layout">

      <!-- Chat Panel -->
      <div class="card chat-panel">
        <div class="card-header">
          <div class="flex-center gap-sm">
            <div class="stat-icon" style="width:36px;height:36px;background:var(--clr-primary-light);color:var(--clr-primary);">
              <span class="material-symbols-rounded" aria-hidden="true">smart_toy</span>
            </div>
            <div>
              <h3 style="font-size:0.9375rem;">civik Assistant</h3>
              <p class="text-muted" style="font-size:0.75rem; margin:0;">Ask me anything about health or schemes</p>
            </div>
          </div>
        </div>
        <div id="chat-messages" class="flex-col gap-md" style="flex:1; overflow-y:auto; padding:var(--space-lg);"
             role="log" aria-label="Chat messages" aria-live="polite">
          <div class="chat-bubble assistant">
            Namaste! 🙏 I'm your civik Assistant. I can help you with your health, government schemes, medications, and more. How can I help you today?
          </div>
        </div>
        <div style="padding:var(--space-md); border-top:1px solid var(--clr-border-light);">
          <div class="flex-center gap-sm">
            <input type="text" id="chat-input"
                   placeholder="Type your question…"
                   aria-label="Type your question for the AI assistant"
                   style="flex:1; padding:0.75rem 1rem; border:1.5px solid var(--clr-border);
                          border-radius:var(--radius-full); font-size:0.9375rem; font-family:var(--font-body);
                          background:var(--clr-surface); color:var(--clr-text); outline:none;
                          transition:border-color var(--transition-fast);"
                   onkeydown="if(event.key==='Enter') window.sendChatMessage()">
            <button class="btn btn-primary" id="btn-mic" onclick="window.startVoiceInput()"
                    aria-label="Use voice input" title="Speak your question">
              <span class="material-symbols-rounded" aria-hidden="true">mic</span>
            </button>
            <button class="btn btn-primary" onclick="window.sendChatMessage()"
                    aria-label="Send message">
              <span class="material-symbols-rounded" aria-hidden="true">send</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Suggested Questions Panel -->
      <div class="flex-col gap-md">
        <div class="card card-padded">
          <h4 style="font-size:0.9375rem; margin-bottom:var(--space-md);">Suggested Questions</h4>
          <div class="flex-col gap-sm">
            ${suggestedQuestions.map(q => `
              <button class="btn btn-ghost" style="text-align:left; justify-content:flex-start;"
                      onclick="window.askSuggested('${q.replace(/'/g, "\\'")}')"
                      aria-label="Ask: ${q}">
                <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem; flex-shrink:0;">chat_bubble</span>
                <span style="font-size:0.875rem;">${q}</span>
              </button>
            `).join('')}
          </div>
        </div>
      </div>

    </div>
  `;

  initAssistant();
}

function buildUserContext() {
  const user   = State.user;
  const health = State.health;
  const meds   = health?.medications || [];
  const apts   = health?.appointments || [];
  const schemes = (State.schemes?.schemes || []).filter(s => s.user_status === 'enrolled');
  const nextApt = apts[0];

  return {
    userName:         user?.name || 'the user',
    healthScore:      health?.health_score?.value,
    healthScoreLabel: getHealthScoreBand(health?.health_score?.value || 0).label,
    healthTip:        health?.health_score?.tip || '',
    bloodPressure:    health?.vitals?.blood_pressure
                        ? `${health.vitals.blood_pressure.systolic}/${health.vitals.blood_pressure.diastolic}`
                        : null,
    bpStatus:         health?.vitals?.blood_pressure?.status || '',
    bloodSugar: {
      fasting:  health?.vitals?.blood_sugar?.fasting,
      postMeal: health?.vitals?.blood_sugar?.post_meal,
    },
    bsStatus:         health?.vitals?.blood_sugar?.status || '',
    heartRate:        health?.vitals?.heart_rate?.value,
    medications:      meds.map(m => `${m.name} ${m.dosage} (${m.frequency})`),
    nextAppointment:  nextApt
                        ? `${nextApt.doctor} on ${formatDate(nextApt.date)} at ${formatTime(nextApt.time)}`
                        : null,
    enrolledSchemes:  schemes.map(s => s.name),
  };
}

function initAssistant() {
  window.sendChatMessage = async () => {
    const input = document.getElementById('chat-input');
    const msg = input?.value?.trim();
    if (!msg) return;
    input.value = '';
    addChatMessage(msg, 'user');
    await fetchAIReply(msg);
  };

  window.askSuggested = async (q) => {
    addChatMessage(q, 'user');
    await fetchAIReply(q);
  };

  window.startVoiceInput = () => {
    if (!window.isSecureContext) {
      alert("Microphone access is blocked by your browser because this is not a secure HTTPS connection. Since you are testing via local Wi-Fi IP, the browser disables voice features for security. It will work perfectly once deployed!");
      return;
    }
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      announce('Voice input is not supported in your browser. Please type your question.');
      alert('Voice input is not supported in this browser.');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = State.user?.preferences?.language === 'hi' ? 'hi-IN' : 'en-IN';
    recognition.interimResults = false;
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      const input = document.getElementById('chat-input');
      if (input) { input.value = transcript; window.sendChatMessage(); }
    };
    recognition.onerror = () => announce('Could not understand. Please try again.');
    recognition.start();
    announce('Listening… speak your question now.');
    document.getElementById('btn-mic')?.classList.add('active');
  };
}

async function fetchAIReply(message) {
  // Show typing indicator
  const typingId = 'typing-' + Date.now();
  const container = document.getElementById('chat-messages');
  if (container) {
    const typing = document.createElement('div');
    typing.className = 'chat-bubble assistant';
    typing.id = typingId;
    typing.setAttribute('aria-live', 'polite');
    typing.innerHTML = `
      <div style="display:flex; gap:4px; align-items:center; padding:4px 0;">
        <div style="width:8px;height:8px;border-radius:50%;background:var(--clr-text-muted);
                    animation:ttsWave 0.8s ease-in-out infinite;"></div>
        <div style="width:8px;height:8px;border-radius:50%;background:var(--clr-text-muted);
                    animation:ttsWave 0.8s ease-in-out 0.15s infinite;"></div>
        <div style="width:8px;height:8px;border-radius:50%;background:var(--clr-text-muted);
                    animation:ttsWave 0.8s ease-in-out 0.30s infinite;"></div>
      </div>`;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
  }

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        context: buildUserContext(),
      }),
    });

    const data = await response.json();
    document.getElementById(typingId)?.remove();

    if (!response.ok) {
      addChatMessage(data.detail || data.error || 'Something went wrong. Please try again.', 'assistant');
    } else {
      addChatMessage(data.reply, 'assistant');
    }
  } catch (err) {
    document.getElementById(typingId)?.remove();
    addChatMessage('Secure connection to AI failed. Please ensure the backend is running.', 'assistant');
    console.error('[fetchAIReply]', err);
  }
}

function addChatMessage(text, role) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;
  bubble.setAttribute('aria-label', `${role === 'user' ? 'You' : 'Assistant'}: ${text}`);
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  if (State.ttsEnabled && role === 'assistant') speak(text);
}

// ── Caregiver View ─────────────────────────────────────────────────────────────

function renderCaregiver(container) {
  const user   = State.user;
  const health = State.health;
  const carer  = user?.caregiver;

  container.innerHTML = `
    <div class="section-header">
      <div>
        <span class="section-eyebrow">Family Access</span>
        <h2 class="section-title">Caregiver Connect</h2>
      </div>
    </div>

    <!-- Caregiver Info -->
    <div class="card card-padded mb-lg" role="region" aria-label="Caregiver information">
      <h3 style="font-size:1.0625rem; margin-bottom:var(--space-md);">Linked Caregiver</h3>
      <div class="flex-center gap-md">
        <div class="user-avatar" style="width:52px;height:52px;font-size:1.375rem;" aria-hidden="true">
          ${h(carer?.name?.charAt(0) || 'C')}
        </div>
        <div>
          <p class="font-bold" style="font-size:1.125rem;">${h(carer?.name || 'No caregiver linked')}</p>
          <p class="text-muted">${h(carer?.relation || '')} ${carer?.phone ? '· ' + h(carer.phone) : ''}</p>
          <p class="text-muted" style="font-size:0.8125rem;">${h(carer?.email || '')}</p>
        </div>
        ${carer?.phone ? `
          <a href="tel:${safePhone(carer.phone)}" class="btn btn-primary btn-sm" style="margin-left:auto;"
             aria-label="Call ${h(carer.name)}">
            <span class="material-symbols-rounded" aria-hidden="true" style="font-size:1rem;">call</span>
            Call
          </a>
        ` : ''}
      </div>
    </div>

    <!-- Patient Summary for Caregiver -->
    <div class="card" role="region" aria-label="Patient health summary for caregiver">
      <div class="card-header">
        <h3>Patient Summary — ${h(user?.name)}</h3>
        <span class="status-badge status-normal">Live</span>
      </div>
      <div class="card-body grid-3">
        ${renderVitalMiniCard('Blood Pressure',
            `${health?.vitals?.blood_pressure?.systolic}/${health?.vitals?.blood_pressure?.diastolic}`,
            health?.vitals?.blood_pressure?.unit, health?.vitals?.blood_pressure?.status,
            'monitor_heart', 'var(--clr-danger)', 'var(--clr-danger-light)')}
        ${renderVitalMiniCard('Blood Sugar',
            health?.vitals?.blood_sugar?.fasting,
            health?.vitals?.blood_sugar?.unit, health?.vitals?.blood_sugar?.status,
            'bloodtype', 'var(--clr-primary)', 'var(--clr-primary-light)')}
        ${renderVitalMiniCard('Heart Rate',
            health?.vitals?.heart_rate?.value,
            health?.vitals?.heart_rate?.unit, health?.vitals?.heart_rate?.status,
            'favorite', '#EF4444', '#FEE2E2')}
      </div>
    </div>
  `;
}

// ── Accessibility Engine ───────────────────────────────────────────────────────

function applyFontSize(size) {
  const cfg = CONFIG.FONT_SIZES[size] || CONFIG.FONT_SIZES.medium;
  document.documentElement.style.setProperty('--base-font-size', cfg.rootRem);
  State.fontSize = size;
  document.querySelectorAll('[id^="btn-font-"]').forEach(btn => btn.classList.remove('active'));
  const active = document.getElementById(`btn-font-${size}`);
  if (active) active.classList.add('active');
}

function applyHighContrast(enabled) {
  document.body.classList.toggle('high-contrast', enabled);
  State.highContrast = enabled;
  const btn = document.getElementById('btn-contrast');
  if (btn) btn.classList.toggle('active', enabled);
  announce(enabled ? 'High contrast mode enabled' : 'High contrast mode disabled');
}

function speak(text) {
  if (!State.ttsEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  Object.assign(utterance, CONFIG.TTS);
  window.speechSynthesis.speak(utterance);
}

function initAccessibilityControls() {
  document.getElementById('btn-font-small') ?.addEventListener('click', () => applyFontSize('small'));
  document.getElementById('btn-font-medium')?.addEventListener('click', () => applyFontSize('medium'));
  document.getElementById('btn-font-large') ?.addEventListener('click', () => applyFontSize('large'));

  document.getElementById('btn-contrast')?.addEventListener('click', () => {
    applyHighContrast(!State.highContrast);
  });

  document.getElementById('btn-tts')?.addEventListener('click', () => {
    State.ttsEnabled = !State.ttsEnabled;
    document.getElementById('btn-tts').classList.toggle('active', State.ttsEnabled);
    announce(State.ttsEnabled ? 'Text to speech enabled' : 'Text to speech disabled');
    if (State.ttsEnabled) speak('Text to speech is now enabled. I will read important information aloud.');
    else window.speechSynthesis?.cancel();
  });
}

function initMobileMenu() {
  const btn     = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  function openMenu() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    overlay.removeAttribute('aria-hidden');
    btn?.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    btn?.setAttribute('aria-expanded', 'false');
  }

  btn?.addEventListener('click', () => sidebar.classList.contains('open') ? closeMenu() : openMenu());
  overlay?.addEventListener('click', closeMenu);
  sidebar?.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', closeMenu));
}

window.navigateTo = navigateTo;

// ── App Initialization ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  boot();
});

// ── Landing & Authentication UI ─────────────────────────────────────────────────────────

window.renderLanding = function() {
  const container = document.getElementById('page-root');
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('header').style.display = 'none';
  document.getElementById('main-content').style.marginLeft = '0';

  container.innerHTML = `
    <div style="min-height: 100vh; display: flex; flex-direction: column; background-color: var(--bg-body); font-family: var(--font-stack);">
      <header style="padding: 1.5rem 2rem; display: flex; justify-content: space-between; align-items: center; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <img src="/assets/logo.png" alt="civik.link logo" style="height: 40px; border-radius: 8px;" onerror="this.style.display='none'">
          <h1 style="font-size: 1.5rem; font-weight: 700; color: var(--clr-primary); margin: 0;">civik.link</h1>
        </div>
        <button onclick="renderLogin()" style="background: var(--clr-primary); color: white; border: none; padding: 0.5rem 1.25rem; border-radius: 20px; font-weight: 600; cursor: pointer;">Log In</button>
      </header>

      <main style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 3rem 1.5rem;">
        <h2 style="font-size: 2.5rem; color: var(--clr-text); margin-bottom: 1rem; max-width: 600px;">Connecting Citizens to Health & Government Services</h2>
        <p style="font-size: 1.125rem; color: var(--clr-text-light); max-width: 500px; margin-bottom: 2.5rem; line-height: 1.6;">
          A simple, unified platform designed to help you discover government schemes, track your health vitals, and connect with emergency services effortlessly.
        </p>
        <button onclick="renderLogin()" style="background: var(--clr-primary); color: white; border: none; padding: 1rem 2rem; border-radius: 30px; font-size: 1.125rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; box-shadow: 0 4px 12px rgba(11, 83, 148, 0.2); transition: transform 0.2s ease;">
          Get Started Now <span class="material-symbols-rounded">arrow_forward</span>
        </button>
      </main>

      <footer style="padding: 1.5rem; text-align: center; color: var(--clr-text-light); font-size: 0.875rem;">
        &copy; 2026 civik.link. All rights reserved. | <a href="#" style="color: var(--clr-primary); text-decoration: none;">Privacy Policy</a>
      </footer>
    </div>
  `;
}


window.renderLogin = function renderLogin() {
  const container = document.getElementById('page-root');
  // Hide UI shell
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('header').style.display = 'none';
  document.getElementById('main-content').style.marginLeft = '0';

  container.innerHTML = `
    <div style="max-width:440px; margin: 10vh auto; padding: var(--space-2xl); text-align:center;">
      <div class="sidebar-brand-icon" style="width:64px; height:64px; margin: 0 auto var(--space-lg); font-size:2rem;">
        <span class="material-symbols-rounded">link</span>
      </div>
      <h2 style="margin-bottom:var(--space-xs);">Welcome to civik.link</h2>
      <p class="text-muted" style="margin-bottom:var(--space-xl);">Secure JWT Authentication for Citizens</p>

      <div class="card card-padded flex-col gap-md" style="text-align:left;">
        <div class="flex-col gap-xs">
          <label class="font-bold">Email Address</label>
          <input type="email" id="login-email" placeholder="you@example.com" 
                 style="padding:1rem; border-radius:var(--radius-md); border:2px solid var(--clr-border); font-size:1.125rem;">
        </div>
        <div class="flex-col gap-xs" id="otp-field" style="display:none;">
          <label class="font-bold">One-time code</label>
          <input type="text" id="login-otp" inputmode="numeric" maxlength="6" placeholder="Enter 6-digit code"
                 style="padding:1rem; border-radius:var(--radius-md); border:2px solid var(--clr-border); font-size:1.125rem; letter-spacing:0.25em;">
        </div>
        <p id="login-status" class="text-muted" style="font-size:0.8125rem; text-align:center; margin:0;"></p>
        <button id="btn-request-otp" class="btn btn-primary btn-lg" style="width:100%;">
          Send Verification Code
          <span class="material-symbols-rounded">mail</span>
        </button>
        <button id="btn-login" class="btn btn-primary btn-lg" style="width:100%; display:none;">
          Verify &amp; Login
          <span class="material-symbols-rounded">lock_open</span>
        </button>
    </div>
  `;

  let requestedEmail = '';
  const emailInput = document.getElementById('login-email');
  const otpInput = document.getElementById('login-otp');
  const statusEl = document.getElementById('login-status');
  const requestBtn = document.getElementById('btn-request-otp');
  const loginBtn = document.getElementById('btn-login');

  requestBtn.onclick = async () => {
    const email = emailInput.value.trim();
    if (!email) {
      statusEl.textContent = 'Please enter your email address.';
      statusEl.style.color = 'var(--clr-danger)';
      emailInput.focus();
      return;
    }

    requestBtn.innerHTML = 'Sending code… <span class="material-symbols-rounded">hourglass_top</span>';
    requestBtn.disabled = true;
    statusEl.textContent = '';
    statusEl.style.color = '';

    try {
      const data = await AuthService.requestOtp(email);
      requestedEmail = email;
      document.getElementById('otp-field').style.display = 'flex';
      loginBtn.style.display = 'flex';
      requestBtn.innerHTML = 'Resend Code <span class="material-symbols-rounded">mail</span>';
      requestBtn.disabled = false;
      statusEl.style.color = 'var(--clr-primary)';
      statusEl.textContent = data.delivery === 'console'
        ? '⚙️ Dev mode: check backend terminal for the code.'
        : '✅ Verification code sent — check your email.';
      otpInput.focus();
    } catch (e) {
      console.error(e);
      statusEl.style.color = 'var(--clr-danger)';
      statusEl.textContent = '❌ ' + e.message + ' — Could not connect to server.';
      requestBtn.innerHTML = 'Send Verification Code <span class="material-symbols-rounded">mail</span>';
      requestBtn.disabled = false;
    }
  };

  loginBtn.onclick = async () => {
    const otp = otpInput.value.trim();
    const email = requestedEmail || emailInput.value.trim();
    if (!otp) {
      statusEl.style.color = 'var(--clr-danger)';
      statusEl.textContent = 'Please enter the 6-digit verification code.';
      otpInput.focus();
      return;
    }

    loginBtn.innerHTML = 'Verifying… <span class="material-symbols-rounded">hourglass_top</span>';
    loginBtn.disabled = true;
    statusEl.textContent = '';

    try {
      await AuthService.verifyOtp(email, otp);
      statusEl.style.color = 'var(--clr-primary)';
      statusEl.textContent = '✅ Verified! Loading your dashboard…';
      window.location.reload();
    } catch (e) {
      console.error(e);
      statusEl.style.color = 'var(--clr-danger)';
      statusEl.textContent = '❌ ' + e.message;
      loginBtn.innerHTML = 'Verify &amp; Login <span class="material-symbols-rounded">lock_open</span>';
      loginBtn.disabled = false;
    }
  };

  document.getElementById('btn-reset-data').onclick = () => {
    if (confirm("This will delete all saved health data and start fresh. Continue?")) {
      localStorage.clear();
      window.location.reload();
    }
  };
}

// ── Onboarding UI ──────────────────────────────────────────────────────────────

function renderOnboarding() {
  const container = document.getElementById('page-root');
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('header').style.display  = 'none';
  document.getElementById('main-content').style.marginLeft = '0';
  document.getElementById('main-content').style.padding    = '0';

  container.innerHTML = `
    <div style="max-width:560px; margin: 5vh auto; padding: var(--space-xl);">
      <div style="text-align:center; margin-bottom:var(--space-xl);">
        <div class="sidebar-brand-icon" style="width:64px;height:64px;margin:0 auto var(--space-md);font-size:2rem;">
          <span class="material-symbols-rounded">health_and_safety</span>
        </div>
        <h2>Set up your health profile</h2>
        <p class="text-muted">This takes 2 minutes and personalises everything for you.</p>
      </div>

      <div class="card card-padded flex-col gap-md">
        <div class="grid-2" style="gap:var(--space-md);">
          <div class="flex-col gap-xs">
            <label class="font-bold">Full Name *</label>
            <input id="ob-name" type="text" placeholder="e.g. Priya Sharma"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
          <div class="flex-col gap-xs">
            <label class="font-bold">Age *</label>
            <input id="ob-age" type="number" min="1" max="120" placeholder="e.g. 65"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
        </div>
        <div class="grid-2" style="gap:var(--space-md);">
          <div class="flex-col gap-xs">
            <label class="font-bold">Blood Group</label>
            <select id="ob-blood" style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;background:var(--clr-surface);">
              <option value="">Select...</option>
              <option>A+</option><option>A-</option><option>B+</option><option>B-</option>
              <option>AB+</option><option>AB-</option><option>O+</option><option>O-</option>
            </select>
          </div>
          <div class="flex-col gap-xs">
            <label class="font-bold">Gender</label>
            <select id="ob-gender" style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;background:var(--clr-surface);">
              <option value="">Select...</option>
              <option>Male</option><option>Female</option><option>Other</option>
            </select>
          </div>
        </div>
        <div class="grid-2" style="gap:var(--space-md);">
          <div class="flex-col gap-xs">
            <label class="font-bold">Phone Number</label>
            <input id="ob-phone" type="tel" placeholder="+91 98765 43210"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
          <div class="flex-col gap-xs">
            <label class="font-bold">City</label>
            <input id="ob-city" type="text" placeholder="e.g. Lucknow"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
        </div>
        <div class="grid-2" style="gap:var(--space-md);">
          <div class="flex-col gap-xs">
            <label class="font-bold">State</label>
            <input id="ob-state" type="text" placeholder="e.g. Uttar Pradesh"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
          <div class="flex-col gap-xs">
            <label class="font-bold">Pincode</label>
            <input id="ob-pincode" type="text" inputmode="numeric" placeholder="e.g. 226001"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
        </div>
        <div class="grid-2" style="gap:var(--space-md);">
          <div class="flex-col gap-xs">
            <label class="font-bold">Disability Type</label>
            <input id="ob-disability-type" type="text" placeholder="Leave blank if not applicable"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
          <div class="flex-col gap-xs">
            <label class="font-bold">Disability Percentage</label>
            <input id="ob-disability-percent" type="number" min="0" max="100" placeholder="0"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
        </div>
        <div class="flex-col gap-xs">
          <label class="font-bold">Medical Conditions</label>
          <p class="text-muted" style="font-size:0.8rem;margin:0;">Separate with commas — e.g. Diabetes, Hypertension</p>
          <input id="ob-conditions" type="text" placeholder="e.g. Diabetes, Hypertension"
            style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
        </div>
        <div class="flex-col gap-xs">
          <label class="font-bold">Allergies</label>
          <input id="ob-allergies" type="text" placeholder="e.g. Penicillin (or leave blank)"
            style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
        </div>

        <hr style="border:none;border-top:1px solid var(--clr-border-light);margin:0.25rem 0;">
        <p class="font-bold" style="margin:0;">Baseline Health Details</p>

        <div class="grid-2" style="gap:var(--space-md);">
          <div class="flex-col gap-xs">
            <label class="font-bold">Blood Pressure Systolic</label>
            <input id="ob-bp-sys" type="number" min="60" max="240" placeholder="e.g. 120"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
          <div class="flex-col gap-xs">
            <label class="font-bold">Blood Pressure Diastolic</label>
            <input id="ob-bp-dia" type="number" min="40" max="160" placeholder="e.g. 80"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
        </div>
        <div class="grid-2" style="gap:var(--space-md);">
          <div class="flex-col gap-xs">
            <label class="font-bold">Fasting Blood Sugar</label>
            <input id="ob-sugar" type="number" min="40" max="500" placeholder="mg/dL"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
          <div class="flex-col gap-xs">
            <label class="font-bold">Heart Rate</label>
            <input id="ob-heart-rate" type="number" min="30" max="220" placeholder="bpm"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
        </div>
        <div class="grid-2" style="gap:var(--space-md);">
          <div class="flex-col gap-xs">
            <label class="font-bold">Oxygen Saturation</label>
            <input id="ob-spo2" type="number" min="50" max="100" placeholder="%"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
          <div class="flex-col gap-xs">
            <label class="font-bold">Weight</label>
            <input id="ob-weight" type="number" min="1" max="300" step="0.1" placeholder="kg"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
        </div>
        <div class="flex-col gap-xs">
          <label class="font-bold">Height</label>
          <input id="ob-height" type="number" min="30" max="250" placeholder="cm"
            style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
        </div>

        <hr style="border:none;border-top:1px solid var(--clr-border-light);margin:0.25rem 0;">
        <p class="font-bold" style="margin:0;">Emergency Contact</p>

        <div class="grid-2" style="gap:var(--space-md);">
          <div class="flex-col gap-xs">
            <label>Contact Name *</label>
            <input id="ob-ec-name" type="text" placeholder="e.g. Rahul Sharma"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
          <div class="flex-col gap-xs">
            <label>Relationship</label>
            <input id="ob-ec-relation" type="text" placeholder="e.g. Son, Daughter"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
        </div>
        <div class="flex-col gap-xs">
          <label>Contact Phone *</label>
          <input id="ob-ec-phone" type="tel" placeholder="+91 98765 43210"
            style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
        </div>

        <div id="ob-error" style="color:var(--clr-danger);font-size:0.875rem;display:none;padding:0.5rem;background:var(--clr-danger-light);border-radius:var(--radius-sm);"></div>

        <button id="btn-save-profile" class="btn btn-primary btn-lg" style="width:100%;margin-top:0.5rem;">
          Save &amp; Go to Dashboard
          <span class="material-symbols-rounded">arrow_forward</span>
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-save-profile').onclick = async () => {
    const name    = document.getElementById('ob-name').value.trim();
    const age     = document.getElementById('ob-age').value.trim();
    const ecName  = document.getElementById('ob-ec-name').value.trim();
    const ecPhone = document.getElementById('ob-ec-phone').value.trim();
    const errEl   = document.getElementById('ob-error');

    if (!name || !age || !ecName || !ecPhone) {
      errEl.textContent = 'Please fill in: Full Name, Age, Emergency Contact Name and Phone.';
      errEl.style.display = 'block';
      return;
    }
    errEl.style.display = 'none';

    const btn = document.getElementById('btn-save-profile');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    const profile = {
      name,
      age:                parseInt(age),
      phone:              document.getElementById('ob-phone').value.trim(),
      blood_group:        document.getElementById('ob-blood').value,
      gender:             document.getElementById('ob-gender').value,
      location: {
        city:    document.getElementById('ob-city').value.trim(),
        state:   document.getElementById('ob-state').value.trim(),
        pincode: document.getElementById('ob-pincode').value.trim(),
      },
      disability_type:       document.getElementById('ob-disability-type').value.trim(),
      disability_percentage: numberFromInput('ob-disability-percent') || 0,
      medical_conditions: document.getElementById('ob-conditions').value.split(',').map(s => s.trim()).filter(Boolean),
      allergies:          document.getElementById('ob-allergies').value.split(',').map(s => s.trim()).filter(Boolean),
      emergency_contacts: [{
        name:       ecName,
        relation:   document.getElementById('ob-ec-relation').value.trim() || 'Family',
        phone:      safePhone(ecPhone),
        is_primary: true,
      }],
      profile_completed: true,
      preferences:       {},
    };
    const health = buildInitialHealthData();

    try {
      const res = await fetch('/api/profile', {
        method:  'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ profile }),
      });
      if (!res.ok) throw new Error('Server returned ' + res.status);
      const data = await res.json();

      const hRes = await fetch('/api/health-data', {
        method:  'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ health }),
      });
      if (!hRes.ok) throw new Error('Health save returned ' + hRes.status);

      State.user = { ...State.user, ...data.profile };
      State.health = health;
      localStorage.setItem('civik_user_profile', JSON.stringify(State.user));

      document.getElementById('sidebar').style.display    = 'flex';
      document.getElementById('header').style.display     = 'flex';
      document.getElementById('main-content').style.marginLeft = '';
      document.getElementById('main-content').style.padding    = '';

      initUI();
    } catch (e) {
      console.error('[Onboarding]', e);
      if (e.message.includes('401')) {
        // Token is no longer valid — force re-login
        console.warn('[Onboarding] Token rejected — clearing session');
        AuthService.logout();
        return;
      }
      errEl.textContent = 'Could not save profile. Please check your internet connection.';
      errEl.style.display = 'block';
      btn.textContent = 'Save & Go to Dashboard';
      btn.disabled = false;
    }
  };
}
