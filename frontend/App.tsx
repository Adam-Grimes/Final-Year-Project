import React, { useState, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  StyleSheet, Text, View, TouchableOpacity, ScrollView, 
  ActivityIndicator, Alert, Image, Platform, 
  TextInput, KeyboardAvoidingView, Keyboard 
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

// --- CONFIGURATION ---
// REPLACE THIS WITH YOUR LAPTOP'S LOCAL IP ADDRESS
const YOUR_LAPTOP_IP = '192.168.1.88'; 
const BASE_URL = `http://${YOUR_LAPTOP_IP}:8000/api`;

interface Recipe {
  title: string;
  ingredients: string[];
  steps: string[];
}

interface SavedRecipe extends Recipe {
  savedAt: string;
  backendId?: number;
}

function MainApp() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaLibraryPermission, requestMediaLibraryPermission] = ImagePicker.useMediaLibraryPermissions();
  
  // App States
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [isCameraActive, setIsCameraActive] = useState(false);
  
  // Logic States
  const [detectedIngredients, setDetectedIngredients] = useState<string[]>([]);
  const [isEditingIngredients, setIsEditingIngredients] = useState(false);
  const [newIngredientText, setNewIngredientText] = useState("");
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipe[]>([]);
  const [viewingSaved, setViewingSaved] = useState(false);
  const [viewingSavedRecipe, setViewingSavedRecipe] = useState<SavedRecipe | null>(null);

  // Auth States
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmailInput, setAuthEmailInput] = useState('');
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  
  const cameraRef = useRef<CameraView>(null);

  const STORAGE_KEY = 'saved_recipes';

  useEffect(() => {
    loadSavedRecipes();
    loadAuthToken();
  }, []);

  const loadSavedRecipes = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) setSavedRecipes(JSON.parse(stored));
    } catch (e) {
      console.log('Failed to load saved recipes:', e);
    }
  };

  const loadAuthToken = async () => {
    try {
      const token = await AsyncStorage.getItem('auth_token');
      const email = await AsyncStorage.getItem('auth_email');
      if (token && email) {
        setAuthToken(token);
        setAuthEmail(email);
        syncFromBackend(token);
      }
    } catch (e) {
      console.log('Failed to load auth token:', e);
    }
  };

  const syncFromBackend = async (token: string) => {
    try {
      const response = await fetch(`${BASE_URL}/recipes/`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const backendRecipes = await response.json();
        const merged: SavedRecipe[] = backendRecipes.map((r: any) => ({
          title: r.title,
          ingredients: r.ingredients,
          steps: r.steps,
          savedAt: r.created_at,
          backendId: r.id,
        }));
        setSavedRecipes(merged);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }
    } catch (e) {
      console.log('Backend sync failed, using local data:', e);
    }
  };

  const handleAuth = async () => {
    if (!authEmailInput.trim() || !authPasswordInput.trim()) {
      setAuthError('Please enter email and password.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const endpoint = authMode === 'login' ? 'auth/login/' : 'auth/register/';
      const response = await fetch(`${BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmailInput.trim(), password: authPasswordInput }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await response.json();
      if (response.ok) {
        await AsyncStorage.setItem('auth_token', data.access);
        await AsyncStorage.setItem('auth_email', data.email);
        setAuthToken(data.access);
        setAuthEmail(data.email);
        setShowAuth(false);
        setAuthEmailInput('');
        setAuthPasswordInput('');
        syncFromBackend(data.access);
      } else {
        setAuthError(data.error || JSON.stringify(data));
      }
    } catch (e: any) {
      clearTimeout(timeout);
      if (e?.name === 'AbortError') {
        setAuthError('Request timed out. Is the backend running and IP correct?');
      } else {
        setAuthError('Connection error. Is the backend running?');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('auth_token');
    await AsyncStorage.removeItem('auth_email');
    setAuthToken(null);
    setAuthEmail(null);
  };

  const saveRecipe = async (recipeToSave: Recipe) => {
    try {
      let backendId: number | undefined;
      if (authToken) {
        const response = await fetch(`${BASE_URL}/recipes/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
          body: JSON.stringify({ title: recipeToSave.title, ingredients: recipeToSave.ingredients, steps: recipeToSave.steps }),
        });
        if (response.ok) {
          const data = await response.json();
          backendId = data.id;
        }
      }
      const newEntry: SavedRecipe = { ...recipeToSave, savedAt: new Date().toISOString(), backendId };
      const updated = [...savedRecipes, newEntry];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setSavedRecipes(updated);
      Alert.alert('Saved!', `"${recipeToSave.title}" saved${authToken ? ' to your account & device' : ' to your device'}.`);
    } catch (e) {
      Alert.alert('Error', 'Could not save recipe.');
    }
  };

  const deleteRecipe = async (savedAt: string) => {
    try {
      const target = savedRecipes.find(r => r.savedAt === savedAt);
      if (target?.backendId && authToken) {
        await fetch(`${BASE_URL}/recipes/${target.backendId}/`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
      }
      const updated = savedRecipes.filter(r => r.savedAt !== savedAt);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setSavedRecipes(updated);
    } catch (e) {
      Alert.alert('Error', 'Could not delete recipe.');
    }
  };

  const isRecipeSaved = (title: string) => savedRecipes.some(r => r.title === title);

  // --- GLOBAL RESET (Universal Home) ---
  const goHome = () => {
    setPhotoUri(null);
    setRecipe(null);
    setDetectedIngredients([]);
    setIsEditingIngredients(false);
    setIsCameraActive(false);
    setLoading(false);
    setViewingSaved(false);
    setViewingSavedRecipe(null);
    setShowAuth(false);
  };

  // --- ACTIONS ---

  const startCamera = async () => {
    if (!cameraPermission?.granted) await requestCameraPermission();
    setIsCameraActive(true);
  };

  const pickImage = async () => {
    if (!mediaLibraryPermission?.granted) await requestMediaLibraryPermission();
    
    try {
      // FIX: Reverting to MediaTypeOptions to ensure button works. 
      // The warning is better than a broken button.
      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, 
        allowsEditing: false, 
        quality: 0.5,
      });

      if (!result.canceled) {
        // Reset old state before setting new image
        setRecipe(null);
        setDetectedIngredients([]);
        setIsEditingIngredients(false);
        setPhotoUri(result.assets[0].uri);
      }
    } catch (error) {
      console.log("Image Picker Error:", error);
      Alert.alert("Error", "Could not open gallery.");
    }
  };

  const capturePhoto = async () => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: true });
      if (photo) {
        setPhotoUri(photo.uri);
        setIsCameraActive(false);
      }
    }
  };

  // --- API CALLS ---

  const detectIngredients = async () => {
    if (!photoUri) return;
    setLoading(true);
    setLoadingText("Analyzing Image..."); // Updated Text

    try {
      const formData = new FormData();
      formData.append('image', {
        uri: photoUri,
        name: 'upload.jpg',
        type: 'image/jpeg',
      } as any);

      const response = await fetch(`${BASE_URL}/detect-ingredients/`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data' },
        body: formData,
      });

      const data = await response.json();
      if (response.ok) {
        setDetectedIngredients(data.detected_ingredients || []);
        setIsEditingIngredients(true);
      } else {
        Alert.alert("Error", data.error || "Detection failed");
      }
    } catch (error) {
      Alert.alert("Connection Error", "Is the backend running? Check IP address.");
    } finally {
      setLoading(false);
    }
  };

  const generateRecipe = async () => {
    setLoading(true);
    setLoadingText("Chef Gemini is cooking...");

    try {
      const response = await fetch(`${BASE_URL}/generate-recipe/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: detectedIngredients }),
      });

      const data = await response.json();
      if (response.ok) {
        setRecipe(data);
        setIsEditingIngredients(false);
      } else {
        Alert.alert("Error", data.error || "Recipe generation failed");
      }
    } catch (error) {
      Alert.alert("Error", "Could not fetch recipe");
    } finally {
      setLoading(false);
    }
  };

  // --- EDITOR HELPERS ---
  const addIngredient = () => {
    if (newIngredientText.trim()) {
      setDetectedIngredients([...detectedIngredients, newIngredientText.trim()]);
      setNewIngredientText("");
    }
  };
  const removeIngredient = (index: number) => {
    const newList = [...detectedIngredients];
    newList.splice(index, 1);
    setDetectedIngredients(newList);
  };

  // --- REUSABLE COMPONENTS ---
  
  // Universal Header with Home Button
  const Header = ({ title, showBack = false, onBack = () => {} }: { title?: string, showBack?: boolean, onBack?: () => void }) => (
    <View style={styles.navHeader}>
      <View style={{flexDirection:'row', alignItems:'center'}}>
        {showBack && (
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
        )}
        {title && <Text style={styles.screenTitle}>{title}</Text>}
      </View>
      
      {/* UNIVERSAL HOME BUTTON */}
      <TouchableOpacity onPress={goHome} style={styles.homeButton}>
        <Text style={styles.homeButtonText}>Home</Text>
      </TouchableOpacity>
    </View>
  );

  // --- RENDERING ---

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={{marginTop: 10, color: '#475569'}}>{loadingText}</Text>
      </View>
    );
  }

  // 0a. SAVED RECIPE DETAIL VIEW
  if (viewingSavedRecipe) {
    return (
      <SafeAreaView style={styles.container}>
        <Header showBack={true} onBack={() => setViewingSavedRecipe(null)} />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.card}>
            <Text style={styles.title}>{viewingSavedRecipe.title}</Text>
            <Text style={{color: '#94A3B8', marginBottom: 10, fontSize: 12}}>
              Saved {new Date(viewingSavedRecipe.savedAt).toLocaleDateString()}
            </Text>
            <View style={styles.divider}/>
            <Text style={styles.sectionTitle}>Ingredients</Text>
            {viewingSavedRecipe.ingredients?.map((item, i) => (
              <Text key={i} style={styles.text}>• {item}</Text>
            ))}
            <View style={styles.divider}/>
            <Text style={styles.sectionTitle}>Steps</Text>
            {viewingSavedRecipe.steps?.map((item, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.badge}><Text style={{color:'white'}}>{i+1}</Text></View>
                <Text style={[styles.text, {flex:1}]}>{item}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.btn, {marginTop: 20, backgroundColor: '#EF4444'}]}
            onPress={() => {
              Alert.alert('Delete Recipe', `Remove "${viewingSavedRecipe.title}" from saved?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => { deleteRecipe(viewingSavedRecipe.savedAt); setViewingSavedRecipe(null); } },
              ]);
            }}
          >
            <Text style={styles.btnText}>Delete Recipe 🗑️</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // 0b. SAVED RECIPES LIST SCREEN
  if (viewingSaved) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Saved Recipes" showBack={true} onBack={() => setViewingSaved(false)} />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {savedRecipes.length === 0 ? (
            <View style={{alignItems: 'center', marginTop: 60}}>
              <Text style={{fontSize: 40, marginBottom: 16}}>📭</Text>
              <Text style={{color: '#64748B', fontSize: 16}}>No saved recipes yet.</Text>
              <Text style={{color: '#94A3B8', fontSize: 14, marginTop: 8}}>Generate a recipe and tap Save!</Text>
            </View>
          ) : (
            savedRecipes.slice().reverse().map((item, i) => (
              <TouchableOpacity key={i} style={[styles.card, {marginBottom: 12}]} onPress={() => setViewingSavedRecipe(item)}>
                <Text style={styles.sectionTitle}>{item.title}</Text>
                <Text style={{color: '#94A3B8', fontSize: 12}}>
                  {item.ingredients?.length} ingredients · Saved {new Date(item.savedAt).toLocaleDateString()}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // 1. RECIPE SCREEN (Final)
  if (recipe) {
    return (
      <SafeAreaView style={styles.container}>
        <Header 
          showBack={true} 
          onBack={() => {
            // FIX: Clear recipe so we fall back to the Editor screen logic
            setRecipe(null);
            setIsEditingIngredients(true);
          }} 
        />
        
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.card}>
            <Text style={styles.title}>{recipe.title}</Text>
            <View style={styles.divider}/>
            
            <Text style={styles.sectionTitle}>Ingredients</Text>
            {recipe.ingredients?.map((item, i) => (
              <Text key={i} style={styles.text}>• {item}</Text>
            ))}
            
            <View style={styles.divider}/>
            <Text style={styles.sectionTitle}>Steps</Text>
            {recipe.steps?.map((item, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.badge}><Text style={{color:'white'}}>{i+1}</Text></View>
                <Text style={[styles.text, {flex:1}]}>{item}</Text>
              </View>
            ))}
          </View>
          
          {!isRecipeSaved(recipe.title) ? (
            <TouchableOpacity style={[styles.btn, {marginTop: 20, backgroundColor: '#10B981'}]} onPress={() => saveRecipe(recipe)}>
              <Text style={styles.btnText}>Save Recipe 💾</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.btn, {marginTop: 20, backgroundColor: '#D1FAE5'}]}>
              <Text style={[styles.btnText, {color: '#065F46'}]}>✓ Recipe Saved</Text>
            </View>
          )}

          <TouchableOpacity style={[styles.btn, {marginTop: 10, backgroundColor: '#334155'}]} onPress={goHome}>
            <Text style={styles.btnText}>Start Over</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // 2. EDITOR SCREEN
  if (isEditingIngredients) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex:1}}>
          <Header 
            title="Pantry Check"
            showBack={true}
            onBack={() => setIsEditingIngredients(false)} // Falls back to Preview (photoUri)
          />
          
          <View style={{padding: 20}}>
            <Text style={{color:'#64748B', marginBottom: 15}}>Confirm what we found:</Text>
            
            <View style={styles.inputRow}>
              <TextInput 
                style={styles.input} 
                placeholder="Add item..." 
                value={newIngredientText}
                onChangeText={setNewIngredientText}
              />
              <TouchableOpacity style={styles.addBtn} onPress={addIngredient}>
                <Text style={{color:'white', fontWeight:'bold'}}>+</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{maxHeight: 400}}>
              <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
                {detectedIngredients.map((item, index) => (
                  <View key={index} style={styles.tag}>
                    <Text style={{color: '#0369A1'}}>{item}</Text>
                    <TouchableOpacity onPress={() => removeIngredient(index)} style={{marginLeft: 8}}>
                      <Text style={{color: '#0369A1', fontWeight: 'bold'}}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={[styles.btn, {backgroundColor: '#10B981'}]} onPress={generateRecipe}>
              <Text style={styles.btnText}>Generate Recipe 🍳</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // 3. PREVIEW SCREEN
  if (photoUri) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Review Photo" />
        <View style={{flex: 1, padding: 20}}>
          <Image source={{ uri: photoUri }} style={{flex: 1, borderRadius: 20, marginBottom: 20}} resizeMode="contain"/>
          
          <TouchableOpacity style={[styles.btn, {backgroundColor: '#10B981', marginBottom: 10}]} onPress={detectIngredients}>
            <Text style={styles.btnText}>Analyze Image</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={[styles.btn, {backgroundColor: '#334155'}]} onPress={goHome}>
            <Text style={styles.btnText}>Retake</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 4. CAMERA
  if (isCameraActive) {
    return (
      <CameraView style={{flex: 1}} facing="back" ref={cameraRef}>
        <View style={{position:'absolute', top: 50, right: 20}}>
           <TouchableOpacity onPress={goHome}><Text style={{color:'white', fontSize: 18, fontWeight:'bold'}}>✕</Text></TouchableOpacity>
        </View>
        <View style={{position:'absolute', bottom:50, alignSelf:'center'}}>
          <TouchableOpacity onPress={capturePhoto} style={{width:70, height:70, borderRadius:35, backgroundColor:'white', borderWidth:5, borderColor:'#ccc'}}/>
        </View>
      </CameraView>
    );
  }

  // 5. HOME SCREEN
  if (showAuth) {
    return (
      <SafeAreaView style={styles.container}>
        <Header showBack={true} onBack={() => { setShowAuth(false); setAuthError(''); }} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex:1}}>
          <ScrollView contentContainerStyle={{padding: 24, paddingTop: 32}} keyboardShouldPersistTaps="handled">
            <Text style={[styles.title, {marginBottom: 4}]}>{authMode === 'login' ? 'Sign In' : 'Create Account'}</Text>
            <Text style={{color:'#64748B', marginBottom: 24}}>
              {authMode === 'login' ? 'Sign in to sync your recipes across devices.' : 'Create an account to back up recipes to the cloud.'}
            </Text>

            <TextInput
              style={styles.authInput}
              placeholder="Email address"
              value={authEmailInput}
              onChangeText={setAuthEmailInput}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TextInput
              style={styles.authInput}
              placeholder="Password"
              value={authPasswordInput}
              onChangeText={setAuthPasswordInput}
              secureTextEntry
            />

            {authError ? <Text style={{color:'#EF4444', marginBottom: 12}}>{authError}</Text> : null}

            <TouchableOpacity
              style={[styles.btn, {backgroundColor: '#3B82F6', marginBottom: 12}]}
              onPress={handleAuth}
              disabled={authLoading}
            >
              {authLoading
                ? <ActivityIndicator color="white" />
                : <Text style={styles.btnText}>{authMode === 'login' ? 'Sign In' : 'Register'}</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}>
              <Text style={{color:'#3B82F6', textAlign:'center', fontSize: 14}}>
                {authMode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign In'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.centerContainer}>
      <Text style={{fontSize: 48, marginBottom: 40, fontWeight: '900', color: '#1E293B', letterSpacing: 2}}>Prep</Text>
      
      <TouchableOpacity style={[styles.btn, {backgroundColor: '#10B981', marginBottom: 15}]} onPress={startCamera}>
        <Text style={styles.btnText}>Take Photo</Text>
      </TouchableOpacity>
      
      <TouchableOpacity style={[styles.btn, {backgroundColor: '#334155'}]} onPress={pickImage}>
        <Text style={styles.btnText}>Upload from Gallery</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.btn, {backgroundColor: '#7C3AED', marginTop: 15}]} onPress={() => setViewingSaved(true)}>
        <Text style={styles.btnText}>Saved Recipes 💾{savedRecipes.length > 0 ? ` (${savedRecipes.length})` : ''}</Text>
      </TouchableOpacity>

      {authToken ? (
        <View style={{marginTop: 20, alignItems: 'center'}}>
          <Text style={{color: '#64748B', fontSize: 13, marginBottom: 8}}>✓ Signed in as {authEmail}</Text>
          <TouchableOpacity onPress={handleLogout}>
            <Text style={{color: '#EF4444', fontSize: 13, fontWeight: '600'}}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={{marginTop: 20}} onPress={() => { setShowAuth(true); setAuthMode('login'); }}>
          <Text style={{color: '#3B82F6', fontSize: 14, fontWeight: '600'}}>Sign in to sync recipes across devices</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F1F5F9', padding: 20 },
  scrollContent: { padding: 20, paddingBottom: 50 },
  
  // HEADER
  navHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingVertical: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0'
  },
  screenTitle: { fontSize: 18, fontWeight: '800', color: '#1E293B', marginLeft: 10 },
  homeButton: { padding: 8, backgroundColor: '#F1F5F9', borderRadius: 8 },
  homeButtonText: { fontSize: 14, fontWeight: '600', color: '#334155' },
  backButton: { padding: 5 },
  backButtonText: { color: '#3B82F6', fontWeight: '600', fontSize: 16 },

  // CARDS & UI
  card: { backgroundColor: 'white', borderRadius: 20, padding: 20, elevation: 3 },
  title: { fontSize: 24, fontWeight: '800', color: '#1E293B', marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#334155', marginBottom: 10 },
  text: { fontSize: 16, color: '#475569', marginBottom: 6, lineHeight: 22 },
  divider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 15 },
  
  // BUTTONS
  btn: { width: '100%', padding: 16, borderRadius: 12, alignItems: 'center' },
  btnText: { color: 'white', fontSize: 16, fontWeight: '700' },
  addBtn: { backgroundColor: '#334155', width: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  
  // LIST ITEMS
  stepRow: { flexDirection: 'row', marginBottom: 12 },
  badge: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  tag: { flexDirection: 'row', backgroundColor: '#E0F2FE', padding: 10, borderRadius: 20, marginRight: 8, marginBottom: 8 },
  
  // INPUTS
  inputRow: { flexDirection: 'row', marginBottom: 20 },
  input: { flex: 1, backgroundColor: 'white', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', marginRight: 10 },
  authInput: { backgroundColor: 'white', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12, fontSize: 16 },
  footer: { padding: 20, borderTopWidth: 1, borderColor: '#E2E8F0', backgroundColor: 'white' },
});