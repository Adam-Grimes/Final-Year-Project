import os
import json
import random
from datetime import timedelta
from PIL import Image
import google.generativeai as genai
from ultralytics import YOLOWorld
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate, get_user_model
from django.utils import timezone
from dotenv import load_dotenv
from pathlib import Path
from .models import SavedRecipe, UserProfile, PasswordResetToken
from .serializers import (
    RegisterSerializer, SavedRecipeSerializer,
    UserProfileSerializer, ChangePasswordSerializer,
)

User = get_user_model()

# --- CONFIGURATION ---
# Robust .env loading
CURRENT_DIR = Path(__file__).resolve().parent
ENV_PATH = CURRENT_DIR / '.env'
# If not found in the api folder, look one level up (backend/.env)
if not ENV_PATH.exists():
    ENV_PATH = CURRENT_DIR.parent / '.env'
load_dotenv(dotenv_path=ENV_PATH)

GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)
else:
    print(f"WARNING: GOOGLE_API_KEY not found in {ENV_PATH}. Gemini API will be unavailable.")

yolo_model = YOLOWorld("yolov8l-worldv2.pt")
print("Loading AI Models...")
GEMINI_MODEL_NAME = "models/gemini-2.5-flash"
# Only instantiate the Gemini model if we have an API key
gemini_model = None
if GOOGLE_API_KEY:
    gemini_model = genai.GenerativeModel(GEMINI_MODEL_NAME)
else:
    print("Gemini model skipped due to missing API key.")
yolo_model.set_classes([
    "bottle", "jar", "food package", "vegetable", "fruit",
    "meat package", "carton", "can", "tub", "container"
])
print("AI Models Loaded.")

class DetectIngredientsView(APIView):
    parser_classes = (MultiPartParser, FormParser)
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        if 'image' not in request.FILES:
            return Response({"error": "No image provided"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            if gemini_model is None:
                return Response({"error": "Server misconfigured: missing GOOGLE_API_KEY"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
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
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        ingredients = request.data.get('ingredients', [])
        ingredients_str = ", ".join(ingredients) if ingredients else "nothing"
        count = min(max(int(request.data.get('count', 3)), 1), 5)

        # Start with preferences from the request body
        preferences = dict(request.data.get('preferences', {}))

        # If the user is authenticated, fill in any missing prefs from their profile
        if request.user and request.user.is_authenticated:
            try:
                profile = request.user.profile
                if not preferences.get('cuisines') and profile.cuisine_preferences:
                    preferences['cuisines'] = [p.strip() for p in profile.cuisine_preferences.split(',') if p.strip()]
                if not preferences.get('dietary') and profile.dietary_restrictions:
                    preferences['dietary'] = [p.strip() for p in profile.dietary_restrictions.split(',') if p.strip()]
                if not preferences.get('allergies') and profile.allergies:
                    preferences['allergies'] = [p.strip() for p in profile.allergies.split(',') if p.strip()]
                if not preferences.get('calorieGoal') and profile.calorie_goal:
                    preferences['calorieGoal'] = profile.calorie_goal
                if not preferences.get('cookingSkill') and profile.cooking_skill:
                    preferences['cookingSkill'] = profile.cooking_skill
                if not preferences.get('customText') and profile.custom_preferences:
                    preferences['customText'] = profile.custom_preferences
            except UserProfile.DoesNotExist:
                pass

        # Build the preferences section of the prompt
        pref_parts = []

        cuisines = preferences.get('cuisines', [])
        if cuisines:
            pref_parts.append(
                f"Cuisine style: {', '.join(cuisines)} "
                f"(context: Irish market – use ingredients available in Tesco Ireland, Dunnes Stores, SuperValu)"
            )
        else:
            pref_parts.append(
                "Cuisine style: Irish home cooking "
                "(use everyday ingredients available in Irish supermarkets like Tesco, Dunnes Stores, SuperValu)"
            )

        dietary = [d for d in preferences.get('dietary', []) if d and d != 'No Restrictions']
        if dietary:
            pref_parts.append(f"Dietary requirements: {', '.join(dietary)}")

        allergies = [a for a in preferences.get('allergies', []) if a and a != 'None']
        if allergies:
            pref_parts.append(
                f"CRITICAL ALLERGEN WARNING – recipe MUST NOT contain: {', '.join(allergies)}. "
                f"Double-check every ingredient for hidden sources of these allergens."
            )

        calorie_goal = preferences.get('calorieGoal', 2000)
        meal_calories = calorie_goal // 3
        pref_parts.append(
            f"Target calories per serving: ~{meal_calories} kcal "
            f"(as part of a {calorie_goal} kcal daily goal)"
        )

        cooking_skill = preferences.get('cookingSkill', 'Intermediate')
        pref_parts.append(f"Cooking skill level: {cooking_skill}")

        custom_text = preferences.get('customText', '').strip()
        if custom_text:
            pref_parts.append(f"Additional preferences: {custom_text}")

        pref_string = "\n".join(f"  - {p}" for p in pref_parts)

        try:
            if gemini_model is None:
                return Response(
                    {"error": "Server misconfigured: missing GOOGLE_API_KEY"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

            prompt = f"""You are an AI Chef assistant for an Irish cooking app called Prep.
Generate exactly {count} distinct recipe options based on the available ingredients and user preferences below.

Available ingredients: {ingredients_str}

User preferences:
{pref_string}

Rules:
- You do not need to use all ingredients; assume basic pantry staples are available (oil, butter, salt, pepper, garlic).
- Each recipe must be noticeably different (vary cooking method, flavour profile, or cuisine angle).
- STRICTLY follow all dietary requirements and allergen warnings – this is a food safety requirement.
- Adapt portions for a typical Irish household (serves 2–4).
- Include realistic prep_time and cook_time strings (e.g. "10 mins", "25 mins").
- Provide a short one-sentence description for each recipe.
- Estimate calories per serving as an integer.
"""

            recipe_schema = {
                "type": "object",
                "properties": {
                    "recipes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title":       {"type": "string"},
                                "description": {"type": "string"},
                                "calories":    {"type": "integer"},
                                "servings":    {"type": "integer"},
                                "prep_time":   {"type": "string"},
                                "cook_time":   {"type": "string"},
                                "ingredients": {"type": "array", "items": {"type": "string"}},
                                "steps":       {"type": "array", "items": {"type": "string"}},
                            },
                            "required": ["title", "ingredients", "steps"],
                        },
                    }
                },
                "required": ["recipes"],
            }

            response = gemini_model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json",
                    response_schema=recipe_schema,
                ),
            )

            data = json.loads(response.text)
            return Response(data, status=status.HTTP_200_OK)

        except Exception as e:
            print(f"Recipe Error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# --- AUTH VIEWS ---

class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            refresh = RefreshToken.for_user(user)
            return Response({
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'email': user.email,
            }, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get('email')
        password = request.data.get('password')
        user = authenticate(request, email=email, password=password)
        if user:
            refresh = RefreshToken.for_user(user)
            return Response({
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'email': user.email,
            })
        return Response({'error': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)


class UserProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        return Response(UserProfileSerializer(profile).data)

    def put(self, request):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        serializer = UserProfileSerializer(profile, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        old_password = serializer.validated_data['old_password']
        new_password = serializer.validated_data['new_password']

        if not request.user.check_password(old_password):
            return Response(
                {'error': 'Current password is incorrect.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        request.user.set_password(new_password)
        request.user.save()
        return Response({'message': 'Password changed successfully.'})


class ForgotPasswordView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get('email', '').strip().lower()
        if not email:
            return Response({'error': 'Email is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # Avoid email enumeration – always report success
            return Response({'message': 'If that email is registered, a reset code has been sent.'})

        # Invalidate any existing unused tokens for this user
        PasswordResetToken.objects.filter(user=user, is_used=False).update(is_used=True)

        token = str(random.randint(100000, 999999))
        PasswordResetToken.objects.create(user=user, token=token)

        # In production send this via email. For development we echo it back.
        print(f"[DEV] Password reset token for {email}: {token}")
        return Response({
            'message': 'If that email is registered, a reset code has been sent.',
            'dev_token': token,  # Remove / replace with email send in production
        })


class ResetPasswordView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get('email', '').strip().lower()
        token = request.data.get('token', '').strip()
        new_password = request.data.get('new_password', '')

        if not all([email, token, new_password]):
            return Response(
                {'error': 'Email, token, and new password are all required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(new_password) < 6:
            return Response(
                {'error': 'Password must be at least 6 characters.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response({'error': 'Invalid reset request.'}, status=status.HTTP_400_BAD_REQUEST)

        cutoff = timezone.now() - timedelta(hours=1)
        reset_token = PasswordResetToken.objects.filter(
            user=user, token=token, is_used=False, created_at__gte=cutoff
        ).first()

        if not reset_token:
            return Response(
                {'error': 'Invalid or expired reset code. Please request a new one.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.save()
        reset_token.is_used = True
        reset_token.save()

        return Response({'message': 'Password reset successfully. Please sign in with your new password.'})


# --- SAVED RECIPE VIEWS ---

class SavedRecipeListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        recipes = SavedRecipe.objects.filter(user=request.user)
        serializer = SavedRecipeSerializer(recipes, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = SavedRecipeSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(user=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class SavedRecipeDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        try:
            recipe = SavedRecipe.objects.get(pk=pk, user=request.user)
            recipe.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except SavedRecipe.DoesNotExist:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
