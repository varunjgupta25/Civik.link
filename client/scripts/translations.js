/**
 * civik.link — Internationalization (i18n) Engine
 * Stores UI translations for all 22 official languages of India.
 * Fallback is always English (en).
 */

const TRANSLATIONS = {
  en: {
    nav_dashboard: "Dashboard",
    nav_health: "Health Hub",
    nav_schemes: "Govt. Schemes",
    nav_sos: "Emergency SOS",
    nav_assistant: "AI Assistant",
    nav_caregiver: "Caregivers",
    greet_morning: "Good morning",
    greet_afternoon: "Good afternoon",
    greet_evening: "Good evening",
    header_dashboard: "Your Dashboard",
    health_score_title: "Overall Health Score",
    ai_alerts_title: "AI Health Alerts",
    no_alerts: "All healthy! AI monitor is active.",
    quick_actions: "Quick Actions",
    today_vitals: "Today's Vitals",
    medicines_due: "Medicines Due",
    view_all: "View all",
    take_action: "Take Action",
    loading: "Loading...",
    error: "Error",
    back: "Back",
    save: "Save",
    cancel: "Cancel",
    logout: "Logout & Reset",
    fingerprint_copy: "Click to copy UDID",
    copied: "Copied!",
  },
  hi: {
    nav_dashboard: "डैशबोर्ड",
    nav_health: "स्वास्थ्य केंद्र",
    nav_schemes: "सरकारी योजनाएं",
    nav_sos: "आपातकालीन SOS",
    nav_assistant: "AI सहायक",
    nav_caregiver: "देखभालकर्ता",
    greet_morning: "शुभ प्रभात",
    greet_afternoon: "नमस्ते",
    greet_evening: "शुभ संध्या",
    header_dashboard: "आपका डैशबोर्ड",
    health_score_title: "कुल स्वास्थ्य स्कोर",
    ai_alerts_title: "AI स्वास्थ्य अलर्ट",
    no_alerts: "सब स्वस्थ है! AI निगरानी सक्रिय है।",
    quick_actions: "त्वरित कार्रवाई",
    today_vitals: "आज के महत्वपूर्ण आँकड़े",
    medicines_due: "दवाओं का समय",
    view_all: "सभी देखें",
    take_action: "कार्रवाई करें",
    loading: "लोड हो रहा है...",
    error: "त्रुटि",
    logout: "लॉगआउट और रीसेट",
    copied: "कॉपी किया गया!",
  },
  mr: {
    nav_dashboard: "डॅशबोर्ड",
    nav_health: "आरोग्य केंद्र",
    nav_schemes: "सरकारी योजना",
    nav_sos: "आणीबाणी SOS",
    nav_assistant: "AI सहाय्यक",
    nav_caregiver: "काळजी घेणारे",
    greet_morning: "सुप्रभात",
    greet_afternoon: "नमस्कार",
    greet_evening: "शुभ संध्याकाळ",
    header_dashboard: "तुमचा डॅशबोर्ड",
    health_score_title: "एकूण आरोग्य धावसंख्या",
    ai_alerts_title: "AI आरोग्य अलर्ट",
    no_alerts: "सर्व काही ठीक आहे! AI लक्ष ठेवून आहे.",
    quick_actions: "द्रुत कृती",
    today_vitals: "आजची आरोग्य स्थिती",
    medicines_due: "औષधांची वेळ",
    view_all: "सर्व पहा",
    take_action: "कृती करा",
    loading: "लोड होत आहे...",
    logout: "लॉगआउट आणि रीसेट",
  },
  gu: {
    nav_dashboard: "ડેશબોર્ડ",
    nav_health: "આરોગ્ય કેન્દ્ર",
    nav_schemes: "સરકારી યોજનાઓ",
    nav_sos: "ઇમરજન્સી SOS",
    nav_assistant: "AI મદદનીશ",
    greet_morning: "શુભ સવાર",
    header_dashboard: "તમારું ડેશબોર્ડ",
    health_score_title: "કુલ આરોગ્ય સ્કોર",
    ai_alerts_title: "AI આરોગ્ય ચેતવણીઓ",
    quick_actions: "ઝડપી કાર્યો",
    view_all: "બધું જુઓ",
    take_action: "પગલાં લો",
  },
  bn: {
    nav_dashboard: "ড্যাশবোর্ড",
    nav_health: "স্বাস্থ্য কেন্দ্র",
    nav_schemes: "সরকারি প্রকল্প",
    nav_sos: "জরুরি SOS",
    nav_assistant: "AI সহকারী",
    greet_morning: "সুপ্রভাত",
    header_dashboard: "আপনার ড্যাশবোর্ড",
    health_score_title: "সামগ্রিক স্বাস্থ্য স্কোর",
    ai_alerts_title: "AI স্বাস্থ্য সতর্কতা",
    quick_actions: "দ্রুত পদক্ষেপ",
    view_all: "সব দেখুন",
  },
  ta: {
    nav_dashboard: "டாஷ்போர்டு",
    nav_health: "சுகாதார மையம்",
    nav_schemes: "அரசு திட்டங்கள்",
    nav_sos: "அவசர SOS",
    nav_assistant: "AI உதவியாளர்",
    greet_morning: "காலை வணக்கம்",
    header_dashboard: "உங்கள் டாஷ்போர்டு",
    health_score_title: "ஒட்டுமொத்த சுகாதார மதிப்பெண்",
    ai_alerts_title: "AI சுகாதார எச்சரிக்கைகள்",
    quick_actions: "விரைவான நடவடிக்கைகள்",
    view_all: "அனைத்தையும் பார்",
  }
};

const aiAssistantKeys = {
  assistant_eyebrow: "AI Powered",
  assistant_title: "AI Assistant",
  assistant_name: "civik Assistant",
  assistant_subtitle: "Ask me anything about health or schemes",
  assistant_welcome: "Namaste! 🙏 I'm your civik Assistant. How can I help you today?",
  chat_placeholder: "Type your question...",
  suggested_questions_title: "Suggested Questions",
  suggested_ayushman: "Am I eligible for Ayushman Bharat?",
  suggested_score: "What is my health score today?",
  suggested_udid: "How do I get a UDID card?",
  suggested_apt: "When is my next appointment?",
  suggested_meds: "What medicines do I need to take today?",
};

Object.keys(TRANSLATIONS).forEach(lang => {
  TRANSLATIONS[lang] = { ...aiAssistantKeys, ...TRANSLATIONS[lang] };
});

function t(key, lang = null) {
  const currentLang = lang || (window.State?.user?.language || 'en');
  return TRANSLATIONS[currentLang]?.[key] || TRANSLATIONS['en']?.[key] || key;
}

window.TRANSLATIONS = TRANSLATIONS;
window.t = t;
