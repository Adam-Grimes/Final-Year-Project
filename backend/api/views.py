import os
import json
from PIL import Image
import google.generativeai as genai
from ultralytics import YOLOWorld
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework import status
from dotenv import load_dotenv
from pathlib import Path

# --- CONFIGURATION ---
# Robust .env loading
CURRENT_DIR = Path(__file__).resolve().parent
ENV_PATH = CURRENT_DIR / '.env'
load_dotenv(dotenv_path=ENV_PATH)

GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')
# Fallback Key (Only if .env fails)

genai.configure(api_key=GOOGLE_API_KEY)

print("Loading AI Models...")
GEMINI_MODEL_NAME = "models/gemini-2.5-flash"
gemini_model = genai.GenerativeModel(GEMINI_MODEL_NAME)

yolo_model = YOLOWorld("yolov8l-worldv2.pt")
yolo_model.set_classes([
    "bottle", "jar", "food package", "vegetable", "fruit",
    "meat package", "carton", "can", "tub", "container"
])
print("AI Models Loaded.")

class DetectIngredientsView(APIView):
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, *args, **kwargs):
        if 'image' not in request.FILES:
            return Response({"error": "No image provided"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            image_file = request.FILES['image']
            original_img = Image.open(image_file).convert('RGB')

            # 1. Run YOLO
            print("Running YOLO...")
            results = yolo_model.predict(original_img, conf=0.05, verbose=False)
            
            prompt_parts = []
            crops_found = False

            # 2. Check for Detections
            if results[0].boxes and len(results[0].boxes) > 0:
                print(f"YOLO found {len(results[0].boxes)} items. preparing crops...")
                
                # Base prompt for Hybrid Mode
                prompt_parts.append(
                    "You are an AI Chef. Identify the food ingredients in these cropped images. "
                    "Ignore non-food items. Return a JSON object with a single list called 'ingredients'."
                )
                prompt_parts.append(original_img) # Context

                for box in results[0].boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                    width, height = original_img.size
                    
                    # Safety check for crop boundaries
                    x1, y1 = max(0, x1), max(0, y1)
                    x2, y2 = min(width, x2), min(height, y2)

                    if x2 > x1 and y2 > y1:
                        cropped = original_img.crop((x1, y1, x2, y2))
                        prompt_parts.append(cropped)
                        crops_found = True
            
            # 3. FALLBACK: If YOLO found nothing, force Full Image Scan
            if not crops_found:
                print("YOLO found nothing. Switching to Full Image Scan...")
                prompt_parts = [
                    "Analyze this photo of food ingredients. List every edible ingredient you can see. "
                    "Return a JSON object with a single list called 'ingredients'.",
                    original_img
                ]

            # 4. JSON Schema
            json_schema = {
                "type": "object",
                "properties": {
                    "ingredients": { 
                        "type": "array", 
                        "items": {"type": "string"} 
                    }
                },
                "required": ["ingredients"]
            }

            # 5. Call Gemini
            print("Calling Gemini...")
            response = gemini_model.generate_content(
                prompt_parts,
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json",
                    response_schema=json_schema
                )
            )

            # 6. Parse & Return
            print(f"Gemini Response: {response.text}")
            data = json.loads(response.text)
            ingredients = data.get("ingredients", [])
            
            return Response({"detected_ingredients": ingredients}, status=status.HTTP_200_OK)

        except Exception as e:
            print(f"Detection Error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class GenerateRecipeView(APIView):
    parser_classes = (JSONParser,)

    def post(self, request, *args, **kwargs):
        ingredients = request.data.get('ingredients', [])
        ingredients_str = ", ".join(ingredients) if ingredients else "nothing"
        
        try:
            print(f"Generating recipe for: {ingredients_str}")
            prompt = f"""
            Create a simple recipe using: {ingredients_str}.
            Assume basic pantry staples (oil, salt, pepper).
            """
            
            recipe_schema = {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "ingredients": { "type": "array", "items": {"type": "string"} },
                    "steps": { "type": "array", "items": {"type": "string"} }
                },
                "required": ["title", "ingredients", "steps"]
            }
            
            response = gemini_model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json",
                    response_schema=recipe_schema
                )
            )
            
            return Response(json.loads(response.text), status=status.HTTP_200_OK)

        except Exception as e:
            print(f"Recipe Error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)