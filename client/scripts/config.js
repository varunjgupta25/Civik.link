/**
 * civik.link — Application Configuration
 * All app-wide settings live here — never hardcoded in components
 */

const CONFIG = {

  // ── Data Source ────────────────────────────────────────────────────────────
  USE_MOCK_DATA: false,
  API_BASE_URL: '/api',  // Used when USE_MOCK_DATA = false
  MOCK_BASE_PATH: './mock',

  // ── App Identity ───────────────────────────────────────────────────────────
  APP_NAME: 'civik.link',
  APP_TAGLINE: 'Empowering Every Citizen',
  APP_VERSION: '1.0.0',

  // ── Navigation Pages ───────────────────────────────────────────────────────
  // Add/remove pages here — the router and nav bar update automatically
  PAGES: [
    { id: 'dashboard', label: 'Dashboard',         icon: 'home',             ariaLabel: 'Go to Dashboard' },
    { id: 'health',    label: 'Health Hub',         icon: 'medical_services', ariaLabel: 'Go to Health Hub' },
    { id: 'schemes',   label: 'Govt. Schemes',      icon: 'account_balance',  ariaLabel: 'Go to Government Schemes' },
    { id: 'sos',       label: 'Emergency SOS',      icon: 'sos',              ariaLabel: 'Go to Emergency SOS' },
    { id: 'assistant', label: 'AI Assistant',       icon: 'smart_toy',        ariaLabel: 'Go to AI Assistant' },
    { id: 'caregiver', label: 'Caregiver View',     icon: 'group',            ariaLabel: 'Go to Caregiver Connect' },
  ],

  DEFAULT_PAGE: 'dashboard',

  // ── Accessibility Defaults ─────────────────────────────────────────────────
  // These are overridden by user preferences loaded from profile
  FONT_SIZES: {
    small:  { label: 'Small',  rootRem: '14px' },
    medium: { label: 'Medium', rootRem: '16px' },
    large:  { label: 'Large',  rootRem: '19px' },
  },
  DEFAULT_FONT_SIZE: 'medium',
  DEFAULT_HIGH_CONTRAST: false,
  DEFAULT_TTS_ENABLED: false,

  // ── Health Thresholds ──────────────────────────────────────────────────────
  // Used to determine vital status badges — not hardcoded per component
  HEALTH_THRESHOLDS: {
    blood_pressure: {
      systolic:  { normal: [90, 120],   borderline: [121, 140], high: [141, 999] },
      diastolic: { normal: [60, 80],    borderline: [81, 90],   high: [91, 999] }
    },
    blood_sugar: {
      fasting:   { normal: [70, 100],   borderline: [101, 125], high: [126, 999] },
      post_meal: { normal: [70, 140],   borderline: [141, 199], high: [200, 999] }
    },
    heart_rate: {
      value:     { low: [0, 59],        normal: [60, 100],      high: [101, 999] }
    },
    oxygen_saturation: {
      value:     { low: [0, 94],        normal: [95, 100] }
    }
  },

  // ── Status Labels ──────────────────────────────────────────────────────────
  STATUS_LABELS: {
    normal:        { label: 'Normal',        class: 'status-normal' },
    borderline:    { label: 'Borderline',    class: 'status-warning' },
    slightly_high: { label: 'Slightly High', class: 'status-warning' },
    high:          { label: 'High — Alert',  class: 'status-danger' },
    low:           { label: 'Low — Alert',   class: 'status-danger' },
    taken:         { label: 'Taken ✓',       class: 'status-normal' },
    pending:       { label: 'Pending',       class: 'status-warning' },
    missed:        { label: 'Missed',        class: 'status-danger' },
    enrolled:      { label: 'Enrolled',      class: 'status-normal' },
    not_applied:   { label: 'Apply Now',     class: 'status-info' },
    not_applicable:{ label: 'Not Eligible',  class: 'status-muted' },
    confirmed:     { label: 'Confirmed',     class: 'status-normal' },
    cancelled:     { label: 'Cancelled',     class: 'status-danger' },
  },

  // ── Health Score Bands ─────────────────────────────────────────────────────
  HEALTH_SCORE_BANDS: [
    { min: 0,  max: 40, label: 'Poor',      class: 'score-poor' },
    { min: 41, max: 60, label: 'Fair',      class: 'score-fair' },
    { min: 61, max: 75, label: 'Good',      class: 'score-good' },
    { min: 76, max: 89, label: 'Very Good', class: 'score-very-good' },
    { min: 90, max: 100,label: 'Excellent', class: 'score-excellent' },
  ],

  // ── TTS Voice Settings ─────────────────────────────────────────────────────
  TTS: {
    lang: 'hi-IN',        // Default Hindi, matches user preference
    rate: 0.9,
    pitch: 1.0,
    volume: 1.0,
  },

};

export default CONFIG;
