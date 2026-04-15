import os
import json
import random
import threading
from datetime import timedelta
from PIL import Image
import google.generativeai as genai
import google.api_core.exceptions
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate, get_user_model
from django.conf import settings
from django.utils import timezone
from dotenv import load_dotenv
from pathlib import Path
from .models import SavedRecipe, UserProfile, PasswordResetToken, MealPlan, MealPlanDay, MealPlanMeal
from .serializers import (
    RegisterSerializer, SavedRecipeSerializer,
    UserProfileSerializer, ChangePasswordSerializer,
    MealPlanSerializer, MealPlanMealSerializer,
)

User = get_user_model()

# --- THROTTLE CLASSES ---

class AuthRateThrottle(AnonRateThrottle):
    """10 requests/minute for auth endpoints (login, register, password reset)."""
    scope = 'auth'

class AIAnonThrottle(AnonRateThrottle):
    """20 requests/hour for unauthenticated AI calls."""
    scope = 'ai_anon'

class AIUserThrottle(UserRateThrottle):
    """60 requests/hour for authenticated AI calls."""
    scope = 'ai_user'

# --- CONFIGURATION ---
# Robust .env loading
CURRENT_DIR = Path(__file__).resolve().parent
ENV_PATH = CURRENT_DIR / '.env'
# If not found in the api folder, look one level up (backend/.env)
if not ENV_PATH.exists():
    ENV_PATH = CURRENT_DIR.parent / '.env'
load_dotenv(dotenv_path=ENV_PATH)

# Prefer Django's BASE_DIR when available (avoids NameError during import)
BASE_DIR = Path(getattr(settings, 'BASE_DIR', CURRENT_DIR.parent)).resolve()

GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')
GEMINI_MODEL_NAME = "models/gemini-2.5-flash-lite"
GEMINI_DETECT_MODEL_NAME = "models/gemini-2.5-flash"

# AI models are heavy; avoid loading or downloading them at import time.
YOLO_MODEL_PATH = BASE_DIR / 'yolov8l-worldv2.pt'

_ai_init_lock = threading.Lock()

# Backwards-compatible globals (tests patch these).
# - `None` means "disabled/misconfigured".
# - `_UNSET` means "not initialized yet".
_UNSET = object()
gemini_model = _UNSET
gemini_detect_model = _UNSET
yolo_model = _UNSET

YOLO_CLASSES = [
    # Packaging / containers
    "bottle", "jar", "can", "tin", "carton", "tub", "container",
    "food package", "food bag", "plastic bag", "wrapper", "box",
    "sauce bottle", "condiment bottle", "oil bottle", "milk carton",
    # Fresh produce
    "vegetable", "fruit", "herb", "salad", "leafy green",
    "potato", "onion", "garlic", "tomato", "pepper", "carrot",
    "broccoli", "mushroom", "cucumber", "courgette", "lemon", "lime",
    # Meat & protein
    "meat", "meat package", "chicken", "beef", "pork", "fish", "egg",
    "deli meat", "sausage", "bacon",
    # Dairy
    "cheese", "butter", "yogurt", "cream",
    # Dry / pantry
    "bread", "pasta", "rice bag", "cereal box", "flour bag",
]


def get_gemini_model():
    """Return a cached Gemini lite model instance or None if not configured."""
    global gemini_model
    if gemini_model is None:
        return None
    if gemini_model is not _UNSET:
        return gemini_model
    if not GOOGLE_API_KEY:
        gemini_model = None
        return None
    with _ai_init_lock:
        if gemini_model is _UNSET:
            genai.configure(api_key=GOOGLE_API_KEY)
            gemini_model = genai.GenerativeModel(GEMINI_MODEL_NAME)
    return gemini_model


def get_gemini_detect_model():
    """Return a cached Gemini 2.5 Flash model instance for detection, or None if not configured."""
    global gemini_detect_model
    if gemini_detect_model is None:
        return None
    if gemini_detect_model is not _UNSET:
        return gemini_detect_model
    if not GOOGLE_API_KEY:
        gemini_detect_model = None
        return None
    with _ai_init_lock:
        if gemini_detect_model is _UNSET:
            genai.configure(api_key=GOOGLE_API_KEY)
            gemini_detect_model = genai.GenerativeModel(GEMINI_DETECT_MODEL_NAME)
    return gemini_detect_model


def get_yolo_model():
    """Return a cached YOLOWorld model instance.

    If the weights file is missing, downloading is only attempted when
    `DJANGO_DOWNLOAD_YOLO_MODEL=1` is set in the environment.
    """
    global yolo_model
    if yolo_model is None:
        raise FileNotFoundError("YOLO model is disabled.")
    if yolo_model is not _UNSET:
        return yolo_model

    with _ai_init_lock:
        if yolo_model is not _UNSET:
            return yolo_model

        if not YOLO_MODEL_PATH.exists():
            if os.getenv('DJANGO_DOWNLOAD_YOLO_MODEL') == '1':
                import urllib.request

                yolo_download_url = 'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8l-worldv2.pt'
                print(f"YOLO model not found — downloading from {yolo_download_url} ...")
                urllib.request.urlretrieve(yolo_download_url, str(YOLO_MODEL_PATH))
                print("YOLO model downloaded.")
            else:
                raise FileNotFoundError(
                    f"YOLO model weights not found at '{YOLO_MODEL_PATH}'. "
                    "Provide the file or set DJANGO_DOWNLOAD_YOLO_MODEL=1 to allow downloading."
                )

        from ultralytics import YOLOWorld

        model = YOLOWorld(str(YOLO_MODEL_PATH))
        model.set_classes(YOLO_CLASSES)
        yolo_model = model

    return yolo_model

class DetectIngredientsView(APIView):
    """
    Detect food ingredients from an uploaded image.

    Uses YOLOWorld object detection to identify likely food regions, then
    passes cropped regions (or the full image as a fallback) to Google Gemini
    for ingredient identification.

    **Endpoint:** ``POST /api/detect-ingredients/``

    **Authentication:** Not required.

    **Request:** Multipart form-data with a single ``image`` field.

    **Response:**

    .. code-block:: json

        { "detected_ingredients": ["tomato", "onion", "carrot"] }
    """
    parser_classes = (MultiPartParser, FormParser)
    permission_classes = [AllowAny]
    throttle_classes = [AIAnonThrottle, AIUserThrottle]

    def post(self, request, *args, **kwargs):
        """
        Accept a multipart image upload and return a list of detected ingredients.

        The detection pipeline runs in two stages:

        1. **YOLO stage** – YOLOWorld scans the image for food containers/produce.
           Each detected bounding-box is cropped and forwarded to Gemini.
        2. **Gemini stage** – Google Gemini LLM analyses the image crops (or the
           full image when YOLO finds nothing) and returns a structured
           ``ingredients`` list.

        Args:
            request: DRF ``Request``. Must contain an ``image`` file in the
                multipart form data.

        Returns:
            200 OK: ``{"detected_ingredients": [str, ...]}``
            400 Bad Request: When no image is attached to the request.
            500 Internal Server Error: When Gemini is not configured or returns
                malformed JSON.
        """
        if 'image' not in request.FILES:
            return Response({"error": "No image provided"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            gemini_model = get_gemini_detect_model()
            if gemini_model is None:
                return Response(
                    {"error": "Server misconfigured: missing GOOGLE_API_KEY"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
            image_file = request.FILES['image']
            MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB
            if image_file.size > MAX_IMAGE_SIZE:
                return Response({"error": "Image too large. Maximum size is 10 MB."}, status=status.HTTP_400_BAD_REQUEST)
            original_img = Image.open(image_file).convert('RGB')

            try:
                yolo_model = get_yolo_model()
            except FileNotFoundError as e:
                return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # 1. Run YOLO
            img_w, img_h = original_img.size
            print(f"[YOLO] Running inference on image {img_w}x{img_h}px...")
            results = yolo_model.predict(original_img, conf=0.30, verbose=False)

            prompt_parts = []
            crops_found = False
            crop_index = 0

            # 2. Check for Detections
            if results[0].boxes and len(results[0].boxes) > 0:
                num_detections = len(results[0].boxes)
                print(f"[YOLO] {num_detections} detection(s) found — preparing crops...")

                # Sort boxes by confidence descending and cap at 15 to avoid quota spikes
                MAX_CROPS = 15
                boxes_sorted = sorted(results[0].boxes, key=lambda b: float(b.conf[0]), reverse=True)[:MAX_CROPS]

                # Base prompt for Hybrid Mode
                prompt_parts.append(
                    "You are an AI Chef. Identify the food ingredients in these cropped images. "
                    "Ignore non-food items. Return a JSON object with a single list called 'ingredients'."
                )
                prompt_parts.append(original_img)  # Context

                for i, box in enumerate(boxes_sorted):
                    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                    conf = float(box.conf[0])
                    cls_id = int(box.cls[0])
                    label = results[0].names.get(cls_id, f'class_{cls_id}') if hasattr(results[0], 'names') else f'class_{cls_id}'

                    # Safety check for crop boundaries
                    x1, y1 = max(0, x1), max(0, y1)
                    x2, y2 = min(img_w, x2), min(img_h, y2)

                    if x2 > x1 and y2 > y1:
                        crop_w, crop_h = x2 - x1, y2 - y1
                        print(f"[YOLO]   Crop {i+1}/{len(boxes_sorted)}: label='{label}' conf={conf:.2f} box=({x1},{y1},{x2},{y2}) size={crop_w}x{crop_h}px")
                        cropped = original_img.crop((x1, y1, x2, y2))
                        prompt_parts.append(cropped)
                        crops_found = True
                        crop_index += 1
                    else:
                        print(f"[YOLO]   Crop {i+1}/{len(boxes_sorted)}: SKIPPED (invalid bounds after clamp)")

                print(f"[YOLO] {crop_index} valid crop(s) sent to Gemini.")

            # 3. FALLBACK: If YOLO found nothing, force Full Image Scan
            if not crops_found:
                print("[YOLO] No valid detections — falling back to Full Image Scan.")
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
            print(f"[Gemini] Sending {len(prompt_parts) - 1} image(s) for ingredient identification...")
            response = gemini_model.generate_content(
                prompt_parts,
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json",
                    response_schema=json_schema
                )
            )

            # 6. Parse & Return
            print(f"[Gemini] Raw response: {response.text}")
            data = json.loads(response.text)
            ingredients = data.get("ingredients", [])
            print(f"[Gemini] Identified {len(ingredients)} ingredient(s): {', '.join(ingredients) if ingredients else 'none'}")
            
            return Response({"detected_ingredients": ingredients}, status=status.HTTP_200_OK)

        except google.api_core.exceptions.ResourceExhausted:
            return Response(
                {"error": "The AI service is temporarily over capacity. Please wait a moment and try again."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except Exception as e:
            print(f"Detection Error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class GenerateRecipeView(APIView):
    """
    Generate AI-crafted recipes from a list of available ingredients.

    Constructs a tailored prompt for Google Gemini incorporating the user's
    ingredients and personal preferences (cuisine, dietary restrictions,
    allergens, calorie goal, and cooking skill). If the user is authenticated,
    preferences stored in their :class:`~api.models.UserProfile` are merged
    automatically.

    **Endpoint:** ``POST /api/generate-recipe/``

    **Authentication:** Optional (enriches prompt with saved preferences when
    signed in).

    **Request body:**

    .. code-block:: json

        {
            "ingredients": ["chicken", "broccoli"],
            "count": 3,
            "preferences": {
                "cuisines": ["Italian"],
                "dietary": ["Gluten-Free"],
                "allergies": ["peanuts"],
                "calorieGoal": 2000,
                "cookingSkill": "Intermediate"
            }
        }

    **Response:**

    .. code-block:: json

        {
            "recipes": [
                {
                    "title": "...",
                    "description": "...",
                    "calories": 450,
                    "servings": 4,
                    "prep_time": "10 mins",
                    "cook_time": "25 mins",
                    "ingredients": ["..."],
                    "steps": ["..."]
                }
            ]
        }
    """
    parser_classes = (JSONParser,)
    permission_classes = [AllowAny]
    throttle_classes = [AIAnonThrottle, AIUserThrottle]

    def post(self, request, *args, **kwargs):
        """
        Generate between 1 and 5 distinct recipes based on provided ingredients.

        Args:
            request: DRF ``Request`` with a JSON body containing ``ingredients``
                (list of str), optional ``count`` (int, default 3), and optional
                ``preferences`` (dict).

        Returns:
            200 OK: ``{"recipes": [{...}, ...]}``
            500 Internal Server Error: Gemini unavailable or JSON parse failure.
            502 Bad Gateway: Gemini returned an empty recipes list.
        """
        ingredients = request.data.get('ingredients', [])
        if not isinstance(ingredients, list):
            return Response({'error': 'ingredients must be a list.'}, status=status.HTTP_400_BAD_REQUEST)
        ingredients_str = ", ".join(str(i) for i in ingredients) if ingredients else "nothing"
        try:
            count = min(max(int(request.data.get('count', 3)), 1), 5)
        except (ValueError, TypeError):
            return Response({'error': 'count must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)

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

        meal_type = preferences.get('mealType', '').strip().lower()
        if meal_type in ('breakfast', 'lunch', 'dinner'):
            pref_parts.append(f"Meal type: {meal_type} – ALL recipes must be suitable for {meal_type}")

        custom_text = preferences.get('customText', '').strip()
        if custom_text:
            pref_parts.append(f"Additional preferences: {custom_text}")

        pref_string = "\n".join(f"  - {p}" for p in pref_parts)

        try:
            gemini_model = get_gemini_model()
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
- Always provide BOTH prep_time and cook_time as non-empty strings (e.g. "10 mins", "25 mins"). If there is no distinct cooking step, set cook_time to "0 mins".
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
                            "required": ["title", "description", "calories", "servings", "prep_time", "cook_time", "ingredients", "steps"],
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
            recipes = data.get("recipes")
            if not isinstance(recipes, list) or len(recipes) == 0:
                return Response(
                    {"error": "Recipe generation returned no recipes. Please try again."},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            return Response(data, status=status.HTTP_200_OK)

        except google.api_core.exceptions.ResourceExhausted:
            return Response(
                {"error": "The AI service is temporarily over capacity. Please wait a moment and try again."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except Exception as e:
            print(f"Recipe Error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# --- AUTH VIEWS ---

class RegisterView(APIView):
    """
    Register a new user account.

    Creates the user record and immediately returns a JWT token pair so
    the client can authenticate without a separate login step.

    **Endpoint:** ``POST /api/auth/register/``

    **Authentication:** Not required.
    """
    permission_classes = [AllowAny]
    throttle_classes = [AuthRateThrottle]

    def post(self, request):
        """
        Create a new user and return JWT tokens.

        Args:
            request: DRF ``Request`` with ``email`` and ``password`` in the body.

        Returns:
            201 Created: ``{"access": str, "refresh": str, "email": str}``
            400 Bad Request: Validation errors (duplicate email, weak password).
        """
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
    """
    Authenticate an existing user and return a JWT token pair.

    **Endpoint:** ``POST /api/auth/login/``

    **Authentication:** Not required.
    """
    permission_classes = [AllowAny]
    throttle_classes = [AuthRateThrottle]

    def post(self, request):
        """
        Validate credentials and issue JWT tokens.

        Args:
            request: DRF ``Request`` with ``email`` and ``password`` in the body.

        Returns:
            200 OK: ``{"access": str, "refresh": str, "email": str}``
            401 Unauthorized: When credentials are invalid.
        """
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
    """
    Retrieve or update the authenticated user's preference profile.

    The profile drives AI prompt personalisation across recipe generation
    and meal planning.

    **Endpoint:** ``GET /api/profile/``  |  ``PUT /api/profile/``

    **Authentication:** Required.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """
        Return the current user's profile.

        Creates the profile with defaults if it does not yet exist.

        Returns:
            200 OK: Serialized :class:`~api.models.UserProfile`.
        """
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        return Response(UserProfileSerializer(profile).data)

    def put(self, request):
        """
        Partially update the current user's profile.

        Args:
            request: DRF ``Request``. Any subset of profile fields may be
                provided (partial update).

        Returns:
            200 OK: Updated serialized profile.
            400 Bad Request: Validation errors.
        """
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        serializer = UserProfileSerializer(profile, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ChangePasswordView(APIView):
    """
    Change the authenticated user's password.

    **Endpoint:** ``POST /api/auth/change-password/``

    **Authentication:** Required.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        """
        Verify the old password and set a new one.

        Args:
            request: DRF ``Request`` with ``old_password`` and ``new_password``
                in the body.

        Returns:
            200 OK: ``{"message": "Password changed successfully."}``
            400 Bad Request: Wrong current password or validation failure.
        """
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
    """
    Request a password reset code for a given email address.

    Always returns a success-like message to prevent email enumeration.
    In development the generated token is echoed in the response under
    ``dev_token``; in production this should be replaced with an email send.

    **Endpoint:** ``POST /api/auth/forgot-password/``

    **Authentication:** Not required.
    """
    permission_classes = [AllowAny]
    throttle_classes = [AuthRateThrottle]

    def post(self, request):
        """
        Generate a 6-digit reset token and associate it with the account.

        Args:
            request: DRF ``Request`` with ``email`` in the body.

        Returns:
            200 OK: ``{"message": "...", "dev_token": str}``
            400 Bad Request: When no email is provided.
        """
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

        # In development echo the token back so it appears on-screen.
        # In production (DEBUG=False) only print to console — replace with email send.
        print(f"[DEV] Password reset token for {email}: {token}")
        response_data = {'message': 'If that email is registered, a reset code has been sent.'}
        if settings.DEBUG:
            response_data['dev_token'] = token
        return Response(response_data)


class ResetPasswordView(APIView):
    """
    Reset a user's password using a time-limited 6-digit token.

    Tokens expire after 1 hour and are single-use.

    **Endpoint:** ``POST /api/auth/reset-password/``

    **Authentication:** Not required.
    """
    permission_classes = [AllowAny]
    throttle_classes = [AuthRateThrottle]

    def post(self, request):
        """
        Validate the reset token and apply the new password.

        Args:
            request: DRF ``Request`` with ``email``, ``token``, and
                ``new_password`` in the body.

        Returns:
            200 OK: ``{"message": "Password reset successfully."}``
            400 Bad Request: Missing fields, expired token, or weak password.
        """
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
    """
    List all saved recipes for the authenticated user, or save a new one.

    **Endpoint:** ``GET /api/recipes/``  |  ``POST /api/recipes/``

    **Authentication:** Required.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """
        Return all saved recipes belonging to the current user.

        Returns:
            200 OK: List of serialized :class:`~api.models.SavedRecipe` objects.
        """
        recipes = SavedRecipe.objects.filter(user=request.user)
        serializer = SavedRecipeSerializer(recipes, many=True)
        return Response(serializer.data)

    def post(self, request):
        """
        Save a new recipe for the current user.

        Args:
            request: DRF ``Request`` with ``title``, ``ingredients`` (list),
                and ``steps`` (list) in the body. ``calories`` is optional.

        Returns:
            201 Created: Serialized saved recipe.
            400 Bad Request: Validation errors.
        """
        serializer = SavedRecipeSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(user=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class SavedRecipeDetailView(APIView):
    """
    Delete a single saved recipe owned by the authenticated user.

    **Endpoint:** ``DELETE /api/recipes/<pk>/``

    **Authentication:** Required.
    """
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        """
        Permanently remove a saved recipe.

        Only the owning user can delete a recipe; other users' records are
        returned as 404 to avoid leaking existence information.

        Args:
            request: Authenticated DRF ``Request``.
            pk (int): Primary key of the :class:`~api.models.SavedRecipe`.

        Returns:
            204 No Content: Recipe deleted.
            404 Not Found: Recipe does not exist or belongs to another user.
        """
        try:
            recipe = SavedRecipe.objects.get(pk=pk, user=request.user)
            recipe.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except SavedRecipe.DoesNotExist:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)


# --- MEAL PLAN VIEWS ---

class GenerateMealPlanView(APIView):
    """
    Generate a complete AI-crafted multi-day meal plan and persist it.

    Builds a structured Gemini prompt from the user's profile preferences
    and requested duration, then persists the result as relational
    :class:`~api.models.MealPlan` / :class:`~api.models.MealPlanDay` /
    :class:`~api.models.MealPlanMeal` rows so individual meals can later
    be swapped or deleted.

    **Endpoint:** ``POST /api/meal-plans/generate/``

    **Authentication:** Required.

    **Request body:**

    .. code-block:: json

        {
            "duration_days": 5,
            "name": "Healthy Week"
        }

    **Response:** Full serialized :class:`~api.models.MealPlan` with nested
    days and meals.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            duration_days = min(max(int(request.data.get('duration_days', 3)), 1), 7)
        except (ValueError, TypeError):
            return Response({'error': 'duration_days must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)
        name = request.data.get('name', '').strip() or f'{duration_days}-Day Meal Plan'

        # Merge profile prefs with any overrides from the request
        preferences = {}
        try:
            profile = request.user.profile
            if profile.cuisine_preferences:
                preferences['cuisines'] = [p.strip() for p in profile.cuisine_preferences.split(',') if p.strip()]
            if profile.dietary_restrictions:
                preferences['dietary'] = [p.strip() for p in profile.dietary_restrictions.split(',') if p.strip()]
            if profile.allergies:
                preferences['allergies'] = [p.strip() for p in profile.allergies.split(',') if p.strip()]
            preferences['calorieGoal'] = profile.calorie_goal or 2000
            preferences['cookingSkill'] = profile.cooking_skill or 'Intermediate'
            preferences['customText'] = profile.custom_preferences or ''
        except UserProfile.DoesNotExist:
            preferences['calorieGoal'] = 2000

        req_prefs = request.data.get('preferences', {})
        if isinstance(req_prefs, dict):
            preferences.update({k: v for k, v in req_prefs.items() if v})

        calorie_goal = preferences.get('calorieGoal', 2000)
        breakfast_cal = int(calorie_goal * 0.25)
        lunch_cal     = int(calorie_goal * 0.35)
        dinner_cal    = int(calorie_goal * 0.40)

        pref_parts = []
        cuisines = preferences.get('cuisines', [])
        if cuisines:
            pref_parts.append(
                f"Cuisine style: {', '.join(cuisines)} "
                "(Irish market – use ingredients from Tesco Ireland, Dunnes Stores, SuperValu)"
            )
        else:
            pref_parts.append(
                "Cuisine style: Irish home cooking "
                "(use everyday Irish supermarket ingredients)"
            )

        dietary = [d for d in preferences.get('dietary', []) if d and d != 'No Restrictions']
        if dietary:
            pref_parts.append(f"Dietary requirements: {', '.join(dietary)}")

        allergies = [a for a in preferences.get('allergies', []) if a and a != 'None']
        if allergies:
            pref_parts.append(
                f"CRITICAL ALLERGEN WARNING – recipe MUST NOT contain: {', '.join(allergies)}. "
                "Double-check every ingredient for hidden allergen sources."
            )

        pref_parts.append(
            f"Daily calorie goal: {calorie_goal} kcal "
            f"(aim for ~{breakfast_cal} kcal breakfast, ~{lunch_cal} kcal lunch, ~{dinner_cal} kcal dinner)"
        )
        pref_parts.append(f"Cooking skill: {preferences.get('cookingSkill', 'Intermediate')}")

        custom = preferences.get('customText', '').strip()
        if custom:
            pref_parts.append(f"Additional preferences: {custom}")

        pref_string = "\n".join(f"  - {p}" for p in pref_parts)

        prompt = f"""You are an AI Chef for an Irish cooking app called Prep.
Generate a {duration_days}-day meal plan with breakfast, lunch, and dinner for each day.

User preferences:
{pref_string}

Rules:
- All ingredients must be readily available in Irish supermarkets (Tesco, Dunnes Stores, SuperValu).
- Breakfast should be quick (5-15 mins total).
- Lunch can be lighter and moderate effort.
- Dinner is the main meal of the day.
- STRICTLY follow all dietary requirements and allergen warnings – this is a food safety requirement.
- Vary meals across days – do not repeat the same meal more than once.
- Always provide BOTH prep_time and cook_time as non-empty strings (e.g. "5 mins", "10 mins"). If there is no distinct cooking step, set cook_time to "0 mins".
- Each meal needs a short one-sentence description.
- Estimate calories per serving as an integer.
- Assume basic pantry staples (oil, butter, salt, pepper, garlic, eggs) are available.
- Portions should suit an Irish household (serves 2-4)."""

        meal_schema = {
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
            "required": ["title", "description", "calories", "servings", "prep_time", "cook_time", "ingredients", "steps"],
        }

        plan_schema = {
            "type": "object",
            "properties": {
                "days": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "day_number": {"type": "integer"},
                            "breakfast":  meal_schema,
                            "lunch":      meal_schema,
                            "dinner":     meal_schema,
                        },
                        "required": ["day_number", "breakfast", "lunch", "dinner"],
                    },
                }
            },
            "required": ["days"],
        }

        try:
            gemini_model = get_gemini_model()
            if gemini_model is None:
                return Response(
                    {"error": "Server misconfigured: missing GOOGLE_API_KEY"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

            response = gemini_model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json",
                    response_schema=plan_schema,
                ),
            )

            data = json.loads(response.text)
            days_data = data.get('days', [])

            if not days_data:
                return Response(
                    {"error": "Meal plan generation returned no data. Please try again."},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            # Persist to DB
            meal_plan = MealPlan.objects.create(
                user=request.user,
                name=name,
                duration_days=duration_days,
            )

            for day_data in days_data:
                day = MealPlanDay.objects.create(
                    meal_plan=meal_plan,
                    day_number=day_data['day_number'],
                )
                for meal_type in ('breakfast', 'lunch', 'dinner'):
                    md = day_data.get(meal_type, {})
                    if md:
                        MealPlanMeal.objects.create(
                            day=day,
                            meal_type=meal_type,
                            title=md.get('title', ''),
                            description=md.get('description', ''),
                            calories=md.get('calories'),
                            servings=md.get('servings', 2),
                            prep_time=md.get('prep_time', ''),
                            cook_time=md.get('cook_time', ''),
                            ingredients=md.get('ingredients', []),
                            steps=md.get('steps', []),
                        )

            serializer = MealPlanSerializer(meal_plan)
            return Response(serializer.data, status=status.HTTP_201_CREATED)

        except Exception as e:
            print(f"Meal Plan Error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class MealPlanListView(APIView):
    """
    List all meal plans belonging to the authenticated user.

    **Endpoint:** ``GET /api/meal-plans/``

    **Authentication:** Required.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """
        Return all meal plans for the current user, with nested days and meals.

        Returns:
            200 OK: List of serialized :class:`~api.models.MealPlan` objects.
        """
        plans = MealPlan.objects.filter(user=request.user).prefetch_related('days__meals')
        return Response(MealPlanSerializer(plans, many=True).data)


class MealPlanDetailView(APIView):
    """
    Retrieve or delete a single meal plan.

    **Endpoint:** ``GET /api/meal-plans/<pk>/``  |  ``DELETE /api/meal-plans/<pk>/``

    **Authentication:** Required.
    """
    permission_classes = [IsAuthenticated]

    def _get_plan(self, pk, user):
        """
        Fetch a MealPlan by pk, scoped to the given user.

        Args:
            pk (int): Primary key of the :class:`~api.models.MealPlan`.
            user: The authenticated :class:`~api.models.User` instance.

        Returns:
            :class:`~api.models.MealPlan` or ``None`` if not found.
        """
        try:
            return MealPlan.objects.prefetch_related('days__meals').get(pk=pk, user=user)
        except MealPlan.DoesNotExist:
            return None

    def get(self, request, pk):
        """
        Return a single meal plan with all nested days and meals.

        Args:
            request: Authenticated DRF ``Request``.
            pk (int): Primary key of the meal plan.

        Returns:
            200 OK: Serialized :class:`~api.models.MealPlan`.
            404 Not Found: Plan not found or owned by another user.
        """
        plan = self._get_plan(pk, request.user)
        if plan is None:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(MealPlanSerializer(plan).data)

    def delete(self, request, pk):
        """
        Permanently delete a meal plan and all its nested days and meals.

        Args:
            request: Authenticated DRF ``Request``.
            pk (int): Primary key of the meal plan.

        Returns:
            204 No Content: Plan deleted.
            404 Not Found: Plan not found or owned by another user.
        """
        plan = self._get_plan(pk, request.user)
        if plan is None:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        plan.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MealPlanMealSwapView(APIView):
    """
    Swap a single meal slot within a meal plan.

    Replaces the content of one :class:`~api.models.MealPlanMeal` either
    with a user's existing saved recipe or with arbitrary new recipe data.

    **Endpoint:** ``PUT /api/meal-plans/meals/<pk>/swap/``

    **Authentication:** Required.
    """
    permission_classes = [IsAuthenticated]

    def put(self, request, pk):
        """
        Swap the meal slot identified by *pk*.

        Exactly one of ``saved_recipe_id`` or ``recipe_data`` must be
        provided in the request body.

        Args:
            request: Authenticated DRF ``Request`` with either:

                - ``saved_recipe_id`` (int): pk of a :class:`~api.models.SavedRecipe`
                  owned by the user, **or**
                - ``recipe_data`` (dict): ad-hoc recipe fields (title, calories,
                  ingredients, steps, etc.).

            pk (int): Primary key of the :class:`~api.models.MealPlanMeal` to replace.

        Returns:
            200 OK: Serialized updated :class:`~api.models.MealPlanMeal`.
            400 Bad Request: Neither ``saved_recipe_id`` nor ``recipe_data`` supplied.
            404 Not Found: Meal slot or saved recipe not found / not owned by user.
        """
        try:
            meal = MealPlanMeal.objects.select_related('day__meal_plan').get(pk=pk)
        except MealPlanMeal.DoesNotExist:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        if meal.day.meal_plan.user != request.user:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        saved_recipe_id = request.data.get('saved_recipe_id')
        recipe_data     = request.data.get('recipe_data')

        if saved_recipe_id:
            try:
                saved = SavedRecipe.objects.get(pk=saved_recipe_id, user=request.user)
                meal.title       = saved.title
                meal.description = ''
                meal.calories    = saved.calories
                meal.ingredients = [i.text for i in saved.ingredient_items.all().order_by('order')]
                meal.steps       = [s.text for s in saved.step_items.all().order_by('order')]
                meal.prep_time   = ''
                meal.cook_time   = ''
                meal.saved_recipe = saved
                meal.save()
            except SavedRecipe.DoesNotExist:
                return Response({'error': 'Saved recipe not found.'}, status=status.HTTP_404_NOT_FOUND)

        elif recipe_data and isinstance(recipe_data, dict):
            meal.title       = recipe_data.get('title', meal.title)
            meal.description = recipe_data.get('description', meal.description)
            meal.calories    = recipe_data.get('calories', meal.calories)
            meal.servings    = recipe_data.get('servings', meal.servings)
            meal.prep_time   = recipe_data.get('prep_time', meal.prep_time)
            meal.cook_time   = recipe_data.get('cook_time', meal.cook_time)
            meal.ingredients = recipe_data.get('ingredients', meal.ingredients)
            meal.steps       = recipe_data.get('steps', meal.steps)
            meal.saved_recipe = None
            meal.save()

        else:
            return Response(
                {'error': 'Provide either saved_recipe_id or recipe_data.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(MealPlanMealSerializer(meal).data)
