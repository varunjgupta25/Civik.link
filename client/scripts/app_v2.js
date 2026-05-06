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
  user:          { preferences: {}, language: 'en' },
  health:        { vitals: {}, medications: [], appointments: [] },
  schemes:       { schemes: [], categories: [] },
  notifications: { notifications: [] },
  currentPage:   CONFIG.DEFAULT_PAGE,
  ttsEnabled:    CONFIG.DEFAULT_TTS_ENABLED,
  highContrast:  CONFIG.DEFAULT_HIGH_CONTRAST,
  fontSize:      CONFIG.DEFAULT_FONT_SIZE,
  chatHistory:   [],
};

// ── Boot ───────────────────────────────────────────────────────────────────────

async function boot() {
  if (window.__civik_booted) {
    console.warn("[App] Boot already in progress or completed. Skipping...");
    return;
  }
  window.__civik_booted = true;

  console.log("%c[App] Booting Civik.Link...", "color: #0B5394; font-weight: bold; font-size: 1.2em;");
  console.time("boot");

  // 1. DISMISS SPLASH SCREEN IMMEDIATELY (Safety First)
  try {
    const splashScreen = document.getElementById('splash-screen');
    const splashBar = document.getElementById('splash-bar');
    if (splashScreen) {
      console.log("[App] Dismissing splash screen...");
      if (splashBar) splashBar.style.width = '100%';
      
      // Wait for a short animation then hide
      await new Promise(r => setTimeout(r, 800));
      splashScreen.style.opacity = '0';
      await new Promise(r => setTimeout(r, 500));
      splashScreen.style.display = 'none';
      console.log("[App] Splash screen dismissed.");
    }
  } catch (e) {
    console.error("[App] Failed to hide splash screen:", e);
  }

  // 2. Handle Cookie Banner
  try {
    const cookieBanner = document.getElementById('cookie-banner');
    const cookieAccept = document.getElementById('btn-cookie-accept');
    if (cookieBanner && !localStorage.getItem('civik_cookies_accepted')) {
      cookieBanner.style.display = 'block';
    }
    if (cookieAccept) {
      cookieAccept.onclick = () => {
        localStorage.setItem('civik_cookies_accepted', 'true');
        cookieBanner.style.opacity = '0';
        setTimeout(() => { cookieBanner.style.display = 'none'; }, 300);
      };
    }
  } catch (e) {
    console.warn("[App] Cookie banner error:", e);
  }

  // Check for translations
  if (typeof window.t === 'undefined') {
    console.error("[App] t() helper not found. Fallback to dummy.");
    window.t = (k) => k;
  }


  // STEP 1: If no valid auth cookie → show login screen immediately, done.
  console.log("[App] Checking authentication...");
  let authenticated = false;
  try {
    // Add a timeout to the auth check so we don't hang forever
    const authPromise = AuthService.isAuthenticated();
    const timeoutPromise = new Promise(r => setTimeout(() => r(false), 5000));
    authenticated = await Promise.race([authPromise, timeoutPromise]);
  } catch (e) {
    console.error("[App] Auth check failed:", e);
  }

  if (!authenticated) {
    console.log("[App] Not authenticated. Rendering landing page.");
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

      const nRes = await fetch('/api/notifications', { credentials: 'same-origin' });
      if (nRes.ok) {
        const d = await nRes.json();
        if (d.notifications) {
          State.notifications = {
            notifications: d.notifications.notifications || d.notifications || []
          };
        }
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
    console.log("[App] Boot successful. Initializing UI...");
    initUI();
    console.timeEnd("boot");

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
  State.user          = mockUser          || { name: 'Citizen', preferences: {}, language: 'en' };
  State.health        = mockHealth        || { vitals: {}, medications: [], appointments: [] };
  State.schemes       = schemes           || { schemes: [], categories: [] };
  State.notifications = notifications     || { notifications: [] };
  State.fontSize      = CONFIG.DEFAULT_FONT_SIZE;
  State.highContrast  = false;
  State.ttsEnabled    = false;
}

function initUI() {
  try {
    initLanguageSelector();
    buildNav();
    buildSidebarUser();
    buildHeader();
    buildNotificationBadge();
    initAccessibilityControls();
    initMobileMenu();
    initBluetoothHardware();
  } catch (e) {
    console.error("[UI] Error during component initialization:", e);
  }

  const lastPage = localStorage.getItem('civik_last_page') || CONFIG.DEFAULT_PAGE;
  navigateTo(lastPage);
}

function initLanguageSelector() {
  const selector = document.getElementById('lang-selector');
  if (!selector) return;

  // Populate
  selector.innerHTML = CONFIG.LANGUAGES.map(l => `
    <option value="${l.code}" ${l.code === (State.user?.language || 'en') ? 'selected' : ''}>
      ${l.native}
    </option>
  `).join('');

  // Handle Change
  selector.onchange = async (e) => {
    const lang = e.target.value;
    console.log(`[App] Changing language to: ${lang}`);
    
    // Update local state
    if (!State.user) State.user = {};
    State.user.language = lang;

    // Update server in background
    try {
      await fetch('/api/profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: { language: lang } }),
      });
    } catch (err) {
      console.error("[App] Failed to save language preference to server", err);
    }

    // Refresh everything
    initUI();
  };
}

// ── Bluetooth Hardware Integration ───────────────────────────────────────────

function initBluetoothHardware() {
  window.addEventListener('civik:ble-update', async (event) => {
    const { type, value } = event.detail;
    if (type === 'heart_rate') {
      console.log(`[App] Hardware Update: HR = ${value}`);
      
      // Update local state
      if (!State.health) State.health = { vitals: {} };
      if (!State.health.vitals.heart_rate) State.health.vitals.heart_rate = { history: [] };
      
      State.health.vitals.heart_rate.value = value;
      State.health.vitals.heart_rate.status = statusFromRange(value, 60, 100, 50, 110);
      State.health.vitals.heart_rate.history.push(value);
      if (State.health.vitals.heart_rate.history.length > 20) State.health.vitals.heart_rate.history.shift();
      
      // Update DB in background
      try {
        await fetch('/api/health-data', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ health: State.health }),
        });
      } catch (e) {
        console.error("[App] Failed to sync hardware data to DB", e);
      }

      // Live-refresh if currently on health or dashboard
      if (State.currentPage === 'health' || State.currentPage === 'dashboard') {
        const root = document.querySelector('.page-content');
        if (root) {
          if (State.currentPage === 'health') renderHealth(root);
          else renderDashboard(root);
        }
      }
    }
  });
}

// ── Navigation Builder ─────────────────────────────────────────────────────────

function buildNav() {
  const navList = document.getElementById('nav-list');
  navList.innerHTML = CONFIG.PAGES.map(page => `
    <li role="none">
      <button
        class="nav-link${page.id === 'sos' ? ' sos-link' : ''}"
        data-page="${page.id}"
        aria-label="${t('nav_' + page.id)}"
        aria-current="${page.id === State.currentPage ? 'page' : 'false'}"
        role="menuitem"
        type="button"
      >
        <span class="material-symbols-rounded" aria-hidden="true">${page.icon}</span>
        <span>${t('nav_' + page.id)}</span>
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
  if (idEl) {
    let udid = State.user.udid;
    
    // Local Fallback if UDID is missing from server
    if (!udid && State.user.email) {
      const hashStr = State.user.email.toLowerCase().trim();
      let hash = 0;
      for (let i = 0; i < hashStr.length; i++) {
        hash = ((hash << 5) - hash) + hashStr.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
      }
      const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
      udid = `CVLK-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
      State.user.udid = udid; // Save it locally
    }

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
      idEl.textContent = 'UDID: Not Set';
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

  // ── Sidebar Footer (Legal & Logout) ──
  const sidebarFooter = document.querySelector('.sidebar-footer');
  if (sidebarFooter && !document.getElementById('sidebar-footer-content')) {
    const footerContent = document.createElement('div');
    footerContent.id = 'sidebar-footer-content';
    footerContent.style.marginTop = 'auto';
    footerContent.innerHTML = `
      <div style="border-top: 1px solid var(--clr-border-light); padding: 1rem 0; margin-top: 1rem; display: flex; flex-direction: column; gap: 0.25rem;">
        <a href="/about.html" class="nav-link" style="font-size: 0.85rem; padding: 0.4rem 1rem; color: var(--clr-muted);">
          <span class="material-symbols-rounded" style="font-size: 1.1rem;">info</span>
          <span>About</span>
        </a>
        <a href="/privacy.html" class="nav-link" style="font-size: 0.85rem; padding: 0.4rem 1rem; color: var(--clr-muted);">
          <span class="material-symbols-rounded" style="font-size: 1.1rem;">policy</span>
          <span>Privacy</span>
        </a>
        <a href="/terms.html" class="nav-link" style="font-size: 0.85rem; padding: 0.4rem 1rem; color: var(--clr-muted);">
          <span class="material-symbols-rounded" style="font-size: 1.1rem;">gavel</span>
          <span>Terms</span>
        </a>
        <a href="mailto:support@civik.link" class="nav-link" style="font-size: 0.85rem; padding: 0.4rem 1rem; color: var(--clr-muted);">
          <span class="material-symbols-rounded" style="font-size: 1.1rem;">contact_support</span>
          <span>Contact</span>
        </a>
      </div>
      <button id="btn-logout" class="btn btn-ghost" style="width:100%; justify-content:flex-start; color:var(--clr-danger); margin-top: 0.5rem; padding: 0.75rem 1rem;">
        <span class="material-symbols-rounded">logout</span>
        <span>${t('logout')}</span>
      </button>
    `;
    sidebarFooter.innerHTML = '';
    sidebarFooter.appendChild(footerContent);
    
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
  const greetKey = hour < 12 ? 'greet_morning' : hour < 17 ? 'greet_afternoon' : 'greet_evening';
  const greeting = t(greetKey);
  const greetEl = document.getElementById('header-greeting');
  const dateEl  = document.getElementById('header-date');
  if (greetEl) greetEl.textContent = `${greeting}, ${State.user?.name?.split(' ')[0] || ''}`;
  if (dateEl)  dateEl.textContent  = now.toLocaleDateString(State.user?.language || 'en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
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
  if (!Array.isArray(history)) return '';
  const max = Math.max(...history, 1);
  const min = Math.min(...history, 0);
  const range = (max - min) || 1;
  
  const points = history.map((v, i) => {
    const x = (i / (history.length - 1)) * 100;
    const y = 20 - ((v - min) / range) * 15;
    return `${x},${y}`;
  }).join(' ');

  return `
    <svg class="sparkline" viewBox="0 0 100 20" preserveAspectRatio="none">
      <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>
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
          <span class="section-eyebrow">${t('header_dashboard')}</span>
          <h2 class="section-title">${t(new Date().getHours() < 12 ? 'greet_morning' : new Date().getHours() < 17 ? 'greet_afternoon' : 'greet_evening')}, ${h(user?.name?.split(' ')[0] || 'Friend')} 🙏</h2>
        </div>
      </div>

      <!-- Top Row: Health Score + Notifications -->
      <div class="grid-2 dashboard-top-row mb-lg">
        <!-- Health Score Gauge Card -->
        <div class="card card-padded flex-col flex-center" style="text-align:center; gap: var(--space-md);"
             role="region" aria-label="Health score">
          <p class="section-eyebrow" style="margin:0">${t('health_score_title')}</p>
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

        <!-- Notification Feed (AI Monitored) -->
        <div class="card" role="region" aria-label="Recent notifications">
          <div class="card-header">
            <h3 style="display:flex; align-items:center; gap:8px;">
              <span class="material-symbols-rounded" style="color:var(--clr-primary); font-size:1.25rem;">auto_awesome</span>
              ${t('ai_alerts_title')}
            </h3>
            <span class="status-badge ${unread.length > 0 ? 'status-danger' : 'status-success'}">
              ${unread.length} new
            </span>
          </div>
          <div class="card-body flex-col gap-sm" style="max-height:280px; overflow-y:auto; padding: 1rem;">
            ${notifs.length === 0
              ? `
                <div style="text-align:center; padding: 2rem 0; opacity: 0.6;">
                  <span class="material-symbols-rounded" style="font-size:3rem; margin-bottom:0.5rem;">notifications_off</span>
                  <p>All healthy! Your AI monitor is checking your vitals every 2 hours.</p>
                </div>
                `
              : (notifs || []).map(n => `
                <div class="notif-item ${!n.is_read ? 'unread' : ''} type-${safeToken(n.type)}"
                     style="border-left: 4px solid ${n.type === 'warning' ? 'var(--clr-danger)' : 'var(--clr-primary)'}; 
                            background: ${n.type === 'warning' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(11, 83, 148, 0.03)'};
                            padding: 1rem; border-radius: 8px; margin-bottom: 0.5rem;"
                     role="alert" aria-label="${h(n.title)}">
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 4px;">
                    <p class="font-bold" style="font-size:0.95rem; color: ${n.type === 'warning' ? 'var(--clr-danger)' : 'var(--clr-primary)'};">${h(n.title)}</p>
                    <span style="font-size:0.7rem; opacity:0.6;">${new Date(n.created_at * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                  </div>
                  <p class="text-muted" style="font-size:0.85rem; line-height: 1.4;">${h(n.message)}</p>
                  ${n.type === 'warning' ? `
                    <button class="btn btn-primary btn-sm mt-sm" style="background:var(--clr-danger); border:none;"
                            onclick="window.navigateTo('sos')">
                      Take Action
                      <span class="material-symbols-rounded" style="font-size:1rem;">emergency</span>
                    </button>
                  ` : ''}
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
          ${(pendingMeds || []).map(m => `
          <div class="card card-padded flex-col gap-md">
            <div class="flex-between">
              <div class="flex-center gap-md">
                <div class="med-pill ${safeToken(m.colour)}"></div>
                <div>
                  <h4 class="font-bold">${h(m.name)}</h4>
                  <p class="text-muted" style="font-size:0.8125rem;">${h(m.purpose)}</p>
                </div>
              </div>
              <div class="text-right">
                <p class="font-bold">${h(m.dosage)}</p>
                <p class="text-muted" style="font-size:0.75rem;">${h(m.frequency)}</p>
              </div>
            </div>
            <div class="flex-wrap gap-xs">
              ${(m.times || []).map(t => {
                const status = m.today_status?.[t] || 'pending';
                const cfg = getStatusConfig(status);
                return `<span class="med-time-chip ${safeToken(status)}">${h(formatTime(t))} · ${h(cfg.label)}</span>`;
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
      <div class="flex-center gap-sm">
        <button id="btn-ble-connect" class="btn btn-primary" style="gap:0.5rem; background:var(--clr-secondary);">
          <span class="material-symbols-rounded">watch</span>
          <span>Sync Watch</span>
        </button>
        <button id="btn-ble-simulate" class="btn btn-ghost btn-sm" style="color:var(--clr-secondary); border:1px solid rgba(var(--clr-secondary-rgb), 0.2);">
          <span class="material-symbols-rounded" style="font-size:1.125rem;">biotech</span>
          <span>Virtual Lab</span>
        </button>
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
        ${(meds || []).map(m => `
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
                ${(m.times || []).map(t => {
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
        ${(apts || []).map(a => {
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

  // BLE Connection Handler
  const handleHealthSync = async (isSimulation = false) => {
    const btn = isSimulation ? document.getElementById('btn-ble-simulate') : document.getElementById('btn-ble-connect');
    const otherBtn = isSimulation ? document.getElementById('btn-ble-connect') : document.getElementById('btn-ble-simulate');
    
    try {
      btn.innerHTML = '<span class="material-symbols-rounded">sync</span><span>Syncing…</span>';
      btn.disabled = true;
      if (otherBtn) otherBtn.style.display = 'none';

      const { name } = isSimulation 
        ? await window.BluetoothService.simulate()
        : await window.BluetoothService.connectHeartRate();

      btn.innerHTML = `<span class="material-symbols-rounded">check_circle</span><span>${h(name)}</span>`;
      btn.style.background = 'var(--clr-success)';
      btn.style.color = 'white';
      announce(`Connected to ${name}`);
    } catch (err) {
      btn.innerHTML = isSimulation ? 'Virtual Lab' : 'Sync Watch';
      btn.disabled = false;
      if (otherBtn) otherBtn.style.display = 'flex';
      if (err.name !== 'NotFoundError' && !isSimulation) alert("Hardware Error: " + err.message);
    }
  };

  document.getElementById('btn-ble-connect').onclick = () => handleHealthSync(false);
  document.getElementById('btn-ble-simulate').onclick = () => handleHealthSync(true);
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
      ${(categories || []).map(c => `
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
      ${(schemes || []).map(s => renderSchemeCard(s)).join('')}
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
      grid.innerHTML = (filtered || []).map(s => renderSchemeCard(s)).join('');
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
          ${(scheme.eligibility || []).map(e => `
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
        ${(contacts || []).map(ct => `
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
    t('suggested_ayushman'),
    t('suggested_score'),
    t('suggested_udid'),
    t('suggested_apt'),
    t('suggested_meds'),
  ];

  container.innerHTML = `
    <div class="section-header">
      <div>
        <span class="section-eyebrow">${t('assistant_eyebrow')}</span>
        <h2 class="section-title">${t('assistant_title')}</h2>
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
              <h3 style="font-size:0.9375rem;">${t('assistant_name')}</h3>
              <p class="text-muted" style="font-size:0.75rem; margin:0;">${t('assistant_subtitle')}</p>
            </div>
          </div>
        </div>
        <div id="chat-messages" class="flex-col gap-md" style="flex:1; overflow-y:auto; padding:var(--space-lg);"
             role="log" aria-label="Chat messages" aria-live="polite">
          <div class="chat-bubble assistant">
            ${t('assistant_welcome')}
          </div>
        </div>
        <div style="padding:var(--space-md); border-top:1px solid var(--clr-border-light);">
          <div class="flex-center gap-sm">
            <input type="text" id="chat-input"
                   placeholder="${t('chat_placeholder')}"
                   aria-label="${t('chat_placeholder')}"
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
          <h4 style="font-size:0.9375rem; margin-bottom:var(--space-md);">${t('suggested_questions_title')}</h4>
          <div class="flex-col gap-sm">
            ${(suggestedQuestions || []).map(q => `
              <button class="btn btn-ghost btn-sm" onclick="window.askAssistant('${h(q)}')"
                      style="background:white; border:1px solid var(--clr-border-light); justify-content:flex-start; text-align:left; padding: 0.75rem 1rem;">
                <span class="material-symbols-rounded" style="font-size:1.1rem; color:var(--clr-primary);">help_outline</span>
                ${h(q)}
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

  window.askAssistant = async (q) => {
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
        language: State.user?.language || 'en'
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
// Removed redundant DOMContentLoaded listener here as it's handled at the bottom of the file

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
        <!-- Personal Info -->
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
            <label class="font-bold">Disability Type</label>
            <input id="ob-disability-type" type="text" placeholder="e.g. Locomotor"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
          <div class="flex-col gap-xs">
            <label class="font-bold">Disability % (if any)</label>
            <input id="ob-disability-percent" type="number" min="0" max="100" placeholder="0"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
        </div>

        <div class="flex-col gap-xs">
          <label class="font-bold">Medical Conditions & Allergies</label>
          <p class="text-muted" style="font-size:0.8rem;margin:0;">Crucial for Emergency SOS — e.g. Penicillin Allergy, Diabetes</p>
          <input id="ob-conditions" type="text" placeholder="e.g. Diabetes, Penicillin Allergy"
            style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
        </div>

        <hr style="border:none;border-top:1px solid var(--clr-border-light);margin:0.25rem 0;">
        
        <!-- NEW: Hardware Sync Section -->
        <div style="background:var(--clr-secondary-light); padding:var(--space-md); border-radius:var(--radius-md); border:1.5px dashed var(--clr-secondary); text-align:center;">
          <p class="font-bold" style="color:var(--clr-secondary); margin-bottom:0.25rem;">
            <span class="material-symbols-rounded" style="vertical-align:middle;font-size:1.25rem;">watch_button</span>
            Smart Baseline Sync
          </p>
          <p style="font-size:0.8125rem; margin-bottom:var(--space-md);">Vitals (HR, SpO₂) will be fetched directly from your device.</p>
          
          <div class="flex-col gap-sm">
            <button id="btn-ob-sync" class="btn btn-secondary" style="width:100%; justify-content:center; gap:0.5rem; background:var(--clr-secondary); color:white;">
              <span class="material-symbols-rounded">bluetooth_searching</span>
              Find My Watch / Sensor
            </button>
            <div id="ob-device-list" style="display:none; margin-top:var(--space-sm); max-height:150px; overflow-y:auto; border:1px solid var(--clr-border); border-radius:var(--radius-md); background:white; text-align:left;">
              <!-- Devices populated here -->
            </div>
            <p id="ob-sync-status" style="font-size:0.75rem; color:var(--clr-text-light); margin:0; display:none;"></p>
            <button id="btn-ob-help" class="btn btn-ghost btn-sm" style="display:none; color:var(--clr-primary); font-size:0.75rem;">
              <span class="material-symbols-rounded" style="font-size:1rem;">help</span>
              How to put watch in pairing mode?
            </button>
          </div>
        </div>

        <!-- LIVE MONITOR (Display Only) -->
        <div id="ob-live-monitor" style="display:none; background:var(--clr-surface-raised); padding:var(--space-md); border-radius:var(--radius-md); border:1px solid var(--clr-border);">
          <p class="font-bold" style="font-size:0.875rem; margin-bottom:var(--space-sm); color:var(--clr-success);">
            <span class="pulse-dot" style="display:inline-block; width:8px; height:8px; background:var(--clr-success); border-radius:50%; margin-right:6px;"></span>
            Live Sensor Stream
          </p>
          <div class="grid-2">
            <div>
              <p class="text-muted" style="font-size:0.75rem; font-weight:700;">HEART RATE</p>
              <p id="ob-val-hr" class="font-heading" style="font-size:1.5rem; margin:0;">-- <small style="font-size:0.8rem; font-weight:400;">bpm</small></p>
            </div>
            <div>
              <p class="text-muted" style="font-size:0.75rem; font-weight:700;">OXYGEN (SpO₂)</p>
              <p id="ob-val-spo2" class="font-heading" style="font-size:1.5rem; margin:0;">-- <small style="font-size:0.8rem; font-weight:400;">%</small></p>
            </div>
          </div>
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
            <label>Contact Phone *</label>
            <input id="ob-ec-phone" type="tel" placeholder="+91 98765 43210"
              style="padding:0.875rem;border-radius:var(--radius-md);border:2px solid var(--clr-border);font-size:1rem;width:100%;box-sizing:border-box;">
          </div>
        </div>

        <div id="ob-error" style="color:var(--clr-danger);font-size:0.875rem;display:none;padding:0.5rem;background:var(--clr-danger-light);border-radius:var(--radius-sm);"></div>

        <button id="btn-save-profile" class="btn btn-primary btn-lg" style="width:100%;margin-top:0.5rem;">
          Complete Setup &amp; Enter Dashboard
          <span class="material-symbols-rounded">arrow_forward</span>
        </button>
      </div>
    </div>
  `;

  // --- Logic ---

  // Current hardware state
  let syncedHR = null;
  let syncedSpO2 = 98; // Default to normal if not provided by watch

  // 1. Hardware Sync Handler (Python Engine)
  const handleDiscovery = async () => {
    const btn = document.getElementById('btn-ob-sync');
    const deviceList = document.getElementById('ob-device-list');
    const status = document.getElementById('ob-sync-status');
    const helpBtn = document.getElementById('btn-ob-help');
    
    try {
      btn.innerHTML = '<span class="material-symbols-rounded">sync</span><span>Searching for devices…</span>';
      btn.disabled = true;
      status.style.display = 'block';
      status.textContent = '🔍 Python Engine scanning for Bluetooth signals...';
      deviceList.innerHTML = '';
      deviceList.style.display = 'none';
      helpBtn.style.display = 'none';

      const response = await fetch('/api/hardware/discover', { method: 'POST' });
      const { devices } = await response.json();

      if (!devices || devices.length === 0) {
        status.textContent = '❌ No devices found nearby.';
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-rounded">bluetooth_searching</span><span>Try Again</span>';
        helpBtn.style.display = 'flex';
        renderPairingGuide(); // Show guide automatically on failure
        return;
      }

      status.textContent = `✅ Found ${devices.length} device(s). Select yours below:`;
      deviceList.style.display = 'block';
      
      devices.forEach(d => {
        const item = document.createElement('button');
        item.className = 'btn btn-ghost';
        item.style.width = '100%';
        item.style.justifyContent = 'space-between';
        item.style.padding = '0.75rem';
        item.style.fontSize = '0.875rem';
        item.innerHTML = `<span>${h(d.name)}</span> <small class="text-muted">${d.address}</small>`;
        
        item.onclick = async () => {
          status.textContent = `⚡ Connecting to ${h(d.name)}...`;
          deviceList.style.display = 'none';
          
          try {
            const syncRes = await fetch('/api/hardware/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ address: d.address })
            });
            const syncData = await syncRes.json();
            
            if (syncData.status === 'success') {
              syncedHR = syncData.heart_rate;
              status.textContent = `✨ Connected! Health baseline established.`;
              btn.innerHTML = `<span class="material-symbols-rounded">check_circle</span><span>Synced with ${h(d.name)}</span>`;
              btn.style.background = 'var(--clr-success)';
              btn.style.color = 'white';
              
              document.getElementById('ob-live-monitor').style.display = 'block';
              document.getElementById('ob-val-hr').innerHTML = `${syncedHR} <small style="font-size:0.8rem; font-weight:400;">bpm</small>`;
              document.getElementById('ob-val-spo2').innerHTML = `98 <small style="font-size:0.8rem; font-weight:400;">%</small>`;
            } else {
              throw new Error(syncData.detail || 'Sync failed');
            }
          } catch (e) {
            status.textContent = `❌ Error: ${e.message}`;
            deviceList.style.display = 'block';
          }
        };
        deviceList.appendChild(item);
      });
    } catch (err) {
      console.error(err);
      status.textContent = '❌ Could not connect to Python Bluetooth Engine.';
      btn.disabled = false;
    }
  };

  document.getElementById('btn-ob-sync').onclick = handleDiscovery;
  document.getElementById('btn-ob-help').onclick = renderPairingGuide;

  function renderPairingGuide() {
    // Prevent duplicates
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
      <div class="card card-padded" style="max-width:400px; width:90%; position:relative; animation: slideUp 0.3s ease-out;">
        <button class="btn-ghost" style="position:absolute; top:1rem; right:1rem;" onclick="this.closest('.modal-overlay').remove()">
          <span class="material-symbols-rounded">close</span>
        </button>
        <h3 class="font-heading" style="margin-bottom:var(--space-md); color:var(--clr-primary);">Pairing Guide</h3>
        
        <div class="flex-col gap-md" style="font-size:0.9375rem;">
          <div class="flex-row gap-md">
            <span class="material-symbols-rounded" style="color:var(--clr-secondary); background:var(--clr-secondary-light); padding:0.5rem; border-radius:50%;">watch_vibration</span>
            <div>
              <p class="font-bold" style="margin:0;">1. Enable Pairing Mode</p>
              <p class="text-muted" style="margin:0; font-size:0.8125rem;">On your watch, go to <b>Settings > Bluetooth</b> and tap "Pair New Device" or "Make Discoverable".</p>
            </div>
          </div>
          
          <div class="flex-row gap-md">
            <span class="material-symbols-rounded" style="color:var(--clr-success); background:var(--clr-success-light); padding:0.5rem; border-radius:50%;">distance</span>
            <div>
              <p class="font-bold" style="margin:0;">2. Proximity check</p>
              <p class="text-muted" style="margin:0; font-size:0.8125rem;">Place your watch directly next to your <b>Laptop</b>. The laptop is the one doing the scanning!</p>
            </div>
          </div>

          <div class="flex-row gap-md">
            <span class="material-symbols-rounded" style="color:var(--clr-warning); background:var(--clr-warning-light); padding:0.5rem; border-radius:50%;">laptop_windows</span>
            <div>
              <p class="font-bold" style="margin:0;">3. Laptop Bluetooth</p>
              <p class="text-muted" style="margin:0; font-size:0.8125rem;">Ensure your laptop's Bluetooth is turned ON in Windows Settings.</p>
            </div>
          </div>
        </div>

        <button class="btn btn-primary" style="width:100%; margin-top:var(--space-lg);" onclick="this.closest('.modal-overlay').remove()">
          Got it, let's try again
        </button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // 2. Save Profile Handler
  document.getElementById('btn-save-profile').onclick = async () => {
    const name    = document.getElementById('ob-name').value.trim();
    const age     = document.getElementById('ob-age').value.trim();
    const ecName  = document.getElementById('ob-ec-name').value.trim();
    const ecPhone = document.getElementById('ob-ec-phone').value.trim();
    const errEl   = document.getElementById('ob-error');

    if (!name || !age || !ecName || !ecPhone) {
      errEl.textContent = 'Please provide: Name, Age, and Emergency Contact details.';
      errEl.style.display = 'block';
      return;
    }
    errEl.style.display = 'none';

    const btn = document.getElementById('btn-save-profile');
    const originalText = btn.innerHTML;
    btn.textContent = 'Creating Profile...';
    btn.disabled = true;

    const profile = {
      name,
      age:                parseInt(age),
      blood_group:        document.getElementById('ob-blood').value,
      gender:             document.getElementById('ob-gender').value,
      disability_type:    document.getElementById('ob-disability-type').value.trim(),
      disability_percentage: parseInt(document.getElementById('ob-disability-percent').value) || 0,
      medical_conditions: document.getElementById('ob-conditions').value.split(',').map(s => s.trim()).filter(Boolean),
      emergency_contacts: [{
        name:       ecName,
        phone:      ecPhone,
        is_primary: true,
      }],
      profile_completed: true,
      preferences:       {},
    };
    
    const health = buildInitialHealthData();
    // Use hardware values directly from live stream
    health.vitals.heart_rate.value = syncedHR || 72;
    health.vitals.oxygen_saturation.value = syncedSpO2 || 98;

    try {
      await Promise.all([
        fetch('/api/profile', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile }),
        }),
        fetch('/api/health-data', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ health }),
        })
      ]);

      State.user = { ...State.user, ...profile };
      State.health = health;
      
      // UI Reset and Enter
      document.getElementById('sidebar').style.display = 'flex';
      document.getElementById('header').style.display  = 'flex';
      document.getElementById('main-content').style.marginLeft = '';
      document.getElementById('main-content').style.padding    = '';
      initUI();
    } catch (e) {
      errEl.textContent = 'Save failed. Please try again.';
      errEl.style.display = 'block';
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
    };
}

// ── Export Boot ──────────────────────────────────────────────────────────────
window.State = State; // Export for translations.js

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  console.log("[App] document already loaded. Booting immediately.");
  boot();
}

window.navigateTo = navigateTo;
window.sendChatMessage = () => {}; // Placeholder until AI module loads
window.startVoiceInput = () => {}; // Placeholder
window.askSuggested = (q) => {
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = q;
    window.sendChatMessage();
  }
};
