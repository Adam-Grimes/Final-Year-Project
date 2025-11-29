import { useState } from 'react';
import { StyleSheet, Text, View, Button, Image, ScrollView, ActivityIndicator, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';

// ip address of the backend server
const API_URL = 'http://192.168.1.56:8000/api/scan-ingredients/'; 

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recipeData, setRecipeData] = useState<any>(null);

  const pickImage = async () => {
    // Request permission to access media library
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (permissionResult.granted === false) {
      Alert.alert("Permission to access camera roll is required!");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled) {
      setImage(result.assets[0].uri);
      setRecipeData(null); // Reset previous results
    }
  };

  const generateRecipe = async () => {
    if (!image) return;

    setLoading(true);
    try {
      // Create FormData to send the file
      const formData = new FormData();
      formData.append('image', {
        uri: image,
        name: 'upload.jpg',
        type: 'image/jpeg',
      } as any); // 'as any' is needed to satisfy TypeScript in React Native for FormData

      const response = await axios.post(API_URL, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setRecipeData(response.data);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to connect to backend');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Prep: AI Chef</Text>

      <Button title="Pick an Ingredient Photo" onPress={pickImage} />

      {image && (
        <Image source={{ uri: image }} style={styles.image} />
      )}

      {image && (
        <View style={styles.buttonContainer}>
          <Button 
            title={loading ? "Generating..." : "Generate Recipe"} 
            onPress={generateRecipe} 
            disabled={loading} 
          />
        </View>
      )}

      {loading && <ActivityIndicator size="large" color="#0000ff" style={{marginTop: 20}}/>}

      {recipeData && (
        <View style={styles.resultContainer}>
          <Text style={styles.subHeader}>Detected: {recipeData.detected_ingredients.join(', ')}</Text>
          
          <View style={styles.card}>
            <Text style={styles.recipeTitle}>{recipeData.recipe.title}</Text>
            
            <Text style={styles.sectionTitle}>Ingredients:</Text>
            {recipeData.recipe.ingredients.map((item: string, index: number) => (
              <Text key={index} style={styles.text}>• {item}</Text>
            ))}

            <Text style={styles.sectionTitle}>Steps:</Text>
            {recipeData.recipe.steps.map((step: string, index: number) => (
              <Text key={index} style={styles.text}>{index + 1}. {step}</Text>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#f5f5f5',
    minHeight: '100%',
  },
  header: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  image: {
    width: '100%',
    height: 250,
    borderRadius: 10,
    marginVertical: 20,
  },
  buttonContainer: {
    marginBottom: 20,
  },
  resultContainer: {
    marginTop: 20,
  },
  subHeader: {
    fontSize: 18,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  card: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    elevation: 3, // Shadow for Android
    shadowColor: '#000', // Shadow for iOS
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
  },
  recipeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#2c3e50',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 5,
  },
  text: {
    fontSize: 16,
    marginBottom: 5,
    lineHeight: 22,
  },
});