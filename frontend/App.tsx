import React, { useState, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  StyleSheet, Text, View, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Image, Platform,
  TextInput, KeyboardAvoidingView, Modal,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

// --- CONFIGURATION ---
const YOUR_LAPTOP_IP = '192.168.1.88';
const BASE_URL = `http://${YOUR_LAPTOP_IP}:8000/api`;

// --- PREFERENCE OPTIONS (Irish-market focused) ---
const CUISINE_OPTIONS = [
  'Irish Traditional', 'Irish-Chinese', 'Irish-Indian', 'Irish-Italian',
  'Italian', 'Mexican', 'American BBQ', 'Mediterranean', 'Asian Fusion',
  'French', 'Middle Eastern', 'Thai', 'Japanese', 'Indian', 'Chinese',
  'Spanish', 'Greek', 'Anything Goes',
];

const DIETARY_OPTIONS = [
  'No Restrictions', 'Vegetarian', 'Vegan', 'Pescatarian',
  'Keto / Low-Carb', 'Paleo', 'Diabetic-Friendly', 'Low-Fat',
  'High-Protein', 'Halal', 'Kosher',
];

const ALLERGY_OPTIONS = [
  'None', 'Peanuts', 'Tree Nuts', 'Shellfish', 'Fish',
  'Dairy / Lactose', 'Gluten / Wheat (Coeliac)', 'Eggs', 'Soy', 'Sesame',
];

const CALORIE_PRESETS = [1200, 1500, 1800, 2000, 2500, 3000];
const COOKING_SKILLS = ['Beginner', 'Intermediate', 'Chef Level'];

// --- TYPES ---
type Screen =
  | 'home' | 'camera' | 'preview' | 'ingredients'
  | 'recipeSelect' | 'recipeDetail'
  | 'savedList' | 'savedDetail'
  | 'auth' | 'profile' | 'changePassword'
  | 'mealPlanCreate' | 'mealPlanView' | 'mealPlanList' | 'mealMealDetail';

type AuthSubMode = 'login' | 'register' | 'forgotStep1' | 'forgotStep2';

interface Recipe {
  title: string;
  description?: string;
  ingredients: string[];
  steps: string[];
  calories?: number;
  servings?: number;
  prep_time?: string;
  cook_time?: string;
}

interface SavedRecipe extends Recipe {
  savedAt: string;
  backendId?: number;
  category?: 'breakfast' | 'lunch' | 'dinner';
}

interface MealPlanMeal {
  id: number;
  meal_type: 'breakfast' | 'lunch' | 'dinner';
  title: string;
  description: string;
  calories: number | null;
  servings: number | null;
  prep_time: string;
  cook_time: string;
  ingredients: string[];
  steps: string[];
  saved_recipe: number | null;
}

interface MealPlanDay {
  id: number;
  day_number: number;
  meals: MealPlanMeal[];
}

interface MealPlan {
  id: number;
  name: string;
  duration_days: number;
  created_at: string;
  days: MealPlanDay[];
}

interface Preferences {
  cuisines: string[];
  dietary: string[];
  allergies: string[];
  calorieGoal: number;
  cookingSkill: string;
  customText: string;
}

const DEFAULT_PREFS: Preferences = {
  cuisines: [],
  dietary: [],
  allergies: [],
  calorieGoal: 2000,
  cookingSkill: 'Intermediate',
  customText: '',
};

const normalizePreferenceList = (items: unknown): string[] => {
  if (!Array.isArray(items)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  items.forEach(item => {
    const cleaned = String(item ?? '').trim();
    if (!cleaned) return;

    const dedupeKey = cleaned.toLowerCase();
    if (seen.has(dedupeKey)) return;

    seen.add(dedupeKey);
    normalized.push(cleaned);
  });

  return normalized;
};

const parsePreferenceCsv = (value: unknown): string[] =>
  normalizePreferenceList(
    typeof value === 'string' ? value.split(',') : []
  );

const normalizePreferences = (prefs: Partial<Preferences> | null | undefined): Preferences => ({
  cuisines: normalizePreferenceList(prefs?.cuisines ?? []),
  dietary: normalizePreferenceList(prefs?.dietary ?? []),
  allergies: normalizePreferenceList(prefs?.allergies ?? []),
  calorieGoal: typeof prefs?.calorieGoal === 'number' && prefs.calorieGoal > 0
    ? prefs.calorieGoal
    : DEFAULT_PREFS.calorieGoal,
  cookingSkill: typeof prefs?.cookingSkill === 'string' && prefs.cookingSkill.trim()
    ? prefs.cookingSkill.trim()
    : DEFAULT_PREFS.cookingSkill,
  customText: typeof prefs?.customText === 'string' ? prefs.customText : DEFAULT_PREFS.customText,
});

type ListPreferenceKey = 'cuisines' | 'dietary' | 'allergies';

const ToggleChip = ({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity
    style={[styles.chip, selected && styles.chipSelected]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
  </TouchableOpacity>
);

interface PreferencesSectionProps {
  compact?: boolean;
  preferences: Preferences;
  customCuisineText: string;
  customDietaryText: string;
  customAllergyText: string;
  customCalorieText: string;
  setCustomCuisineText: (value: string) => void;
  setCustomDietaryText: (value: string) => void;
  setCustomAllergyText: (value: string) => void;
  setCustomCalorieText: (value: string) => void;
  updatePref: (key: keyof Preferences, value: Preferences[keyof Preferences]) => void;
  toggleList: (list: string[], value: string) => string[];
  addCustomPrefItem: (
    key: ListPreferenceKey,
    value: string,
    clearFn: () => void,
  ) => void;
}

const PreferencesSection = ({
  compact = false,
  preferences,
  customCuisineText,
  customDietaryText,
  customAllergyText,
  customCalorieText,
  setCustomCuisineText,
  setCustomDietaryText,
  setCustomAllergyText,
  setCustomCalorieText,
  updatePref,
  toggleList,
  addCustomPrefItem,
}: PreferencesSectionProps) => (
  <View>
    <Text style={styles.prefsSectionTitle}>Cuisine Style</Text>
    <View style={styles.chipRow}>
      {preferences.cuisines
        .filter(c => !CUISINE_OPTIONS.includes(c))
        .map(c => (
          <ToggleChip
            key={c}
            label={c}
            selected
            onPress={() => updatePref('cuisines', preferences.cuisines.filter(x => x !== c))}
          />
        ))}
      {CUISINE_OPTIONS.map(c => (
        <ToggleChip
          key={c}
          label={c}
          selected={preferences.cuisines.includes(c)}
          onPress={() => updatePref('cuisines', toggleList(preferences.cuisines, c))}
        />
      ))}
    </View>
    <View style={styles.inputRow}>
      <TextInput
        style={styles.input}
        placeholder="Add custom cuisine..."
        value={customCuisineText}
        onChangeText={setCustomCuisineText}
        onSubmitEditing={() => addCustomPrefItem('cuisines', customCuisineText, () => setCustomCuisineText(''))}
      />
      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => addCustomPrefItem('cuisines', customCuisineText, () => setCustomCuisineText(''))}
      >
        <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 20 }}>+</Text>
      </TouchableOpacity>
    </View>

    <Text style={styles.prefsSectionTitle}>Dietary</Text>
    <View style={styles.chipRow}>
      {preferences.dietary
        .filter(d => !DIETARY_OPTIONS.includes(d))
        .map(d => (
          <ToggleChip
            key={d}
            label={d}
            selected
            onPress={() => updatePref('dietary', preferences.dietary.filter(x => x !== d))}
          />
        ))}
      {DIETARY_OPTIONS.map(d => (
        <ToggleChip
          key={d}
          label={d}
          selected={preferences.dietary.includes(d)}
          onPress={() => updatePref('dietary', toggleList(preferences.dietary, d))}
        />
      ))}
    </View>
    <View style={styles.inputRow}>
      <TextInput
        style={styles.input}
        placeholder="Add custom dietary requirement..."
        value={customDietaryText}
        onChangeText={setCustomDietaryText}
        onSubmitEditing={() => addCustomPrefItem('dietary', customDietaryText, () => setCustomDietaryText(''))}
      />
      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => addCustomPrefItem('dietary', customDietaryText, () => setCustomDietaryText(''))}
      >
        <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 20 }}>+</Text>
      </TouchableOpacity>
    </View>

    <Text style={styles.prefsSectionTitle}>Allergies & Intolerances</Text>
    <View style={styles.chipRow}>
      {preferences.allergies
        .filter(a => !ALLERGY_OPTIONS.includes(a))
        .map(a => (
          <ToggleChip
            key={a}
            label={a}
            selected
            onPress={() => updatePref('allergies', preferences.allergies.filter(x => x !== a))}
          />
        ))}
      {ALLERGY_OPTIONS.map(a => (
        <ToggleChip
          key={a}
          label={a}
          selected={preferences.allergies.includes(a)}
          onPress={() => updatePref('allergies', toggleList(preferences.allergies, a))}
        />
      ))}
    </View>
    <View style={styles.inputRow}>
      <TextInput
        style={styles.input}
        placeholder="Add custom allergy..."
        value={customAllergyText}
        onChangeText={setCustomAllergyText}
        onSubmitEditing={() => addCustomPrefItem('allergies', customAllergyText, () => setCustomAllergyText(''))}
      />
      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => addCustomPrefItem('allergies', customAllergyText, () => setCustomAllergyText(''))}
      >
        <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 20 }}>+</Text>
      </TouchableOpacity>
    </View>

    {!compact && (
      <>
        <Text style={styles.prefsSectionTitle}>Daily Calorie Goal</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="e.g. 2000"
            value={customCalorieText || String(preferences.calorieGoal)}
            onChangeText={t => {
              setCustomCalorieText(t);
              const calorieValue = parseInt(t, 10);
              if (!isNaN(calorieValue) && calorieValue > 0) updatePref('calorieGoal', calorieValue);
            }}
            keyboardType="number-pad"
          />
          <View style={[styles.addBtn, { backgroundColor: '#64748B', justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={{ color: 'white', fontSize: 11, fontWeight: '600', textAlign: 'center' }}>
              kcal
            </Text>
          </View>
        </View>

        <Text style={styles.prefsSectionTitle}>Cooking Skill</Text>
        <View style={styles.chipRow}>
          {COOKING_SKILLS.map(skill => (
            <ToggleChip
              key={skill}
              label={skill}
              selected={preferences.cookingSkill === skill}
              onPress={() => updatePref('cookingSkill', skill)}
            />
          ))}
        </View>

        <Text style={styles.prefsSectionTitle}>Instructions (optional)</Text>
        <TextInput
          style={[styles.input, { marginTop: 4, minHeight: 60, textAlignVertical: 'top', marginRight: 0 }]}
          placeholder="e.g. one-pot meals only, no spicy food..."
          value={preferences.customText}
          onChangeText={t => updatePref('customText', t)}
          multiline
        />
      </>
    )}
  </View>
);

// --- MAIN APP ---
function MainApp() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaLibraryPermission, requestMediaLibraryPermission] = ImagePicker.useMediaLibraryPermissions();

  // Navigation
  const [screen, setScreen] = useState<Screen>('home');
  const [screenHistory, setScreenHistory] = useState<Screen[]>([]);

  // Loading
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  // Camera / Photo
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  // Ingredients
  const [detectedIngredients, setDetectedIngredients] = useState<string[]>([]);
  const [newIngredientText, setNewIngredientText] = useState('');
  const [showPrefsModal, setShowPrefsModal] = useState(false);

  // Custom preference inputs
  const [customCuisineText, setCustomCuisineText] = useState('');
  const [customDietaryText, setCustomDietaryText] = useState('');
  const [customAllergyText, setCustomAllergyText] = useState('');
  const [customCalorieText, setCustomCalorieText] = useState('');
  const didInitPreferenceAutosave = useRef(false);
  const preferenceSyncTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openPrefsModal = () => setShowPrefsModal(true);
  const closePrefsModal = () => setShowPrefsModal(false);

  // Recipes
  const [generatedRecipes, setGeneratedRecipes] = useState<Recipe[]>([]);
  const [viewingRecipe, setViewingRecipe] = useState<SavedRecipe | Recipe | null>(null);

  // Saved
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipe[]>([]);
  const [savedSearch, setSavedSearch] = useState('');
  const [savedCategoryFilter, setSavedCategoryFilter] = useState<'all' | 'breakfast' | 'lunch' | 'dinner'>('all');

  // Recipe generation meal type
  const [recipeMealType, setRecipeMealType] = useState<'any' | 'breakfast' | 'lunch' | 'dinner'>('any');

  // Auth
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [authSubMode, setAuthSubMode] = useState<AuthSubMode>('login');
  const [authEmailInput, setAuthEmailInput] = useState('');
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Forgot password
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPass, setForgotNewPass] = useState('');
  const [forgotConfirmPass, setForgotConfirmPass] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [devToken, setDevToken] = useState('');

  // Meal plans
  const [mealPlans, setMealPlans] = useState<MealPlan[]>([]);
  const [viewingPlan, setViewingPlan] = useState<MealPlan | null>(null);
  const [viewingMeal, setViewingMeal] = useState<MealPlanMeal | null>(null);
  const [mealPlanDays, setMealPlanDays] = useState(3);
  const [mealPlanName, setMealPlanName] = useState('');
  const [mealPlanLoading, setMealPlanLoading] = useState(false);
  const [swapModalVisible, setSwapModalVisible] = useState(false);
  const [swapTargetMealId, setSwapTargetMealId] = useState<number | null>(null);
  const [swapSearch, setSwapSearch] = useState('');
  const [swapCategoryFilter, setSwapCategoryFilter] = useState<'all' | 'breakfast' | 'lunch' | 'dinner'>('all');

  // Profile
  const [profileLoading, setProfileLoading] = useState(false);

  // Change password
  const [cpOld, setCpOld] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpConfirm, setCpConfirm] = useState('');
  const [cpLoading, setCpLoading] = useState(false);
  const [cpError, setCpError] = useState('');

  // Preferences
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFS);

  const STORAGE_KEY = 'saved_recipes_v2';
  const PREFS_KEY = 'user_preferences';

  // --- Init ---
  useEffect(() => {
    (async () => {
      await Promise.all([loadSavedRecipes(), loadLocalPreferences(), loadAuthToken()]);
    })();
  }, []);

  useEffect(() => {
    if (!didInitPreferenceAutosave.current) {
      didInitPreferenceAutosave.current = true;
      return;
    }

    void saveLocalPreferences(preferences);

    if (!authToken) return;

    if (preferenceSyncTimeout.current) {
      clearTimeout(preferenceSyncTimeout.current);
    }

    preferenceSyncTimeout.current = setTimeout(() => {
      void syncPreferencesToBackend(preferences);
      preferenceSyncTimeout.current = null;
    }, 600);

    return () => {
      if (preferenceSyncTimeout.current) {
        clearTimeout(preferenceSyncTimeout.current);
        preferenceSyncTimeout.current = null;
      }
    };
  }, [preferences]);

  const loadSavedRecipes = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) setSavedRecipes(JSON.parse(stored));
    } catch {}
  };

  const loadLocalPreferences = async () => {
    try {
      const stored = await AsyncStorage.getItem(PREFS_KEY);
      if (stored) {
        const normalized = normalizePreferences(JSON.parse(stored));
        setPreferences(normalized);
        await saveLocalPreferences(normalized);
      }
    } catch {}
  };

  const saveLocalPreferences = async (prefs: Preferences) => {
    try { await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
  };

  const loadAuthToken = async () => {
    try {
      const token = await AsyncStorage.getItem('auth_token');
      const email = await AsyncStorage.getItem('auth_email');
      if (token && email) {
        setAuthToken(token);
        setAuthEmail(email);
        syncFromBackend(token);
        loadProfile(token);
        loadMealPlans(token);
      }
    } catch {}
  };

  // --- Navigation ---
  const navigate = (next: Screen) => {
    setScreenHistory(h => [...h, screen]);
    setScreen(next);
  };

  const goBack = () => {
    setScreenHistory(h => {
      if (h.length === 0) { setScreen('home'); return []; }
      const prev = h[h.length - 1];
      setScreen(prev);
      return h.slice(0, -1);
    });
  };

  const goHome = () => {
    setScreen('home');
    setScreenHistory([]);
    setPhotoUri(null);
    setDetectedIngredients([]);
    setGeneratedRecipes([]);
    setViewingRecipe(null);
    setIsCameraActive(false);
    setShowPrefsModal(false);
  };

  // --- Backend sync ---
  const syncFromBackend = async (token: string) => {
    try {
      const res = await fetch(`${BASE_URL}/recipes/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();

        // Read local cache directly from AsyncStorage (not state, which may not be
        // populated yet when this runs in parallel with loadSavedRecipes on startup).
        // This lets us preserve category/prep_time/cook_time that were stored locally
        // for recipes saved before those fields existed in the backend DB.
        let localCache: SavedRecipe[] = [];
        try {
          const stored = await AsyncStorage.getItem(STORAGE_KEY);
          if (stored) localCache = JSON.parse(stored);
        } catch {}

        const merged: SavedRecipe[] = data.map((r: any) => {
          const local = localCache.find((lr: SavedRecipe) => lr.backendId === r.id);
          return {
            title: r.title,
            description: r.description || undefined,
            ingredients: r.ingredients,
            steps: r.steps,
            calories: r.calories,
            servings: r.servings || undefined,
            prep_time: r.prep_time || local?.prep_time || undefined,
            cook_time: r.cook_time || local?.cook_time || undefined,
            category: (r.category || local?.category) as SavedRecipe['category'] | undefined,
            savedAt: r.created_at,
            backendId: r.id,
          };
        });
        setSavedRecipes(merged);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }
    } catch {}
  };

  // --- Auth ---
  const handleAuth = async () => {
    if (!authEmailInput.trim() || !authPasswordInput.trim()) {
      setAuthError('Please enter your email and password.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    try {
      const endpoint = authSubMode === 'register' ? 'auth/register/' : 'auth/login/';
      const res = await fetch(`${BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmailInput.trim().toLowerCase(), password: authPasswordInput }),
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (res.ok) {
        await AsyncStorage.setItem('auth_token', data.access);
        await AsyncStorage.setItem('auth_email', data.email);
        setAuthToken(data.access);
        setAuthEmail(data.email);
        setAuthEmailInput('');
        setAuthPasswordInput('');
        setAuthError('');
        syncFromBackend(data.access);
        loadProfile(data.access);
        loadMealPlans(data.access);
        setScreen('home');
        setScreenHistory([]);
      } else {
        const msg = typeof data === 'object'
          ? (data.error || data.email?.[0] || data.password?.[0] || JSON.stringify(data))
          : String(data);
        setAuthError(msg);
      }
    } catch (e: any) {
      clearTimeout(timeout);
      setAuthError(e?.name === 'AbortError'
        ? 'Request timed out. Check your internet connection and server.'
        : 'Connection error. Is the backend running?');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.multiRemove(['auth_token', 'auth_email']);
    setAuthToken(null);
    setAuthEmail(null);
    goHome();
  };

  // --- Forgot password ---
  const handleForgotRequest = async () => {
    if (!forgotEmail.trim()) { setForgotError('Please enter your email.'); return; }
    setForgotLoading(true);
    setForgotError('');
    try {
      const res = await fetch(`${BASE_URL}/auth/forgot-password/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (res.ok) {
        setDevToken(data.dev_token || '');
        setAuthSubMode('forgotStep2');
      } else {
        setForgotError(data.error || 'Something went wrong.');
      }
    } catch {
      setForgotError('Connection error.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleForgotReset = async () => {
    if (!forgotCode.trim() || !forgotNewPass || !forgotConfirmPass) {
      setForgotError('Please fill in all fields.'); return;
    }
    if (forgotNewPass !== forgotConfirmPass) {
      setForgotError('Passwords do not match.'); return;
    }
    if (forgotNewPass.length < 6) {
      setForgotError('Password must be at least 6 characters.'); return;
    }
    setForgotLoading(true);
    setForgotError('');
    try {
      const res = await fetch(`${BASE_URL}/auth/reset-password/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotEmail.trim().toLowerCase(),
          token: forgotCode.trim(),
          new_password: forgotNewPass,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Success', data.message || 'Password reset. Please sign in.');
        setAuthSubMode('login');
        setForgotEmail(''); setForgotCode(''); setForgotNewPass('');
        setForgotConfirmPass(''); setDevToken('');
      } else {
        setForgotError(data.error || 'Invalid or expired code.');
      }
    } catch {
      setForgotError('Connection error.');
    } finally {
      setForgotLoading(false);
    }
  };

  // --- Profile ---
  const loadProfile = async (token: string) => {
    try {
      const res = await fetch(`${BASE_URL}/auth/profile/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const prefs = normalizePreferences({
          cuisines: parsePreferenceCsv(data.cuisine_preferences),
          dietary: parsePreferenceCsv(data.dietary_restrictions),
          allergies: parsePreferenceCsv(data.allergies),
          calorieGoal: data.calorie_goal || 2000,
          cookingSkill: data.cooking_skill || 'Intermediate',
          customText: data.custom_preferences || '',
        });
        setPreferences(prefs);
        await saveLocalPreferences(prefs);
      }
    } catch {}
  };

  const syncPreferencesToBackend = async (prefs: Preferences) => {
    if (!authToken) return;
    setProfileLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/auth/profile/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          calorie_goal: prefs.calorieGoal,
          allergies: prefs.allergies.join(', '),
          dietary_restrictions: prefs.dietary.join(', '),
          cuisine_preferences: prefs.cuisines.join(', '),
          cooking_skill: prefs.cookingSkill,
          custom_preferences: prefs.customText,
        }),
      });
      if (res.ok) {
        await saveLocalPreferences(prefs);
      }
    } catch {
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!cpOld || !cpNew || !cpConfirm) { setCpError('Please fill in all fields.'); return; }
    if (cpNew !== cpConfirm) { setCpError('New passwords do not match.'); return; }
    if (cpNew.length < 6) { setCpError('Password must be at least 6 characters.'); return; }
    setCpLoading(true);
    setCpError('');
    try {
      const res = await fetch(`${BASE_URL}/auth/change-password/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ old_password: cpOld, new_password: cpNew }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Success', 'Password changed successfully.');
        setCpOld(''); setCpNew(''); setCpConfirm('');
        goBack();
      } else {
        setCpError(data.error || 'Failed to change password.');
      }
    } catch {
      setCpError('Connection error.');
    } finally {
      setCpLoading(false);
    }
  };

  // --- Recipes ---
  const saveRecipe = async (r: Recipe) => {
    try {
      let backendId: number | undefined;
      if (authToken) {
        const res = await fetch(`${BASE_URL}/recipes/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({
            title: r.title,
            description: r.description || '',
            ingredients: r.ingredients,
            steps: r.steps,
            calories: r.calories,
            servings: r.servings,
            prep_time: r.prep_time || '',
            cook_time: r.cook_time || '',
            category: recipeMealType !== 'any' ? recipeMealType : null,
          }),
        });
        if (res.ok) { const d = await res.json(); backendId = d.id; }
      }
      const category = recipeMealType !== 'any' ? recipeMealType : undefined;
      const entry: SavedRecipe = { ...r, savedAt: new Date().toISOString(), backendId, category };
      const updated = [...savedRecipes, entry];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setSavedRecipes(updated);
      Alert.alert('Saved!', `"${r.title}" saved${authToken ? ' to your account & device' : ' locally'}.`);
    } catch {
      Alert.alert('Error', 'Could not save recipe.');
    }
  };

  const deleteRecipe = async (savedAt: string) => {
    try {
      const target = savedRecipes.find(r => r.savedAt === savedAt);
      if (target?.backendId && authToken) {
        await fetch(`${BASE_URL}/recipes/${target.backendId}/`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      }
      const updated = savedRecipes.filter(r => r.savedAt !== savedAt);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setSavedRecipes(updated);
    } catch {
      Alert.alert('Error', 'Could not delete recipe.');
    }
  };

  const isRecipeSaved = (title: string) => savedRecipes.some(r => r.title === title);

  // --- Meal Plan API ---
  const generateMealPlan = async () => {
    if (!authToken) { Alert.alert('Sign In Required', 'Please sign in to generate meal plans.'); return; }
    setMealPlanLoading(true);
    setLoadingText('Building your meal plan...');
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/meal-plans/generate/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          duration_days: mealPlanDays,
          name: mealPlanName.trim() || `${mealPlanDays}-Day Meal Plan`,
          preferences,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setViewingPlan(data);
        setMealPlans(prev => [data, ...prev]);
        navigate('mealPlanView');
      } else {
        Alert.alert('Error', data.error || 'Failed to generate meal plan.');
      }
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setLoading(false);
      setMealPlanLoading(false);
    }
  };

  const loadMealPlans = async (tokenOverride?: string) => {
    const token = tokenOverride ?? authToken;
    if (!token) return;
    try {
      const res = await fetch(`${BASE_URL}/meal-plans/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setMealPlans(await res.json());
    } catch {}
  };

  const deleteMealPlan = async (id: number) => {
    if (!authToken) return;
    try {
      await fetch(`${BASE_URL}/meal-plans/${id}/`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setMealPlans(prev => prev.filter(p => p.id !== id));
      if (viewingPlan?.id === id) { setViewingPlan(null); goBack(); }
    } catch {
      Alert.alert('Error', 'Could not delete meal plan.');
    }
  };

  const swapMealWithSaved = async (mealId: number, savedRecipeId: number) => {
    if (!authToken) return;
    try {
      const res = await fetch(`${BASE_URL}/meal-plan-meals/${mealId}/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ saved_recipe_id: savedRecipeId }),
      });
      if (res.ok) {
        // Refresh the viewing plan
        const planRes = await fetch(`${BASE_URL}/meal-plans/${viewingPlan!.id}/`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (planRes.ok) {
          const updated = await planRes.json();
          setViewingPlan(updated);
          setMealPlans(prev => prev.map(p => p.id === updated.id ? updated : p));
        }
        setSwapModalVisible(false);
        Alert.alert('Swapped!', 'Meal updated with your saved recipe.');
      }
    } catch {
      Alert.alert('Error', 'Could not swap meal.');
    }
  };

  const saveMealAsRecipe = async (meal: MealPlanMeal) => {
    const recipe: Recipe = {
      title: meal.title,
      description: meal.description,
      ingredients: meal.ingredients,
      steps: meal.steps,
      calories: meal.calories ?? undefined,
      servings: meal.servings ?? undefined,
      prep_time: meal.prep_time,
      cook_time: meal.cook_time,
    };
    await saveRecipe(recipe);
  };

  // --- Camera / Photo ---
  const startCamera = async () => {
    if (!cameraPermission?.granted) await requestCameraPermission();
    setIsCameraActive(true);
  };

  const capturePhoto = async () => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      if (photo) {
        setPhotoUri(photo.uri);
        setIsCameraActive(false);
        navigate('preview');
      }
    }
  };

  const pickImage = async () => {
    if (!mediaLibraryPermission?.granted) await requestMediaLibraryPermission();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.5,
      });
      if (!result.canceled) {
        setPhotoUri(result.assets[0].uri);
        setDetectedIngredients([]);
        navigate('preview');
      }
    } catch {
      Alert.alert('Error', 'Could not open gallery.');
    }
  };

  // --- API Calls ---
  const detectIngredients = async () => {
    if (!photoUri) return;
    setLoading(true);
    setLoadingText('Analysing your fridge...');
    try {
      const formData = new FormData();
      formData.append('image', { uri: photoUri, name: 'upload.jpg', type: 'image/jpeg' } as any);
      const res = await fetch(`${BASE_URL}/detect-ingredients/`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data' },
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setDetectedIngredients(data.detected_ingredients || []);
        navigate('ingredients');
      } else {
        Alert.alert('Error', data.error || 'Detection failed.');
      }
    } catch {
      Alert.alert('Connection Error', 'Is the backend running? Check IP address.');
    } finally {
      setLoading(false);
    }
  };

  const generateRecipes = async () => {
    setLoading(true);
    setLoadingText('Chef Gemini is cooking up ideas...');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${BASE_URL}/generate-recipe/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ingredients: detectedIngredients,
          preferences: {
            ...preferences,
            ...(recipeMealType !== 'any' ? { mealType: recipeMealType } : {}),
          },
          count: 3,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const recipes = Array.isArray(data.recipes) ? data.recipes : [];
        if (recipes.length === 0) {
          Alert.alert('No recipes generated', 'Prep could not generate recipes this time. Please try again.');
          return;
        }

        setGeneratedRecipes(recipes);
        navigate('recipeSelect');
      } else {
        Alert.alert('Error', data.error || 'Recipe generation failed.');
      }
    } catch {
      Alert.alert('Error', 'Could not fetch recipes. Check connection.');
    } finally {
      setLoading(false);
    }
  };

  // --- Toggle helpers ---
  const toggleList = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value];

  const updatePref = (key: keyof Preferences, value: any) => {
    setPreferences(prev => normalizePreferences({ ...prev, [key]: value }));
  };

  // =========================================================================
  // SUB-COMPONENTS
  // =========================================================================

  const AppHeader = ({
    title,
    showBack = true,
    onBack,
  }: { title?: string; showBack?: boolean; onBack?: () => void }) => (
    <View style={styles.appHeader}>
      {/* Left: back button */}
      <View style={styles.appHeaderLeft}>
        {showBack && (
          <TouchableOpacity onPress={onBack || goBack} style={styles.headerIconBtn}>
            <Text style={styles.headerBackText}>{'‹ Back'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Centre: title — absolutely positioned so it's always screen-centred */}
      <View style={styles.appHeaderCenter} pointerEvents="none">
        {title ? <Text style={styles.appHeaderTitle} numberOfLines={1}>{title}</Text> : null}
      </View>

      {/* Right: home */}
      <View style={styles.appHeaderRight}>
        <TouchableOpacity onPress={goHome} style={styles.headerIconBtn}>
          <Text style={styles.headerIcon}>Home</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const addCustomPrefItem = (
    key: 'cuisines' | 'dietary' | 'allergies',
    value: string,
    clearFn: () => void,
  ) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!preferences[key].includes(trimmed)) {
      updatePref(key, [...preferences[key], trimmed]);
    }
    clearFn();
  };

  // =========================================================================
  // SCREENS
  // =========================================================================

  // Global Loading
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={styles.loadingText}>{loadingText}</Text>
      </View>
    );
  }

  // Camera (fullscreen)
  if (isCameraActive) {
    return (
      <CameraView style={{ flex: 1 }} facing="back" ref={cameraRef}>
        <SafeAreaView style={{ flex: 1 }}>
          <TouchableOpacity onPress={() => setIsCameraActive(false)} style={styles.cameraClose}>
            <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold' }}>X</Text>
          </TouchableOpacity>
          <View style={styles.cameraShutterRow}>
            <TouchableOpacity onPress={capturePhoto} style={styles.cameraShutterBtn} />
          </View>
        </SafeAreaView>
      </CameraView>
    );
  }

  switch (screen) {

    // =========================================================================
    // HOME
    // =========================================================================
    case 'home': return (
      <SafeAreaView style={styles.container}>
        <View style={styles.homeHeader}>
          <View>
            <Text style={styles.homeGreeting}>
              {authEmail ? `Hi, ${authEmail.split('@')[0]}!` : 'Welcome to Prep'}
            </Text>
            <Text style={styles.homeSubtitle}>What's in your fridge today?</Text>
          </View>
          <TouchableOpacity
            onPress={() => authToken ? navigate('profile') : navigate('auth')}
            style={styles.homeProfileBtn}
          >
            <Text style={styles.homeProfileInitial}>
              {authEmail ? authEmail[0].toUpperCase() : 'P'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.homeContent}>
          <TouchableOpacity style={styles.homeCardPrimary} onPress={startCamera} activeOpacity={0.85}>
            <View style={styles.homeCardTextBlock}>
              <Text style={styles.homeCardTitle}>Scan Ingredients</Text>
              <Text style={styles.homeCardSub}>Take a photo to detect ingredients</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.homeCardSecondary} onPress={pickImage} activeOpacity={0.85}>
            <View style={styles.homeCardTextBlock}>
              <Text style={styles.homeCardTitle}>Upload Photo</Text>
              <Text style={styles.homeCardSub}>Pick from your gallery</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.homeCardSecondary, { backgroundColor: '#1E40AF' }]}
            onPress={() => { setDetectedIngredients([]); navigate('ingredients'); }}
            activeOpacity={0.85}
          >
            <View style={styles.homeCardTextBlock}>
              <Text style={styles.homeCardTitle}>Enter Ingredients</Text>
              <Text style={styles.homeCardSub}>Type your ingredients manually</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.homeRow}>
            <TouchableOpacity
              style={[styles.homeSmallCard, { backgroundColor: '#7C3AED' }]}
              onPress={() => navigate('savedList')}
            >
              <Text style={styles.homeSmallCardTitle}>
                Saved Recipes{savedRecipes.length > 0 ? ` (${savedRecipes.length})` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.homeSmallCard, { backgroundColor: '#0F766E' }]}
              onPress={() => {
                if (!authToken) { Alert.alert('Sign In Required', 'Please sign in to use Meal Planner.'); return; }
                setMealPlanName('');
                setMealPlanDays(3);
                navigate('mealPlanCreate');
              }}
            >
              <Text style={styles.homeSmallCardTitle}>Meal Planner</Text>
            </TouchableOpacity>
          </View>

          {!authToken && (
            <TouchableOpacity
              style={styles.homeSignInBanner}
              onPress={() => { navigate('auth'); setAuthSubMode('login'); }}
            >
              <Text style={styles.homeSignInText}>Sign in to sync recipes across devices</Text>
            </TouchableOpacity>
          )}

          {authToken && (
            <View style={[styles.prefsSummaryRow, { marginTop: 4, marginBottom: 0 }]}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.prefsSummaryLabel}>YOUR PREFERENCES</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {[
                    ...preferences.cuisines.slice(0, 2),
                    ...preferences.dietary.filter(d => d !== 'No Restrictions').slice(0, 1),
                  ].map(p => (
                    <View key={p} style={styles.prefsMiniChip}>
                      <Text style={styles.prefsMiniText}>{p}</Text>
                    </View>
                  ))}
                  {preferences.allergies.filter(a => a !== 'None').map(a => (
                    <View key={a} style={[styles.prefsMiniChip, { backgroundColor: '#FEE2E2' }]}>
                      <Text style={[styles.prefsMiniText, { color: '#991B1B' }]}>No {a}</Text>
                    </View>
                  ))}
                  {preferences.cuisines.length === 0 && preferences.dietary.length === 0 && preferences.allergies.filter(a => a !== 'None').length === 0 && (
                    <Text style={{ color: '#94A3B8', fontSize: 13 }}>No preferences set yet</Text>
                  )}
                </ScrollView>
              </View>
              <TouchableOpacity onPress={openPrefsModal} style={styles.prefsEditBtn}>
                <Text style={styles.prefsEditText}>Adjust</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {/* Preferences modal */}
        <Modal visible={showPrefsModal} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={styles.container}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderSpacer} />
              <Text style={styles.modalTitle}>Your Preferences</Text>
              <TouchableOpacity onPress={closePrefsModal}>
                <Text style={styles.modalDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
            >
              <PreferencesSection
                preferences={preferences}
                customCuisineText={customCuisineText}
                customDietaryText={customDietaryText}
                customAllergyText={customAllergyText}
                customCalorieText={customCalorieText}
                setCustomCuisineText={setCustomCuisineText}
                setCustomDietaryText={setCustomDietaryText}
                setCustomAllergyText={setCustomAllergyText}
                setCustomCalorieText={setCustomCalorieText}
                updatePref={updatePref}
                toggleList={toggleList}
                addCustomPrefItem={addCustomPrefItem}
              />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    );

    // =========================================================================
    // PREVIEW
    // =========================================================================
    case 'preview': return (
      <SafeAreaView style={styles.container}>
        <AppHeader title="Review Photo" />
        <View style={{ flex: 1, padding: 20 }}>
          {photoUri && (
            <Image
              source={{ uri: photoUri }}
              style={{ flex: 1, borderRadius: 20, marginBottom: 20 }}
              resizeMode="contain"
            />
          )}
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#10B981', marginBottom: 10 }]}
            onPress={detectIngredients}
          >
            <Text style={styles.btnText}>Analyse Image</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#334155' }]}
            onPress={goBack}
          >
            <Text style={styles.btnText}>Retake / Re-upload</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );

    // =========================================================================
    // INGREDIENTS
    // =========================================================================
    case 'ingredients': return (
      <SafeAreaView style={styles.container}>
        <AppHeader title="Pantry Check" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>

            {/* Active preferences summary */}
            <View style={styles.prefsSummaryRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.prefsSummaryLabel}>COOKING FOR</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {[
                    ...preferences.cuisines.slice(0, 2),
                    ...preferences.dietary.filter(d => d !== 'No Restrictions').slice(0, 1),
                  ].map(p => (
                    <View key={p} style={styles.prefsMiniChip}>
                      <Text style={styles.prefsMiniText}>{p}</Text>
                    </View>
                  ))}
                  {preferences.allergies.filter(a => a !== 'None').map(a => (
                    <View key={a} style={[styles.prefsMiniChip, { backgroundColor: '#FEE2E2' }]}>
                      <Text style={[styles.prefsMiniText, { color: '#991B1B' }]}>No {a}</Text>
                    </View>
                  ))}
                  {preferences.cuisines.length === 0 && preferences.dietary.length === 0 && (
                    <Text style={{ color: '#94A3B8', fontSize: 13 }}>No preferences set</Text>
                  )}
                </ScrollView>
              </View>
              <TouchableOpacity onPress={openPrefsModal} style={styles.prefsEditBtn}>
                <Text style={styles.prefsEditText}>Adjust</Text>
              </TouchableOpacity>
            </View>

            {/* Meal type selector */}
            <Text style={styles.sectionTitle}>Meal Type</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {(['any', 'breakfast', 'lunch', 'dinner'] as const).map(mt => (
                <TouchableOpacity
                  key={mt}
                  onPress={() => setRecipeMealType(mt)}
                  style={[
                    styles.metaChip,
                    { paddingVertical: 7, paddingHorizontal: 14 },
                    recipeMealType === mt && { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },
                  ]}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: recipeMealType === mt ? '#fff' : '#64748B' }}>
                    {mt.charAt(0).toUpperCase() + mt.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Detected Ingredients</Text>
            <Text style={{ color: '#64748B', fontSize: 13, marginBottom: 12 }}>
              Tap X to remove, or add more below:
            </Text>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="Add ingredient..."
                value={newIngredientText}
                onChangeText={setNewIngredientText}
                onSubmitEditing={() => {
                  if (newIngredientText.trim()) {
                    setDetectedIngredients(p => [...p, newIngredientText.trim()]);
                    setNewIngredientText('');
                  }
                }}
              />
              <TouchableOpacity style={styles.addBtn} onPress={() => {
                if (newIngredientText.trim()) {
                  setDetectedIngredients(p => [...p, newIngredientText.trim()]);
                  setNewIngredientText('');
                }
              }}>
                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 20 }}>+</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.chipRow}>
              {detectedIngredients.map((item, i) => (
                <View key={i} style={styles.ingredientTag}>
                  <Text style={styles.ingredientTagText}>{item}</Text>
                  <TouchableOpacity onPress={() => {
                    const next = [...detectedIngredients];
                    next.splice(i, 1);
                    setDetectedIngredients(next);
                  }} style={{ marginLeft: 8 }}>
                    <Text style={{ color: '#0369A1', fontWeight: 'bold' }}>X</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {detectedIngredients.length === 0 && (
                <Text style={{ color: '#94A3B8', fontSize: 14 }}>No ingredients yet — add some above.</Text>
              )}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: '#10B981' }]} onPress={generateRecipes}>
              <Text style={styles.btnText}>Generate Recipes</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        {/* Preferences modal */}
        <Modal visible={showPrefsModal} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={styles.container}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderSpacer} />
              <Text style={styles.modalTitle}>Adjust Preferences</Text>
              <TouchableOpacity onPress={closePrefsModal}>
                <Text style={styles.modalDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={{ color: '#64748B', fontSize: 13, marginBottom: 16 }}>
                These preferences will shape your recipe suggestions.
              </Text>
              <PreferencesSection
                preferences={preferences}
                customCuisineText={customCuisineText}
                customDietaryText={customDietaryText}
                customAllergyText={customAllergyText}
                customCalorieText={customCalorieText}
                setCustomCuisineText={setCustomCuisineText}
                setCustomDietaryText={setCustomDietaryText}
                setCustomAllergyText={setCustomAllergyText}
                setCustomCalorieText={setCustomCalorieText}
                updatePref={updatePref}
                toggleList={toggleList}
                addCustomPrefItem={addCustomPrefItem}
              />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    );

    // =========================================================================
    // RECIPE SELECT
    // =========================================================================
    case 'recipeSelect': return (
      <SafeAreaView style={styles.container}>
        <AppHeader title="Choose a Recipe" />
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={{ color: '#64748B', marginBottom: 16, fontSize: 14 }}>
            {generatedRecipes.length} recipes based on your ingredients and preferences. Pick your favourite:
          </Text>

          {generatedRecipes.map((r, i) => (
            <TouchableOpacity
              key={i}
              style={styles.recipeCard}
              onPress={() => { setViewingRecipe(r); navigate('recipeDetail'); }}
              activeOpacity={0.85}
            >
              <View style={styles.recipeCardHeader}>
                <Text style={styles.recipeCardTitle}>{r.title}</Text>
                {isRecipeSaved(r.title) && (
                  <View style={styles.savedBadge}>
                    <Text style={styles.savedBadgeText}>Saved</Text>
                  </View>
                )}
              </View>
              {r.description ? (
                <Text style={styles.recipeCardDesc}>{r.description}</Text>
              ) : null}
              <View style={styles.recipeCardMeta}>
                {r.prep_time && <Text style={styles.metaChip}>Prep: {r.prep_time}</Text>}
                {r.cook_time && <Text style={styles.metaChip}>Cook: {r.cook_time}</Text>}
                {r.calories && <Text style={styles.metaChip}>{r.calories} kcal</Text>}
                {r.servings && <Text style={styles.metaChip}>Serves {r.servings}</Text>}
              </View>
              <Text style={styles.recipeCardIngredients}>
                {r.ingredients.slice(0, 4).join(' · ')}
                {r.ingredients.length > 4 ? ` +${r.ingredients.length - 4} more` : ''}
              </Text>
              <Text style={styles.recipeCardArrow}>View Recipe</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#334155', marginTop: 10 }]}
            onPress={generateRecipes}
          >
            <Text style={styles.btnText}>Regenerate</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );

    // =========================================================================
    // RECIPE DETAIL
    // =========================================================================
    case 'recipeDetail': {
      const r = viewingRecipe;
      const isSaved = r ? isRecipeSaved(r.title) : false;
      const savedEntry = r ? savedRecipes.find(s => s.title === r.title) : undefined;
      const cameFromGenerated = screenHistory[screenHistory.length - 1] === 'recipeSelect';
      return (
        <SafeAreaView style={styles.container}>
          <AppHeader title="" showBack />
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {r && (
              <View style={styles.card}>
                <Text style={styles.title}>{r.title}</Text>
                {r.description ? <Text style={styles.recipeDesc}>{r.description}</Text> : null}

                <View style={styles.recipeMetaRow}>
                  {r.prep_time && <Text style={styles.metaChip}>Prep: {r.prep_time}</Text>}
                  {r.cook_time && <Text style={styles.metaChip}>Cook: {r.cook_time}</Text>}
                  {r.calories && <Text style={styles.metaChip}>{r.calories} kcal</Text>}
                  {r.servings && <Text style={styles.metaChip}>Serves {r.servings}</Text>}
                </View>

                <View style={styles.divider} />
                <Text style={styles.sectionTitle}>Ingredients</Text>
                {r.ingredients?.map((item, i) => (
                  <Text key={i} style={styles.text}>- {item}</Text>
                ))}

                <View style={styles.divider} />
                <Text style={styles.sectionTitle}>Steps</Text>
                {r.steps?.map((item, i) => (
                  <View key={i} style={styles.stepRow}>
                    <View style={styles.badge}>
                      <Text style={{ color: 'white', fontWeight: '700', fontSize: 13 }}>{i + 1}</Text>
                    </View>
                    <Text style={[styles.text, { flex: 1 }]}>{item}</Text>
                  </View>
                ))}

                {(savedEntry as SavedRecipe)?.savedAt && (
                  <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 10 }}>
                    Saved {new Date((savedEntry as SavedRecipe).savedAt).toLocaleDateString('en-IE')}
                  </Text>
                )}
              </View>
            )}

            {r && !isSaved && (
              <TouchableOpacity
                style={[styles.btn, { marginTop: 20, backgroundColor: '#10B981' }]}
                onPress={() => saveRecipe(r)}
              >
                <Text style={styles.btnText}>Save Recipe</Text>
              </TouchableOpacity>
            )}
            {r && isSaved && (
              <>
                <View style={[styles.btn, { marginTop: 20, backgroundColor: '#D1FAE5' }]}>
                  <Text style={[styles.btnText, { color: '#065F46' }]}>Recipe Saved</Text>
                </View>
                <TouchableOpacity
                  style={[styles.btn, { marginTop: 10, backgroundColor: '#EF4444' }]}
                  onPress={() => {
                    Alert.alert('Delete Recipe', `Remove "${r.title}"?`, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete', style: 'destructive', onPress: () => {
                          if (savedEntry) deleteRecipe((savedEntry as SavedRecipe).savedAt);
                          goBack();
                        }
                      },
                    ]);
                  }}
                >
                  <Text style={styles.btnText}>Delete Recipe</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { marginTop: 10, backgroundColor: '#334155' }]}
                  onPress={goBack}
                >
                  <Text style={styles.btnText}>
                    {cameFromGenerated ? 'Back to Generated Recipes' : 'Back to Saved Recipes'}
                  </Text>
                </TouchableOpacity>
              </>
            )}

          </ScrollView>
        </SafeAreaView>
      );
    }

    // =========================================================================
    // SAVED LIST
    // =========================================================================
    case 'savedList': {
      const filteredSaved = savedRecipes
        .slice()
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
        .filter(item => {
          const matchesSearch = savedSearch.trim() === '' ||
            item.title.toLowerCase().includes(savedSearch.trim().toLowerCase());
          const matchesCategory = savedCategoryFilter === 'all' || item.category === savedCategoryFilter;
          return matchesSearch && matchesCategory;
        });
      return (
        <SafeAreaView style={styles.container}>
          <AppHeader title="Saved Recipes" />
          <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, marginBottom: 10 }}>
              <Text style={{ fontSize: 16, marginRight: 8 }}>🔍</Text>
              <TextInput
                style={{ flex: 1, paddingVertical: 12, fontSize: 15, color: '#0F172A' }}
                placeholder="Search recipes..."
                placeholderTextColor="#94A3B8"
                value={savedSearch}
                onChangeText={setSavedSearch}
                clearButtonMode="while-editing"
                returnKeyType="search"
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {(['all', 'breakfast', 'lunch', 'dinner'] as const).map(cat => (
                <TouchableOpacity
                  key={cat}
                  onPress={() => setSavedCategoryFilter(cat)}
                  style={[
                    styles.metaChip,
                    { paddingVertical: 7, paddingHorizontal: 14 },
                    savedCategoryFilter === cat && { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },
                  ]}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: savedCategoryFilter === cat ? '#fff' : '#64748B' }}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: 4, paddingBottom: 80 }]}>
            {savedRecipes.length === 0 ? (
              <View style={{ alignItems: 'center', marginTop: 60 }}>
                <Text style={{ color: '#64748B', fontSize: 18, fontWeight: '700', marginBottom: 8 }}>No saved recipes yet.</Text>
                <Text style={{ color: '#94A3B8', fontSize: 14 }}>Generate a recipe and tap Save!</Text>
              </View>
            ) : filteredSaved.length === 0 ? (
              <View style={{ alignItems: 'center', marginTop: 40 }}>
                <Text style={{ color: '#64748B', fontSize: 15, fontWeight: '600' }}>No recipes match your search.</Text>
              </View>
            ) : (
              filteredSaved.map((item, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.card, { marginBottom: 12 }]}
                  onPress={() => { setViewingRecipe(item); navigate('recipeDetail'); }}
                >
                  <Text style={styles.sectionTitle}>{item.title}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {item.category ? (
                      <Text style={[styles.metaChip, { backgroundColor: '#CCFBF1', borderColor: '#99F6E4', color: '#0F766E', fontWeight: '700' }]}>
                        {item.category.charAt(0).toUpperCase() + item.category.slice(1)}
                      </Text>
                    ) : null}
                    {item.calories ? <Text style={styles.metaChip}>{item.calories} kcal</Text> : null}
                    {item.prep_time ? <Text style={styles.metaChip}>Prep: {item.prep_time}</Text> : null}
                    {item.cook_time ? <Text style={styles.metaChip}>Cook: {item.cook_time}</Text> : null}
                    <Text style={styles.metaChip}>{item.ingredients?.length ?? 0} ingredients</Text>
                    <Text style={styles.metaChip}>
                      {new Date(item.savedAt).toLocaleDateString('en-IE')}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      );
    }

    // =========================================================================
    // AUTH
    // =========================================================================
    case 'auth': return (
      <SafeAreaView style={styles.container}>
        <AppHeader showBack title="" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 20 }} keyboardShouldPersistTaps="handled">

            {/* Tabs — only shown for login/register */}
            {(authSubMode === 'login' || authSubMode === 'register') && (
              <View style={styles.authTabs}>
                <TouchableOpacity
                  style={[styles.authTab, authSubMode === 'login' && styles.authTabActive]}
                  onPress={() => { setAuthSubMode('login'); setAuthError(''); }}
                >
                  <Text style={[styles.authTabText, authSubMode === 'login' && styles.authTabTextActive]}>
                    Sign In
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.authTab, authSubMode === 'register' && styles.authTabActive]}
                  onPress={() => { setAuthSubMode('register'); setAuthError(''); }}
                >
                  <Text style={[styles.authTabText, authSubMode === 'register' && styles.authTabTextActive]}>
                    Register
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Login / Register */}
            {(authSubMode === 'login' || authSubMode === 'register') && (
              <>
                <Text style={styles.authHeading}>
                  {authSubMode === 'login' ? 'Welcome back!' : 'Create your account'}
                </Text>
                <Text style={styles.authSubHeading}>
                  {authSubMode === 'login'
                    ? 'Sign in to sync recipes across all your devices.'
                    : 'Register to save and sync your recipes in the cloud.'}
                </Text>

                <TextInput
                  style={styles.authInput}
                  placeholder="Email address"
                  value={authEmailInput}
                  onChangeText={setAuthEmailInput}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />
                <TextInput
                  style={styles.authInput}
                  placeholder="Password"
                  value={authPasswordInput}
                  onChangeText={setAuthPasswordInput}
                  secureTextEntry
                  textContentType={authSubMode === 'register' ? 'newPassword' : 'password'}
                />

                {authError ? <Text style={styles.errorText}>{authError}</Text> : null}

                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: '#3B82F6', marginBottom: 12 }]}
                  onPress={handleAuth}
                  disabled={authLoading}
                >
                  {authLoading
                    ? <ActivityIndicator color="white" />
                    : <Text style={styles.btnText}>
                        {authSubMode === 'login' ? 'Sign In' : 'Register'}
                      </Text>
                  }
                </TouchableOpacity>

                {authSubMode === 'login' && (
                  <TouchableOpacity onPress={() => {
                    setAuthSubMode('forgotStep1');
                    setForgotEmail(authEmailInput);
                    setForgotError('');
                  }}>
                    <Text style={styles.forgotLink}>Forgot password?</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {/* Forgot password - Step 1 */}
            {authSubMode === 'forgotStep1' && (
              <>
                <Text style={styles.authHeading}>Forgot Password</Text>
                <Text style={styles.authSubHeading}>
                  Enter your email and we will send you a reset code.
                </Text>
                <TextInput
                  style={styles.authInput}
                  placeholder="Your email address"
                  value={forgotEmail}
                  onChangeText={setForgotEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                {forgotError ? <Text style={styles.errorText}>{forgotError}</Text> : null}
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: '#3B82F6', marginBottom: 12 }]}
                  onPress={handleForgotRequest}
                  disabled={forgotLoading}
                >
                  {forgotLoading
                    ? <ActivityIndicator color="white" />
                    : <Text style={styles.btnText}>Send Reset Code</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setAuthSubMode('login'); setForgotError(''); }}>
                  <Text style={styles.forgotLink}>Back to Sign In</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Forgot password - Step 2 */}
            {authSubMode === 'forgotStep2' && (
              <>
                <Text style={styles.authHeading}>Enter Reset Code</Text>
                <Text style={styles.authSubHeading}>
                  A code was sent to {forgotEmail}. Enter it below along with your new password.
                </Text>
                {devToken ? (
                  <View style={styles.devTokenBox}>
                    <Text style={styles.devTokenLabel}>DEV MODE — Your reset code:</Text>
                    <Text style={styles.devTokenValue}>{devToken}</Text>
                    <Text style={styles.devTokenNote}>This box is hidden in production.</Text>
                  </View>
                ) : null}
                <TextInput
                  style={styles.authInput}
                  placeholder="6-digit reset code"
                  value={forgotCode}
                  onChangeText={setForgotCode}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                <TextInput
                  style={styles.authInput}
                  placeholder="New password"
                  value={forgotNewPass}
                  onChangeText={setForgotNewPass}
                  secureTextEntry
                />
                <TextInput
                  style={styles.authInput}
                  placeholder="Confirm new password"
                  value={forgotConfirmPass}
                  onChangeText={setForgotConfirmPass}
                  secureTextEntry
                />
                {forgotError ? <Text style={styles.errorText}>{forgotError}</Text> : null}
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: '#3B82F6', marginBottom: 12 }]}
                  onPress={handleForgotReset}
                  disabled={forgotLoading}
                >
                  {forgotLoading
                    ? <ActivityIndicator color="white" />
                    : <Text style={styles.btnText}>Reset Password</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setAuthSubMode('forgotStep1'); setForgotError(''); }}>
                  <Text style={styles.forgotLink}>Resend code</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );

    // =========================================================================
    // PROFILE
    // =========================================================================
    case 'profile': return (
      <SafeAreaView style={styles.container}>
        <AppHeader title="My Profile" showBack={false} />
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}
          keyboardShouldPersistTaps="handled"
        >

          <Text style={styles.sectionTitle}>Food Preferences</Text>
          <PreferencesSection
            preferences={preferences}
            customCuisineText={customCuisineText}
            customDietaryText={customDietaryText}
            customAllergyText={customAllergyText}
            customCalorieText={customCalorieText}
            setCustomCuisineText={setCustomCuisineText}
            setCustomDietaryText={setCustomDietaryText}
            setCustomAllergyText={setCustomAllergyText}
            setCustomCalorieText={setCustomCalorieText}
            updatePref={updatePref}
            toggleList={toggleList}
            addCustomPrefItem={addCustomPrefItem}
          />

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#10B981', marginTop: 20 }]}
            onPress={goBack}
          >
            <Text style={styles.btnText}>Done</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#3B82F6', marginTop: 10 }]}
            onPress={() => {
              setCpOld(''); setCpNew(''); setCpConfirm(''); setCpError('');
              navigate('changePassword');
            }}
          >
            <Text style={styles.btnText}>Change Password</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#EF4444', marginTop: 10 }]}
            onPress={() => Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign Out', style: 'destructive', onPress: handleLogout },
            ])}
          >
            <Text style={styles.btnText}>Sign Out</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );

    // =========================================================================
    // CHANGE PASSWORD
    // =========================================================================
    case 'changePassword': return (
      <SafeAreaView style={styles.container}>
        <AppHeader title="Change Password" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.authSubHeading}>
              Enter your current password to confirm your identity, then set a new one.
            </Text>
            <Text style={styles.inputLabel}>Current Password</Text>
            <TextInput
              style={styles.authInput}
              placeholder="Current password"
              value={cpOld}
              onChangeText={setCpOld}
              secureTextEntry
            />
            <Text style={styles.inputLabel}>New Password</Text>
            <TextInput
              style={styles.authInput}
              placeholder="New password (min 6 characters)"
              value={cpNew}
              onChangeText={setCpNew}
              secureTextEntry
            />
            <Text style={styles.inputLabel}>Confirm New Password</Text>
            <TextInput
              style={styles.authInput}
              placeholder="Confirm new password"
              value={cpConfirm}
              onChangeText={setCpConfirm}
              secureTextEntry
            />

            {cpError ? <Text style={styles.errorText}>{cpError}</Text> : null}

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: '#10B981', marginTop: 8 }]}
              onPress={handleChangePassword}
              disabled={cpLoading}
            >
              {cpLoading
                ? <ActivityIndicator color="white" />
                : <Text style={styles.btnText}>Update Password</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );

    // =========================================================================
    // MEAL PLAN — CREATE
    // =========================================================================
    case 'mealPlanCreate': return (
      <SafeAreaView style={styles.container}>
        <AppHeader title="New Meal Plan" />
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>Plan Details</Text>

          <Text style={styles.inputLabel}>Plan Name (optional)</Text>
          <TextInput
            style={[styles.authInput, { marginBottom: 20 }]}
            placeholder="e.g. Healthy Week"
            value={mealPlanName}
            onChangeText={setMealPlanName}
          />

          <Text style={styles.inputLabel}>Number of Days</Text>
          <View style={[styles.chipRow, { marginBottom: 20 }]}>
            {[1, 2, 3, 4, 5, 6, 7].map(d => (
              <ToggleChip
                key={d}
                label={`${d} day${d > 1 ? 's' : ''}`}
                selected={mealPlanDays === d}
                onPress={() => setMealPlanDays(d)}
              />
            ))}
          </View>

          {/* Active preferences summary */}
          <View style={styles.prefsSummaryRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.prefsSummaryLabel}>COOKING FOR</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {[
                  ...preferences.cuisines.slice(0, 2),
                  ...preferences.dietary.filter(d => d !== 'No Restrictions').slice(0, 1),
                ].map(p => (
                  <View key={p} style={styles.prefsMiniChip}>
                    <Text style={styles.prefsMiniText}>{p}</Text>
                  </View>
                ))}
                {preferences.allergies.filter(a => a !== 'None').map(a => (
                  <View key={a} style={[styles.prefsMiniChip, { backgroundColor: '#FEE2E2' }]}>
                    <Text style={[styles.prefsMiniText, { color: '#991B1B' }]}>No {a}</Text>
                  </View>
                ))}
                {preferences.cuisines.length === 0 && preferences.dietary.length === 0 && (
                  <Text style={{ color: '#94A3B8', fontSize: 13 }}>No preferences set</Text>
                )}
              </ScrollView>
            </View>
            <TouchableOpacity onPress={openPrefsModal} style={styles.prefsEditBtn}>
              <Text style={styles.prefsEditText}>Adjust</Text>
            </TouchableOpacity>
          </View>

          <Text style={{ color: C.muted, fontSize: 13, marginTop: 12, marginBottom: 24, lineHeight: 18 }}>
            Gemini will create breakfast, lunch, and dinner for each day using your saved preferences.
          </Text>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#0D9488', marginTop: 0 }]}
            onPress={generateMealPlan}
          >
            <Text style={styles.btnText}>Generate {mealPlanDays}-Day Plan</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#475569', marginTop: 10 }]}
            onPress={() => { setMealPlanName(''); navigate('mealPlanList'); }}
          >
            <Text style={styles.btnText}>View Saved Plans{mealPlans.length > 0 ? ` (${mealPlans.length})` : ''}</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Preferences modal */}
        <Modal visible={showPrefsModal} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={styles.container}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderSpacer} />
              <Text style={styles.modalTitle}>Adjust Preferences</Text>
              <TouchableOpacity onPress={closePrefsModal}>
                <Text style={styles.modalDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={{ color: '#64748B', fontSize: 13, marginBottom: 16 }}>
                These preferences will shape your meal plan.
              </Text>
              <PreferencesSection
                preferences={preferences}
                customCuisineText={customCuisineText}
                customDietaryText={customDietaryText}
                customAllergyText={customAllergyText}
                customCalorieText={customCalorieText}
                setCustomCuisineText={setCustomCuisineText}
                setCustomDietaryText={setCustomDietaryText}
                setCustomAllergyText={setCustomAllergyText}
                setCustomCalorieText={setCustomCalorieText}
                updatePref={updatePref}
                toggleList={toggleList}
                addCustomPrefItem={addCustomPrefItem}
              />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    );

    // =========================================================================
    // MEAL PLAN — VIEW
    // =========================================================================
    case 'mealPlanView': return (
      <SafeAreaView style={styles.container}>
        <AppHeader title={viewingPlan?.name ?? 'Meal Plan'} />
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: 80 }]}>
          {viewingPlan?.days.map(day => (
            <View key={day.id} style={styles.mpDayCard}>
              <Text style={styles.mpDayTitle}>Day {day.day_number}</Text>
              {(['breakfast', 'lunch', 'dinner'] as const).map(mealType => {
                const meal = day.meals.find(m => m.meal_type === mealType);
                if (!meal) return null;
                return (
                  <TouchableOpacity
                    key={meal.id}
                    style={styles.mpMealRow}
                    onPress={() => { setViewingMeal(meal); navigate('mealMealDetail'); }}
                    activeOpacity={0.75}
                  >
                    <View style={styles.mpMealLabelCol}>
                      <Text style={styles.mpMealType}>{mealType.charAt(0).toUpperCase() + mealType.slice(1)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.mpMealTitle} numberOfLines={1}>{meal.title}</Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                        {meal.calories ? <Text style={styles.metaChip}>{meal.calories} kcal</Text> : null}
                        {meal.prep_time ? <Text style={styles.metaChip}>{meal.prep_time} prep</Text> : null}
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.mpSwapBtn}
                      onPress={() => {
                        if (savedRecipes.length === 0) {
                          Alert.alert('No saved recipes', 'Save some recipes first to swap them in.');
                          return;
                        }
                        setSwapTargetMealId(meal.id);
                        setSwapSearch('');
                        setSwapCategoryFilter('all');
                        setSwapModalVisible(true);
                      }}
                    >
                      <Text style={styles.mpSwapText}>Swap</Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: C.red, marginTop: 16 }]}
            onPress={() => Alert.alert(
              'Delete Plan',
              'Are you sure you want to delete this meal plan?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteMealPlan(viewingPlan!.id) },
              ]
            )}
          >
            <Text style={styles.btnText}>Delete Plan</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Swap modal */}
        <Modal visible={swapModalVisible} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={styles.container}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setSwapModalVisible(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Swap with Saved Recipe</Text>
              <View style={{ width: 60 }} />
            </View>
            {/* Search + filter */}
            <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, marginBottom: 8 }}>
                <Text style={{ fontSize: 16, marginRight: 8 }}>🔍</Text>
                <TextInput
                  style={{ flex: 1, paddingVertical: 10, fontSize: 15, color: '#0F172A' }}
                  placeholder="Search saved recipes..."
                  placeholderTextColor="#94A3B8"
                  value={swapSearch}
                  onChangeText={setSwapSearch}
                  clearButtonMode="while-editing"
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {(['all', 'breakfast', 'lunch', 'dinner'] as const).map(cat => (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => setSwapCategoryFilter(cat)}
                    style={[
                      styles.metaChip,
                      { paddingVertical: 7, paddingHorizontal: 14 },
                      swapCategoryFilter === cat && { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },
                    ]}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: swapCategoryFilter === cat ? '#fff' : '#64748B' }}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 }]}>
              {(() => {
                const swapFiltered = savedRecipes
                  .slice()
                  .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
                  .filter(r => {
                    const matchesSearch = swapSearch.trim() === '' ||
                      r.title.toLowerCase().includes(swapSearch.trim().toLowerCase());
                    const matchesCategory = swapCategoryFilter === 'all' || r.category === swapCategoryFilter;
                    return matchesSearch && matchesCategory;
                  });
                if (savedRecipes.length === 0) return (
                  <View style={{ alignItems: 'center', marginTop: 60 }}>
                    <Text style={{ color: C.muted, fontSize: 16, fontWeight: '700', marginBottom: 8 }}>No saved recipes yet.</Text>
                    <Text style={{ color: C.subtle, fontSize: 14 }}>Generate and save a recipe first.</Text>
                  </View>
                );
                if (swapFiltered.length === 0) return (
                  <View style={{ alignItems: 'center', marginTop: 40 }}>
                    <Text style={{ color: C.muted, fontSize: 15, fontWeight: '600' }}>No recipes match your search.</Text>
                  </View>
                );
                return swapFiltered.map((r, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.card, { marginBottom: 12 }]}
                    onPress={() => {
                      if (r.backendId && swapTargetMealId) {
                        swapMealWithSaved(swapTargetMealId, r.backendId);
                      } else {
                        Alert.alert('Sync required', 'This recipe needs a backend ID. Please sign in and re-save it.');
                      }
                    }}
                  >
                    <Text style={styles.sectionTitle}>{r.title}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      {r.category ? (
                        <Text style={[styles.metaChip, { backgroundColor: '#CCFBF1', borderColor: '#99F6E4', color: '#0F766E', fontWeight: '700' }]}>
                          {r.category.charAt(0).toUpperCase() + r.category.slice(1)}
                        </Text>
                      ) : null}
                      {r.calories ? <Text style={styles.metaChip}>{r.calories} kcal</Text> : null}
                      <Text style={styles.metaChip}>{r.ingredients?.length ?? 0} ingredients</Text>
                      <Text style={styles.metaChip}>{new Date(r.savedAt).toLocaleDateString('en-IE')}</Text>
                    </View>
                    {r.description ? (
                      <Text style={{ fontSize: 13, color: C.muted, marginTop: 6 }} numberOfLines={2}>{r.description}</Text>
                    ) : null}
                  </TouchableOpacity>
                ));
              })()}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    );

    // =========================================================================
    // MEAL PLAN — MEAL DETAIL
    // =========================================================================
    case 'mealMealDetail': {
      const meal = viewingMeal;
      if (!meal) return null;
      return (
        <SafeAreaView style={styles.container}>
          <AppHeader />
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.card}>
              <Text style={styles.title}>{meal.title}</Text>
              {meal.description ? <Text style={styles.recipeDesc}>{meal.description}</Text> : null}

              <View style={styles.recipeMetaRow}>
                <Text style={styles.mpMealTypeBadge}>
                  {meal.meal_type.charAt(0).toUpperCase() + meal.meal_type.slice(1)}
                </Text>
                {meal.calories ? <Text style={styles.metaChip}>{meal.calories} kcal</Text> : null}
                {meal.servings ? <Text style={styles.metaChip}>Serves {meal.servings}</Text> : null}
                {meal.prep_time ? <Text style={styles.metaChip}>{meal.prep_time} prep</Text> : null}
                {meal.cook_time ? <Text style={styles.metaChip}>{meal.cook_time} cook</Text> : null}
              </View>

              <View style={styles.divider} />
              <Text style={styles.sectionTitle}>Ingredients</Text>
              {meal.ingredients.map((ing, i) => (
                <Text key={i} style={styles.text}>{`- ${ing}`}</Text>
              ))}

              <View style={styles.divider} />

              <Text style={styles.sectionTitle}>Steps</Text>
              {meal.steps.map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.badge}>
                    <Text style={{ color: 'white', fontWeight: '700', fontSize: 12 }}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.text, { flex: 1 }]}>{step}</Text>
                </View>
              ))}
            </View>

            {isRecipeSaved(meal.title) ? (
              <View style={[styles.btn, { backgroundColor: '#D1FAE5', marginTop: 20 }]}>
                <Text style={{ color: '#065F46', fontWeight: '700', fontSize: 15 }}>Already in Saved Recipes</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: C.primary, marginTop: 20 }]}
                onPress={() => saveMealAsRecipe(meal)}
              >
                <Text style={styles.btnText}>Save to My Recipes</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </SafeAreaView>
      );
    }

    // =========================================================================
    // MEAL PLAN — LIST
    // =========================================================================
    case 'mealPlanList': return (
      <SafeAreaView style={styles.container}>
        <AppHeader title={`My Meal Plans${mealPlans.length > 0 ? ` (${mealPlans.length})` : ''}`} />
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: 80 }]}>
          {mealPlans.length === 0 ? (
            <View style={{ alignItems: 'center', marginTop: 60 }}>
              <Text style={{ color: C.muted, fontSize: 18, fontWeight: '700', marginBottom: 8 }}>No meal plans yet.</Text>
              <Text style={{ color: C.subtle, fontSize: 14 }}>Generate one from the home screen.</Text>
            </View>
          ) : (
            mealPlans.map(plan => (
              <TouchableOpacity
                key={plan.id}
                style={[styles.card, { marginBottom: 12 }]}
                onPress={() => { setViewingPlan(plan); navigate('mealPlanView'); }}
              >
                <Text style={styles.sectionTitle}>{plan.name}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <Text style={styles.metaChip}>{plan.duration_days} days</Text>
                  <Text style={styles.metaChip}>
                    {new Date(plan.created_at).toLocaleDateString('en-IE')}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );

    default: return null;
  }
}

// --- ROOT ---
export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

// --- STYLES ---
const C = {
  bg: '#F1F5F9',
  card: '#FFFFFF',
  primary: '#10B981',
  dark: '#334155',
  blue: '#3B82F6',
  red: '#EF4444',
  purple: '#7C3AED',
  amber: '#F59E0B',
  text: '#475569',
  muted: '#64748B',
  subtle: '#94A3B8',
  border: '#E2E8F0',
};

const styles = StyleSheet.create({
  // Layout
  container:     { flex: 1, backgroundColor: C.bg },
  center:        { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  scrollContent: { padding: 20, paddingBottom: 50 },

  // Loading
  loadingText: { marginTop: 12, color: C.muted, fontSize: 15 },

  // App Header
  appHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  appHeaderLeft:  { flex: 1, flexDirection: 'row', alignItems: 'center' },
  appHeaderCenter:{ position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  appHeaderRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  appHeaderTitle: { fontSize: 17, fontWeight: '700', color: '#1E293B' },
  headerIconBtn:  { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.bg, borderRadius: 8 },
  headerBackText: { color: C.blue, fontWeight: '600', fontSize: 15 },
  headerIcon:     { fontSize: 13, fontWeight: '600', color: C.dark },
  profileIconBtn: { backgroundColor: C.primary, borderRadius: 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 0, paddingVertical: 0 },
  headerProfileIcon: { color: 'white', fontWeight: '800', fontSize: 14 },

  // Home Screen
  homeHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  homeGreeting:    { fontSize: 22, fontWeight: '800', color: '#1E293B' },
  homeSubtitle:    { fontSize: 14, color: C.muted, marginTop: 2 },
  homeProfileBtn:  { width: 40, height: 40, borderRadius: 20, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  homeProfileInitial: { fontSize: 18, fontWeight: '800', color: 'white' },
  homeContent:     { padding: 20, paddingBottom: 100 },
  homeCardPrimary: { backgroundColor: C.primary, borderRadius: 20, padding: 22, marginBottom: 12, elevation: 3 },
  homeCardSecondary: { backgroundColor: C.dark, borderRadius: 20, padding: 22, marginBottom: 12, elevation: 3 },
  homeCardTextBlock: {},
  homeCardTitle:   { fontSize: 20, fontWeight: '800', color: 'white' },
  homeCardSub:     { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  homeRow:         { flexDirection: 'row', gap: 12, marginBottom: 12 },
  homeSmallCard:   { flex: 1, borderRadius: 16, padding: 16, alignItems: 'center', justifyContent: 'center', elevation: 2, minHeight: 70 },
  homeSmallCardTitle: { color: 'white', fontWeight: '700', fontSize: 14, marginTop: 4, textAlign: 'center' },
  homeSignInBanner: { backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#BFDBFE' },
  homeSignInText:  { color: C.blue, fontWeight: '600', fontSize: 14 },
  homeActivePrefRow:        { marginTop: 12 },
  homeActivePrefHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  homeActivePrefLabel:      { color: C.muted, fontSize: 12 },
  homeActivePrefEditBtn:    { paddingHorizontal: 10, paddingVertical: 3, backgroundColor: C.primary, borderRadius: 12 },
  homeActivePrefEditText:   { color: 'white', fontSize: 12, fontWeight: '600' },
  activePrefChip:  { backgroundColor: '#DBEAFE', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6 },
  activePrefText:  { color: '#1D4ED8', fontSize: 12, fontWeight: '500' },

  // Cards / Typography
  card:            { backgroundColor: C.card, borderRadius: 20, padding: 20, elevation: 2, marginBottom: 8 },
  title:           { fontSize: 24, fontWeight: '800', color: '#1E293B', marginBottom: 6 },
  recipeDesc:      { fontSize: 14, color: C.muted, marginBottom: 10, lineHeight: 20 },
  sectionTitle:    { fontSize: 18, fontWeight: '700', color: C.dark, marginBottom: 10, marginTop: 4 },
  text:            { fontSize: 15, color: C.text, marginBottom: 6, lineHeight: 22 },
  divider:         { height: 1, backgroundColor: C.border, marginVertical: 15 },
  inputLabel:      { fontSize: 13, fontWeight: '600', color: C.dark, marginBottom: 4, marginTop: 8 },
  errorText:       { color: C.red, marginBottom: 10, fontSize: 14 },

  // Buttons
  btn:      { width: '100%', padding: 16, borderRadius: 12, alignItems: 'center' },
  btnText:  { color: 'white', fontSize: 16, fontWeight: '700' },
  addBtn:   { backgroundColor: C.dark, width: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  // List items
  stepRow:       { flexDirection: 'row', marginBottom: 12 },
  badge:         { width: 26, height: 26, borderRadius: 13, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1 },
  recipeMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  metaChip:      { fontSize: 12, color: C.muted, backgroundColor: C.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: C.border },

  // Recipe Select
  recipeCard:        { backgroundColor: C.card, borderRadius: 20, padding: 18, marginBottom: 14, elevation: 3, borderWidth: 1, borderColor: C.border },
  recipeCardHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  recipeCardTitle:   { fontSize: 18, fontWeight: '800', color: '#1E293B', flex: 1, marginRight: 8 },
  recipeCardDesc:    { fontSize: 13, color: C.muted, marginBottom: 8, lineHeight: 18 },
  recipeCardMeta:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  recipeCardIngredients: { fontSize: 13, color: C.muted, marginBottom: 10 },
  recipeCardArrow:   { fontSize: 14, color: C.primary, fontWeight: '700' },
  savedBadge:        { backgroundColor: '#D1FAE5', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  savedBadgeText:    { color: '#065F46', fontSize: 11, fontWeight: '600' },

  // Meal Plan
  mpDayCard:       { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 14, elevation: 2 },
  mpDayTitle:      { fontSize: 16, fontWeight: '800', color: C.dark, marginBottom: 10 },
  mpMealRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border, gap: 10 },
  mpMealLabelCol:  { width: 72 },
  mpMealType:      { fontSize: 11, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  mpMealTitle:     { fontSize: 14, fontWeight: '600', color: C.dark },
  mpMealTypeBadge: { fontSize: 12, fontWeight: '700', color: '#0F766E', backgroundColor: '#CCFBF1', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  mpSwapBtn:       { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#F1F5F9', borderRadius: 8, borderWidth: 1, borderColor: C.border },
  mpSwapText:      { fontSize: 12, fontWeight: '600', color: C.dark },

  // Inputs
  inputRow:   { flexDirection: 'row', marginBottom: 16 },
  input:      { flex: 1, backgroundColor: C.card, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginRight: 10, fontSize: 15 },
  authInput:  { backgroundColor: C.card, padding: 15, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 12, fontSize: 16 },
  footer:     { padding: 20, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.card },

  // Auth
  authTabs:         { flexDirection: 'row', backgroundColor: C.bg, borderRadius: 12, padding: 4, marginBottom: 24 },
  authTab:          { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  authTabActive:    { backgroundColor: C.card, elevation: 2 },
  authTabText:      { fontSize: 15, fontWeight: '600', color: C.muted },
  authTabTextActive: { color: '#1E293B' },
  authHeading:      { fontSize: 26, fontWeight: '800', color: '#1E293B', marginBottom: 6 },
  authSubHeading:   { fontSize: 14, color: C.muted, marginBottom: 20, lineHeight: 20 },
  forgotLink:       { color: C.blue, textAlign: 'center', fontSize: 14, fontWeight: '600', marginTop: 4 },

  // Dev token box (only shown when backend is in DEBUG mode)
  devTokenBox:   { backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#FCD34D' },
  devTokenLabel: { fontSize: 12, color: '#92400E', fontWeight: '600', marginBottom: 4 },
  devTokenValue: { fontSize: 28, fontWeight: '900', color: '#B45309', letterSpacing: 6, textAlign: 'center', marginVertical: 4 },
  devTokenNote:  { fontSize: 11, color: '#92400E', textAlign: 'center' },

  // Profile
  // Preferences
  prefsSectionTitle: { fontSize: 14, fontWeight: '700', color: C.dark, marginTop: 16, marginBottom: 8 },
  chipRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:              { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.border },
  chipSelected:      { backgroundColor: C.primary, borderColor: C.primary },
  chipText:          { fontSize: 13, color: C.dark, fontWeight: '500' },
  chipTextSelected:  { color: 'white', fontWeight: '600' },

  // Preferences summary bar on ingredients screen
  prefsSummaryRow:  { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, padding: 10, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  prefsSummaryLabel: { fontSize: 11, color: C.subtle, marginBottom: 4, fontWeight: '600' },
  prefsMiniChip:    { backgroundColor: '#DBEAFE', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6 },
  prefsMiniText:    { color: '#1D4ED8', fontSize: 12 },
  prefsEditBtn:     { backgroundColor: C.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: C.border },
  prefsEditText:    { color: C.dark, fontWeight: '600', fontSize: 13 },

  // Ingredient tags
  ingredientTag:     { flexDirection: 'row', backgroundColor: '#E0F2FE', padding: 10, borderRadius: 20, marginRight: 8, marginBottom: 8, alignItems: 'center' },
  ingredientTagText: { color: '#0369A1', fontSize: 14 },

  // Modal
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.card },
  modalHeaderSpacer: { width: 48 },
  modalTitle:  { fontSize: 18, fontWeight: '800', color: '#1E293B' },
  modalDone:   { color: C.primary, fontWeight: '700', fontSize: 16 },
  modalCancel: { color: C.red, fontWeight: '600', fontSize: 16 },

  // Camera
  cameraClose:      { position: 'absolute', top: 16, right: 20, padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
  cameraShutterRow: { position: 'absolute', bottom: 50, left: 0, right: 0, alignItems: 'center' },
  cameraShutterBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'white', borderWidth: 5, borderColor: '#ccc' },
});
