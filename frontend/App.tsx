import React, { useState, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Image, SafeAreaView, Platform, StatusBar } from 'react-native';
// IMPORT THE NEW CAMERA VIEW
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

// --- CONFIGURATION ---
const YOUR_LAPTOP_IP = '192.168.1.56'; 
const API_URL = `http://${YOUR_LAPTOP_IP}:8000/api/scan-ingredients/`; 
// ----------------------

interface Recipe {
  title: string;
  ingredients: string[];
  steps: string[];
}

export default function App() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaLibraryPermission, requestMediaLibraryPermission] = ImagePicker.useMediaLibraryPermissions();
  
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  
  const cameraRef = useRef<CameraView>(null);

  // --- Core Functions ---

  const goHome = () => {
    setPhotoUri(null);
    setRecipe(null);
    setIsCameraActive(false);
    setLoading(false);
  };

  const pickImageFromGallery = async () => {
    if (!mediaLibraryPermission?.granted) {
      const permissionResponse = await requestMediaLibraryPermission();
      if (!permissionResponse.granted) {
        Alert.alert("Permission Required", "Access to photos is needed. Please enable it in settings.");
        return;
      }
    }
    
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false, // DISABLED editing to prevent full-screen native crop UI issues
        quality: 0.5,
      });

      if (!result.canceled) {
        setPhotoUri(result.assets[0].uri);
        setRecipe(null);
        setIsCameraActive(false);
      }
    } catch (error) {
      console.error("Gallery Error:", error);
      Alert.alert("Error", "Could not open gallery.");
    }
  };

  const startCamera = async () => {
    if (!cameraPermission?.granted) {
      const permissionResponse = await requestCameraPermission();
      if (!permissionResponse.granted) {
        Alert.alert("Permission Required", "Camera access is needed.");
        return;
      }
    }
    
    setIsCameraActive(true);
    setRecipe(null); 
    setPhotoUri(null);
  };
  
  const capturePhoto = async () => {
      if (cameraRef.current) {
        try {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.5,
            base64: true,
            exif: false,
            skipProcessing: true, 
            shutterSound: false,
          });
          
          if (photo) {
            setPhotoUri(photo.uri);
            setIsCameraActive(false);
          }
        } catch (error) {
          Alert.alert("Camera Error", "Could not take photo.");
          console.error(error);
        }
      }
  };

  const retakePicture = () => {
    // Reset everything to go back to home state
    goHome();
  };

  const generateRecipe = async () => {
    if (!photoUri) return;

    setLoading(true); 
    setRecipe(null); 
    console.log(`Sending request to: ${API_URL}`);

    try {
      const formData = new FormData();
      formData.append('image', {
        uri: photoUri,
        name: 'scan.jpg',
        type: 'image/jpeg',
      } as any);

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setRecipe(data.recipe);
        Alert.alert("Success!", `Detected: ${data.detected_ingredients.join(', ')}`);
      } else {
        Alert.alert("Server Error", data.error || "Unknown server error");
      }

    } catch (error) {
      console.error("Network Error:", error);
      Alert.alert("Connection Failed", `Could not reach ${API_URL}.\n\n1. Check Django terminal is running.\n2. Check Laptop IP is correct.\n3. Check Phone is on same WiFi.`);
    } finally {
      setLoading(false); 
    }
  };
  
  // --- Rendering Logic ---

  if (!cameraPermission || !mediaLibraryPermission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#1E293B" />
        <Text style={{color: '#1E293B', marginTop:10}}>Loading Permissions...</Text>
      </View>
    );
  }

  // 1. RECIPE RESULT SCREEN
  if (photoUri && recipe) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={{flex: 1}}>
          <View style={styles.navHeader}>
             <TouchableOpacity onPress={goHome} style={styles.homeButton}>
                <Text style={styles.homeButtonText}>Home</Text>
             </TouchableOpacity>
          </View>
          
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.recipeCard}>
              <Text style={styles.header}>{recipe.title}</Text>
              
              <View style={styles.divider} />

              <Text style={styles.sectionHeader}>Ingredients</Text>
              {recipe.ingredients.map((item, index) => (
                <View key={index} style={styles.ingredientRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.listItem}>{item}</Text>
                </View>
              ))}

              <View style={styles.divider} />

              <Text style={styles.sectionHeader}>Instructions</Text>
              {recipe.steps.map((item, index) => (
                <View key={index} style={styles.stepRow}>
                  <View style={styles.stepNumberBadge}>
                    <Text style={styles.stepNumberText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{item}</Text>
                </View>
              ))}
            </View>
            
            <View style={{height: 80}} />
          </ScrollView>

          <View style={styles.bottomBar}>
              <TouchableOpacity style={[styles.button, styles.retakeButton]} onPress={retakePicture} disabled={loading}>
                  <Text style={styles.buttonText}>Scan New Item</Text>
              </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // 2. CAMERA SCREEN
  if (isCameraActive) {
    return (
      <View style={[styles.container, { backgroundColor: 'black' }]}>
        <CameraView style={styles.camera} facing="back" ref={cameraRef}>
          <View style={styles.cameraButtonContainer}>
            <TouchableOpacity style={styles.captureButton} onPress={capturePhoto}>
              <View style={styles.innerCaptureCircle} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setIsCameraActive(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  // 3. PHOTO PREVIEW SCREEN
  if (photoUri) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={styles.previewContainer}>
          <View style={styles.navHeader}>
             <Text style={styles.screenTitle}>Review Photo</Text>
             <TouchableOpacity onPress={goHome} style={styles.homeButton}>
                <Text style={styles.homeButtonText}>Home</Text>
             </TouchableOpacity>
          </View>
          
          <View style={styles.imageCard}>
            <Image source={{ uri: photoUri }} style={styles.previewImage} />
          </View>

          <View style={styles.actionPanel}>
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#10B981" />
                <Text style={styles.loadingText}>Thinking up a recipe...</Text>
              </View>
            ) : (
              <>
                  <TouchableOpacity style={[styles.button, styles.generateButton]} onPress={generateRecipe}>
                      <Text style={styles.buttonText}>Generate Recipe</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity style={[styles.button, styles.outlineButton]} onPress={retakePicture}>
                      <Text style={styles.outlineButtonText}>Retake Photo</Text>
                  </TouchableOpacity>
              </>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // 4. HOME SELECTION SCREEN
  return (
    <View style={styles.selectionContainer}>
        <View style={styles.logoContainer}>
          <Text style={styles.logoEmoji}>👨‍🍳</Text>
          <Text style={styles.appTitle}>Prep</Text>
          <Text style={styles.appSubtitle}>Your Personal AI Chef</Text>
        </View>

        <View style={styles.menuCard}>
          <Text style={styles.selectionPrompt}>How would you like to start?</Text>
          
          <TouchableOpacity style={[styles.button, styles.cameraModeButton]} onPress={startCamera}>
              <Text style={styles.buttonText}>Take Photo</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={[styles.button, styles.galleryModeButton]} onPress={pickImageFromGallery}>
              <Text style={styles.buttonText}>Open Gallery</Text>
          </TouchableOpacity>
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F5F9', // Light gray background
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  
  // --- NAV HEADER ---
  navHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    width: '100%',
  },
  homeButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 20,
    marginLeft: 'auto',
  },
  homeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },

  // --- SELECTION SCREEN ---
  selectionContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 30,
    backgroundColor: '#F1F5F9', // Force light background
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 50,
  },
  logoEmoji: {
    fontSize: 60,
    marginBottom: 10,
  },
  appTitle: {
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#1E293B', // Dark slate text
  },
  appSubtitle: {
    fontSize: 18,
    marginTop: 5,
    color: '#475569', // Secondary text
  },
  menuCard: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 5,
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    shadowOpacity: 0.05,
  },
  selectionPrompt: {
    fontSize: 18,
    marginBottom: 24,
    textAlign: 'center',
    fontWeight: '600',
    color: '#1E293B',
  },

  // --- PREVIEW SCREEN ---
  previewContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1E293B',
  },
  imageCard: {
    flex: 1, // Use available space instead of fixed aspect ratio
    width: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    marginBottom: 20,
    marginTop: 10,
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain', // Ensure full image is visible
  },
  actionPanel: {
    width: '100%',
    alignItems: 'center',
  },
  
  // --- CAMERA ---
  camera: {
    flex: 1,
  },
  cameraButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 50,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerCaptureCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
  },
  cancelButton: {
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
  },
  cancelText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },

  // --- RECIPE CARD ---
  recipeCard: {
    borderRadius: 24,
    padding: 24,
    margin: 20,
    marginTop: 10, 
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    backgroundColor: '#FFFFFF',
  },
  header: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 20,
    textAlign: 'center',
    color: '#1E293B',
  },
  divider: {
    height: 1,
    marginVertical: 20,
    backgroundColor: '#E2E8F0',
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#1E293B',
  },
  ingredientRow: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  bullet: {
    fontSize: 18,
    color: '#10B981', 
    marginRight: 10,
    marginTop: -2,
  },
  stepRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  stepNumberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#10B981', 
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: -2,
  },
  stepNumberText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  stepText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    color: '#475569',
  },
  listItem: {
    fontSize: 16,
    lineHeight: 24,
    flex: 1,
    color: '#475569',
  },

  // --- BUTTONS ---
  button: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 12,
  },
  cameraModeButton: {
    backgroundColor: '#10B981', 
  },
  galleryModeButton: {
    backgroundColor: '#334155', 
  },
  generateButton: {
    backgroundColor: '#10B981', 
  },
  retakeButton: {
    backgroundColor: '#10B981', 
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    elevation: 0,
    shadowOpacity: 0,
    borderColor: '#475569',
  },
  buttonText: {
    fontSize: 18,
    color: 'white',
    fontWeight: '700',
  },
  outlineButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#475569',
  },

  // --- UTILS ---
  loadingContainer: {
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '500',
    color: '#475569',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    borderTopWidth: 1,
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
  },
  scrollContent: {
    paddingBottom: 40,
  },
});