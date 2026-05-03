/**
 * civik.link — Storage Service
 * Handles all local persistence for user profiles using localStorage.
 * This replaces the Firebase/Firestore implementation to allow a login-free experience.
 */
const STORAGE_KEY = 'civik_user_profile';

export const StorageService = {

  /**
   * Fetches the user profile from LocalStorage.
   * Returns null if no profile exists yet.
   */
  async getUserProfile() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (err) {
      console.error("[StorageService] Error getting profile from localStorage:", err);
      return null;
    }
  },

  /**
   * Saves the entire user profile (onboarding data, etc.)
   */
  async saveUserProfile(uid, profileData) {
    try {
      // Note: uid is kept for signature compatibility with boot() logic if needed
      const dataToSave = {
        ...profileData,
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
      console.log("[StorageService] Profile saved to localStorage.");
      return true;
    } catch (err) {
      console.error("[StorageService] Error saving profile to localStorage:", err);
      throw err;
    }
  },

  /**
   * Specifically updates the emergency contacts list
   */
  async updateEmergencyContacts(uid, contacts) {
    try {
      const existing = await this.getUserProfile();
      if (existing) {
        existing.emergency_contacts = contacts;
        return this.saveUserProfile(uid, existing);
      }
      return false;
    } catch (err) {
      console.error("[StorageService] Error updating contacts:", err);
      throw err;
    }
  }
};

export default StorageService;
