import os
import json
import google.generativeai as genai
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework import status
from dotenv import load_dotenv

# --- Configuration ---
load_dotenv()
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')
# Ensure the API key is loaded before configuring
if not GOOGLE_API_KEY:
    raise ValueError("GOOGLE_API_KEY not found in .env file.")

genai.configure(api_key=GOOGLE_API_KEY)

class ScanIngredientsView(APIView):
    # We still accept the image for the complete technical flow, but we ignore it.
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, *args, **kwargs):
        
        # --- MOCK YOLO OUTPUT ---
        # 1. This list represents the output you expect from your YOLO model.
        #    We ignore the image file (request.FILES['image']) for now.
        detected_ingredients = ["Tomato", "Egg", "Onion", "Spinach", "Parmesan Cheese"]
        
        # Convert list to a comma-separated string for the prompt
        ingredients_string = ", ".join(detected_ingredients)
        
        try:
            # 2. Configure Gemini (using 2.5 Flash for fast text generation)
            model = genai.GenerativeModel('gemini-2.5-flash')

            # 3. The Prompt - Asking the AI to use the supplied text list
            prompt = f"""
            Using ONLY the following list of ingredients: {ingredients_string}.
            Suggest ONE simple, creative recipe that uses as many of these ingredients as possible.
            
            Return ONLY a raw JSON object (no markdown formatting, no ```json tags).
            The JSON must exactly match this structure:
            {{
                "detected_ingredients": {json.dumps(detected_ingredients)},
                "recipe": {{
                    "title": "Recipe Title",
                    "ingredients": ["qty item1", "qty item2"],
                    "steps": ["Step 1...", "Step 2..."]
                }}
            }}
            """

            # 4. Call the AI
            response = model.generate_content(prompt)
            
            # 5. Clean and Parse Response
            # Stripping potential markdown tags added by the model for cleaner parsing
            response_text = response.text.replace("```json", "").replace("```", "").strip()
            data = json.loads(response_text)

            return Response(data, status=status.HTTP_200_OK)

        except Exception as e:
            print(f"Gemini API Error: {e}") 
            # If the JSON parsing fails (or API key is bad), return 500
            return Response(
                {"error": f"Failed to generate recipe from text. Error: {e}"}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )