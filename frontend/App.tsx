import React, { useState, useRef } from 'react';
import { 
  StyleSheet, Text, View, TouchableOpacity, ScrollView, 
  ActivityIndicator, Alert, Image, SafeAreaView, Platform, 
  TextInput, KeyboardAvoidingView, Keyboard 
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

// --- CONFIGURATION ---
// ⚠️ REPLACE THIS WITH YOUR LAPTOP'S LOCAL IP ADDRESS
const YOUR_LAPTOP_IP = '192.168.1.56'; 
const BASE_URL = `http://${YOUR_LAPTOP_IP}:8000/api`;

interface Recipe {
  title: string;
  ingredients: string[];
  steps: string[];
}

export default function App() {
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
  
  const cameraRef = useRef<CameraView>(null);

  // --- GLOBAL RESET (Universal Home) ---
  const goHome = () => {
    setPhotoUri(null);
    setRecipe(null);
    setDetectedIngredients([]);
    setIsEditingIngredients(false);
    setIsCameraActive(false);
    setLoading(false);
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

  // 1. RECIPE SCREEN (Final)
  if (recipe) {
    return (
      <SafeAreaView style={styles.container}>
        <Header onBack={() => setIsEditingIngredients(true)} showBack={true} />
        
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
          
          <TouchableOpacity style={[styles.btn, {marginTop: 20, backgroundColor: '#334155'}]} onPress={goHome}>
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
          <Header title="Pantry Check" />
          
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
  return (
    <View style={styles.centerContainer}>
      <Text style={{fontSize: 48, marginBottom: 40, fontWeight: '900', color: '#1E293B', letterSpacing: 2}}>Prep</Text>
      
      <TouchableOpacity style={[styles.btn, {backgroundColor: '#10B981', marginBottom: 15}]} onPress={startCamera}>
        <Text style={styles.btnText}>Take Photo</Text>
      </TouchableOpacity>
      
      <TouchableOpacity style={[styles.btn, {backgroundColor: '#334155'}]} onPress={pickImage}>
        <Text style={styles.btnText}>Upload from Gallery</Text>
      </TouchableOpacity>
    </View>
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
  footer: { padding: 20, borderTopWidth: 1, borderColor: '#E2E8F0', backgroundColor: 'white' },
});