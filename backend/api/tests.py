import io
import json
from unittest.mock import MagicMock, patch
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status
from PIL import Image
from django.test import TestCase
from django.db import IntegrityError

from .models import (
    User,
    UserProfile,
    SavedRecipe,
    RecipeIngredient,
    RecipeStep,
    MealPlan,
    MealPlanDay,
    MealPlanMeal,
)
from .serializers import UserProfileSerializer
from .serializers import RegisterSerializer, SavedRecipeSerializer

class DetectIngredientsViewTests(APITestCase):
    def setUp(self):
        self.url = reverse('detect-ingredients')
        
        # Create a dummy image for testing
        self.image_file = io.BytesIO()
        image = Image.new('RGB', (100, 100), color='red')
        image.save(self.image_file, format='JPEG')
        self.image_file.seek(0)
        
    @patch('api.views.yolo_model')
    @patch('api.views.gemini_model')
    def test_detect_ingredients_success_with_yolo(self, mock_gemini, mock_yolo):
        """
        Test successful ingredient detection when YOLO finds items.
        """
        # Mock YOLO results
        mock_result = MagicMock()
        # Mocking boxes: x1, y1, x2, y2
        mock_box = MagicMock()
        # box.xyxy[0].tolist() is called in the view. We need to mock the tensor behavior.
        mock_tensor = MagicMock()
        mock_tensor.tolist.return_value = [10, 10, 50, 50]
        mock_box.xyxy = [mock_tensor]
        mock_result.boxes = [mock_box]
        mock_yolo.predict.return_value = [mock_result]

        # Mock Gemini response
        mock_gemini_response = MagicMock()
        mock_gemini_response.text = json.dumps({"ingredients": ["tomato", "onion"]})
        mock_gemini.generate_content.return_value = mock_gemini_response

        # Make request
        self.image_file.name = 'test.jpg'
        data = {'image': self.image_file}
        response = self.client.post(self.url, data, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['detected_ingredients'], ["tomato", "onion"])
        
        # Verify YOLO was called
        mock_yolo.predict.assert_called_once()
        # Verify Gemini was called
        mock_gemini.generate_content.assert_called_once()

    @patch('api.views.yolo_model')
    @patch('api.views.gemini_model')
    def test_detect_ingredients_success_fallback(self, mock_gemini, mock_yolo):
        """
        Test successful ingredient detection when YOLO returns no boxes (Fallback to full image).
        """
        # Mock YOLO results (No boxes)
        mock_result = MagicMock()
        mock_result.boxes = []
        mock_yolo.predict.return_value = [mock_result]

        # Mock Gemini response
        mock_gemini_response = MagicMock()
        mock_gemini_response.text = json.dumps({"ingredients": ["apple"]})
        mock_gemini.generate_content.return_value = mock_gemini_response

        # Make request
        self.image_file.seek(0)
        self.image_file.name = 'test.jpg'
        data = {'image': self.image_file}
        response = self.client.post(self.url, data, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['detected_ingredients'], ["apple"])

    @patch('api.views.gemini_model')
    def test_detect_ingredients_no_image(self, mock_gemini):
        """
        Test failure when no image is provided.
        """
        response = self.client.post(self.url, {}, format='multipart')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("error", response.data)

    @patch('api.views.yolo_model')
    @patch('api.views.gemini_model')
    def test_detect_ingredients_gemini_error(self, mock_gemini, mock_yolo):
        """
        Test handling of Gemini API errors.
        """
        # Mock YOLO
        mock_result = MagicMock()
        mock_result.boxes = []
        mock_yolo.predict.return_value = [mock_result]

        # Mock Gemini raising exception
        mock_gemini.generate_content.side_effect = Exception("API Error")

        self.image_file.seek(0)
        self.image_file.name = 'test.jpg'
        data = {'image': self.image_file}
        response = self.client.post(self.url, data, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(response.data['error'], "API Error")

    @patch('api.views.gemini_model', None)
    def test_detect_ingredients_missing_api_key(self):
        """
        Test failure when Gemini model is not initialized (missing API Key).
        """
        self.image_file.seek(0)
        self.image_file.name = 'test.jpg'
        data = {'image': self.image_file}
        response = self.client.post(self.url, data, format='multipart')
        
        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertIn("Server misconfigured", response.data['error'])

    @patch('api.views.yolo_model')
    @patch('api.views.gemini_model')
    def test_detect_ingredients_empty_result_returns_empty_list(self, mock_gemini, mock_yolo):
        """
        State test: when Gemini returns an empty ingredients list, the response
        body should contain an empty list — not an error.
        """
        mock_result = MagicMock()
        mock_result.boxes = []
        mock_yolo.predict.return_value = [mock_result]

        mock_gemini_response = MagicMock()
        mock_gemini_response.text = json.dumps({"ingredients": []})
        mock_gemini.generate_content.return_value = mock_gemini_response

        self.image_file.seek(0)
        self.image_file.name = 'test.jpg'
        response = self.client.post(self.url, {'image': self.image_file}, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # State: view must still return the key with an empty list, not omit it
        self.assertIn('detected_ingredients', response.data)
        self.assertEqual(response.data['detected_ingredients'], [])

    @patch('api.views.yolo_model')
    @patch('api.views.gemini_model')
    def test_detect_ingredients_malformed_json_returns_500(self, mock_gemini, mock_yolo):
        """
        State test: when Gemini returns text that is not valid JSON, the view
        should catch the parse error and return 500, not crash unhandled.
        """
        mock_result = MagicMock()
        mock_result.boxes = []
        mock_yolo.predict.return_value = [mock_result]

        mock_gemini_response = MagicMock()
        mock_gemini_response.text = "this is not json"
        mock_gemini.generate_content.return_value = mock_gemini_response

        self.image_file.seek(0)
        self.image_file.name = 'test.jpg'
        response = self.client.post(self.url, {'image': self.image_file}, format='multipart')

        # State: a clean 500 with an error message — not an unhandled crash or 200
        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertIn('error', response.data)


class GenerateRecipeViewTests(APITestCase):
    def setUp(self):
        self.url = reverse('generate-recipe')

    @patch('api.views.gemini_model')
    def test_generate_recipe_success(self, mock_gemini):
        """
        Test successful recipe generation returns a 'recipes' list.
        """
        mock_recipes = {
            "recipes": [
                {
                    "title": "Tomato Soup",
                    "description": "A simple Irish tomato soup.",
                    "calories": 320,
                    "servings": 4,
                    "prep_time": "10 mins",
                    "cook_time": "20 mins",
                    "ingredients": ["Tomato", "Water", "Salt"],
                    "steps": ["Boil water", "Add tomato", "Serve"],
                }
            ]
        }
        mock_gemini_response = MagicMock()
        mock_gemini_response.text = json.dumps(mock_recipes)
        mock_gemini.generate_content.return_value = mock_gemini_response

        data = {"ingredients": ["tomato"]}
        response = self.client.post(self.url, data, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('recipes', response.data)
        self.assertEqual(response.data['recipes'][0]['title'], 'Tomato Soup')

    @patch('api.views.gemini_model')
    def test_generate_recipe_error(self, mock_gemini):
        """
        Test handling of Gemini API errors during recipe generation.
        """
        mock_gemini.generate_content.side_effect = Exception("Recipe Gen Error")

        data = {"ingredients": ["tomato"]}
        response = self.client.post(self.url, data, format='json')

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(response.data['error'], "Recipe Gen Error")

    @patch('api.views.gemini_model', None)
    def test_generate_recipe_missing_api_key(self):
        """
        Test failure when Gemini model is not initialized.
        """
        data = {"ingredients": ["tomato"]}
        response = self.client.post(self.url, data, format='json')

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertIn("Server misconfigured", response.data['error'])

    @patch('api.views.gemini_model')
    def test_generate_recipe_response_has_required_fields(self, mock_gemini):
        """
        State test: the response must contain a 'recipes' list where each item
        has title, ingredients, and steps.
        """
        mock_recipes = {
            "recipes": [
                {
                    "title": "Simple Omelette",
                    "ingredients": ["eggs", "butter", "salt"],
                    "steps": ["Beat eggs", "Melt butter", "Cook omelette"],
                }
            ]
        }
        mock_gemini_response = MagicMock()
        mock_gemini_response.text = json.dumps(mock_recipes)
        mock_gemini.generate_content.return_value = mock_gemini_response

        response = self.client.post(self.url, {"ingredients": ["eggs"]}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # State: top-level must have 'recipes' list
        self.assertIn('recipes', response.data)
        self.assertIsInstance(response.data['recipes'], list)
        self.assertGreater(len(response.data['recipes']), 0)
        # State: each recipe must have required fields
        recipe = response.data['recipes'][0]
        for field in ('title', 'ingredients', 'steps'):
            self.assertIn(field, recipe)
        self.assertIsInstance(recipe['title'], str)
        self.assertIsInstance(recipe['ingredients'], list)
        self.assertIsInstance(recipe['steps'], list)

    @patch('api.views.gemini_model')
    def test_generate_recipe_empty_ingredients_list_still_returns_recipe(self, mock_gemini):
        """
        State test: sending an empty ingredients list should not cause an error.
        """
        mock_recipes = {
            "recipes": [
                {
                    "title": "Pantry Pasta",
                    "ingredients": ["pasta", "olive oil", "garlic"],
                    "steps": ["Boil pasta", "Add oil and garlic", "Serve"],
                }
            ]
        }
        mock_gemini_response = MagicMock()
        mock_gemini_response.text = json.dumps(mock_recipes)
        mock_gemini.generate_content.return_value = mock_gemini_response

        response = self.client.post(self.url, {"ingredients": []}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('recipes', response.data)

    @patch('api.views.gemini_model')
    def test_generate_recipe_malformed_json_returns_500(self, mock_gemini):
        """
        State test: when Gemini returns non-JSON, the view should return 500.
        """
        mock_gemini_response = MagicMock()
        mock_gemini_response.text = "not valid json at all"
        mock_gemini.generate_content.return_value = mock_gemini_response

        response = self.client.post(self.url, {"ingredients": ["tomato"]}, format='json')

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertIn('error', response.data)

    @patch('api.views.gemini_model')
    def test_generate_recipe_with_preferences(self, mock_gemini):
        """
        State test: preferences are accepted and a valid response is returned.
        """
        mock_recipes = {
            "recipes": [
                {
                    "title": "Irish Stew",
                    "ingredients": ["lamb", "potato", "carrot"],
                    "steps": ["Brown lamb", "Add vegetables", "Simmer 1 hour"],
                }
            ]
        }
        mock_gemini_response = MagicMock()
        mock_gemini_response.text = json.dumps(mock_recipes)
        mock_gemini.generate_content.return_value = mock_gemini_response

        data = {
            "ingredients": ["lamb", "potato"],
            "preferences": {
                "cuisines": ["Irish Traditional"],
                "dietary": ["No Restrictions"],
                "allergies": ["None"],
                "calorieGoal": 2000,
                "cookingSkill": "Intermediate",
            },
            "count": 1,
        }
        response = self.client.post(self.url, data, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('recipes', response.data)
        # State: preferences were accepted and Gemini was called with a prompt
        mock_gemini.generate_content.assert_called_once()





def make_user(email='user@example.com', password='testpass123'):
    return User.objects.create_user(email=email, password=password)


SAMPLE_INGREDIENTS = [
    '200g pasta',
    '3 tomatoes',
    '2 tbsp olive oil',
]

SAMPLE_STEPS = [
    'Boil a large pot of salted water.',
    'Cook pasta until al dente.',
    'Fry tomatoes in olive oil for 5 minutes.',
    'Combine and serve.',
]

def make_saved_recipe(
    *,
    user,
    title='Recipe',
    ingredients=None,
    steps=None,
    calories=None,
):
    ingredients = ingredients if ingredients is not None else []
    steps = steps if steps is not None else []

    recipe = SavedRecipe.objects.create(user=user, title=title, calories=calories)

    RecipeIngredient.objects.bulk_create(
        [
            RecipeIngredient(recipe=recipe, order=i, text=text)
            for i, text in enumerate(ingredients, start=1)
        ]
    )
    RecipeStep.objects.bulk_create(
        [
            RecipeStep(recipe=recipe, order=i, text=text)
            for i, text in enumerate(steps, start=1)
        ]
    )
    return recipe


# User model tests

class UserModelTest(TestCase):

    def setUp(self):
        self.user = make_user()

    def test_user_created_with_email(self):
        self.assertEqual(self.user.email, 'user@example.com')

    def test_password_is_hashed(self):
        # Raw password must never be stored in plain text
        self.assertNotEqual(self.user.password, 'testpass123')
        self.assertTrue(self.user.check_password('testpass123'))

    def test_email_is_unique(self):
        with self.assertRaises(IntegrityError):
            make_user(email='user@example.com')

    def test_str_returns_email(self):
        self.assertEqual(str(self.user), 'user@example.com')

    def test_superuser_has_staff_flag(self):
        admin = User.objects.create_superuser(
            email='admin@example.com', password='adminpass'
        )
        self.assertTrue(admin.is_staff)
        self.assertTrue(admin.is_superuser)

    def test_create_user_without_email_raises(self):
        with self.assertRaises(ValueError):
            User.objects.create_user(email='', password='pass')


# UserProfile model tests

class UserProfileModelTest(TestCase):

    def setUp(self):
        self.user = make_user(email='profile@example.com')
        self.profile = UserProfile.objects.create(
            user=self.user,
            calorie_goal=1800,
            allergies='peanuts, shellfish',
            dietary_restrictions='Vegan',
            cuisine_preferences='Italian, Mexican',
        )

    def test_profile_fields_stored_correctly(self):
        self.assertEqual(self.profile.calorie_goal, 1800)
        self.assertEqual(self.profile.dietary_restrictions, 'Vegan')
        self.assertEqual(self.profile.allergies, 'peanuts, shellfish')
        self.assertEqual(self.profile.cuisine_preferences, 'Italian, Mexican')

    def test_one_to_one_relationship(self):
        # Forward access
        self.assertEqual(self.profile.user, self.user)
        # Reverse accessor
        self.assertEqual(self.user.profile, self.profile)

    def test_profile_deleted_when_user_deleted(self):
        profile_id = self.profile.pk
        self.user.delete()
        self.assertFalse(UserProfile.objects.filter(pk=profile_id).exists())

    def test_default_calorie_goal(self):
        user2 = make_user(email='defaults@example.com')
        profile2 = UserProfile.objects.create(user=user2)
        self.assertEqual(profile2.calorie_goal, 2000)

    def test_str_contains_email(self):
        self.assertIn('profile@example.com', str(self.profile))


class UserProfileSerializerTest(TestCase):

    def setUp(self):
        self.user = make_user(email='serializer@example.com')
        self.profile = UserProfile.objects.create(user=self.user)

    def test_duplicate_csv_values_are_normalized(self):
        serializer = UserProfileSerializer(
            self.profile,
            data={
                'allergies': 'Peanuts, peanuts, Shellfish, shellfish',
                'dietary_restrictions': 'Vegan, vegan, Halal',
                'cuisine_preferences': 'Italian, italian, Mexican',
            },
            partial=True,
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        profile = serializer.save()

        self.assertEqual(profile.allergies, 'Peanuts, Shellfish')
        self.assertEqual(profile.dietary_restrictions, 'Vegan, Halal')
        self.assertEqual(profile.cuisine_preferences, 'Italian, Mexican')


# SavedRecipe model tests

class SavedRecipeModelTest(TestCase):

    def setUp(self):
        self.user = make_user(email='recipe@example.com')
        self.recipe = make_saved_recipe(
            user=self.user,
            title='Pasta Primavera',
            ingredients=SAMPLE_INGREDIENTS,
            steps=SAMPLE_STEPS,
            calories=450,
        )

    def test_recipe_fields_stored_correctly(self):
        self.assertEqual(self.recipe.title, 'Pasta Primavera')
        self.assertEqual(self.recipe.calories, 450)

    def test_ingredients_are_stored_in_related_table(self):
        self.assertEqual(self.recipe.ingredient_items.count(), len(SAMPLE_INGREDIENTS))
        first = self.recipe.ingredient_items.order_by('order').first()
        self.assertIsNotNone(first)
        self.assertEqual(first.text, SAMPLE_INGREDIENTS[0])

    def test_steps_are_stored_in_related_table(self):
        self.assertEqual(self.recipe.step_items.count(), len(SAMPLE_STEPS))
        self.assertEqual(self.recipe.step_items.order_by('order').count(), 4)

    def test_created_at_auto_populated(self):
        self.assertIsNotNone(self.recipe.created_at)

    def test_many_to_one_relationship(self):
        self.assertEqual(self.recipe.user, self.user)
        self.assertEqual(self.user.saved_recipes.count(), 1)

    def test_multiple_recipes_per_user(self):
        make_saved_recipe(
            user=self.user,
            title='Omelette',
            ingredients=['3 eggs'],
            steps=['Crack eggs', 'Fry'],
            calories=210,
        )
        self.assertEqual(self.user.saved_recipes.count(), 2)

    def test_recipe_deleted_when_user_deleted(self):
        recipe_id = self.recipe.pk
        self.user.delete()
        self.assertFalse(SavedRecipe.objects.filter(pk=recipe_id).exists())

    def test_str_returns_title(self):
        self.assertEqual(str(self.recipe), 'Pasta Primavera')


# MealPlan model tests

class MealPlanModelTest(TestCase):

    def setUp(self):
        self.user = make_user(email='mealplan@example.com')
        self.meal_plan = MealPlan.objects.create(
            user=self.user,
            duration_days=7,
        )
        self.day_1 = MealPlanDay.objects.create(meal_plan=self.meal_plan, day_number=1)
        self.day_2 = MealPlanDay.objects.create(meal_plan=self.meal_plan, day_number=2)

        MealPlanMeal.objects.create(day=self.day_1, meal_type='breakfast', recipe_title='Porridge')
        MealPlanMeal.objects.create(day=self.day_1, meal_type='lunch', recipe_title='Caesar Salad')
        MealPlanMeal.objects.create(day=self.day_1, meal_type='dinner', recipe_title='Grilled Chicken & Rice')

        MealPlanMeal.objects.create(day=self.day_2, meal_type='breakfast', recipe_title='Scrambled Eggs')
        MealPlanMeal.objects.create(day=self.day_2, meal_type='lunch', recipe_title='Tomato Soup')
        MealPlanMeal.objects.create(day=self.day_2, meal_type='dinner', recipe_title='Beef Stir-fry')

    def test_meal_plan_fields_stored_correctly(self):
        self.assertEqual(self.meal_plan.duration_days, 7)

    def test_has_days(self):
        self.assertEqual(self.meal_plan.days.count(), 2)
        self.assertTrue(self.meal_plan.days.filter(day_number=1).exists())
        self.assertTrue(self.meal_plan.days.filter(day_number=2).exists())

    def test_days_have_expected_meals(self):
        day = self.meal_plan.days.get(day_number=1)
        meal_types = set(day.meals.values_list('meal_type', flat=True))
        self.assertEqual(meal_types, {'breakfast', 'lunch', 'dinner'})

    def test_day_number_unique_per_plan(self):
        with self.assertRaises(IntegrityError):
            MealPlanDay.objects.create(meal_plan=self.meal_plan, day_number=1)

    def test_many_to_one_relationship(self):
        self.assertEqual(self.meal_plan.user, self.user)
        self.assertEqual(self.user.meal_plans.count(), 1)

    def test_multiple_meal_plans_per_user(self):
        MealPlan.objects.create(user=self.user, duration_days=3)
        self.assertEqual(self.user.meal_plans.count(), 2)

    def test_meal_plan_deleted_when_user_deleted(self):
        plan_id = self.meal_plan.pk
        self.user.delete()
        self.assertFalse(MealPlan.objects.filter(pk=plan_id).exists())

    def test_str_contains_email_and_duration(self):
        result = str(self.meal_plan)
        self.assertIn('mealplan@example.com', result)
        self.assertIn('7', result)



# ADDITIONAL SIMPLE / STATE-BASED TESTS
# following Google's prefer state testing over interaction


class RegisterSerializerTests(TestCase):
    """State-based unit tests for RegisterSerializer."""

    def test_valid_data_creates_user_in_db(self):
        data = {'email': 'serial_new@example.com', 'password': 'securepass'}
        serializer = RegisterSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        user = serializer.save()
        # State: the user actually exists in the DB with the right email
        self.assertTrue(User.objects.filter(email='serial_new@example.com').exists())
        # State: the password is hashed, not stored in plain text
        self.assertTrue(user.check_password('securepass'))

    def test_password_too_short_is_invalid(self):
        data = {'email': 'short@example.com', 'password': 'abc'}
        serializer = RegisterSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('password', serializer.errors)

    def test_missing_email_is_invalid(self):
        data = {'password': 'validpassword'}
        serializer = RegisterSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('email', serializer.errors)

    def test_invalid_email_format_is_invalid(self):
        data = {'email': 'not-an-email', 'password': 'validpassword'}
        serializer = RegisterSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('email', serializer.errors)


class SavedRecipeSerializerTests(TestCase):
    """State-based unit tests for SavedRecipeSerializer."""

    def setUp(self):
        self.user = make_user(email='serial_recipe@example.com')

    def test_valid_data_is_valid(self):
        data = {
            'title': 'Test Recipe',
            'ingredients': SAMPLE_INGREDIENTS,
            'steps': SAMPLE_STEPS,
            'calories': 400,
        }
        serializer = SavedRecipeSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_output_contains_expected_fields(self):
        recipe = make_saved_recipe(
            user=self.user,
            title='Check Fields',
            ingredients=SAMPLE_INGREDIENTS,
            steps=SAMPLE_STEPS,
            calories=400,
        )
        data = SavedRecipeSerializer(recipe).data
        for field in ('id', 'title', 'ingredients', 'steps', 'calories', 'created_at'):
            self.assertIn(field, data)
        # State: serialized title matches what was saved
        self.assertEqual(data['title'], 'Check Fields')
        self.assertIsInstance(data['ingredients'], list)
        self.assertIsInstance(data['steps'], list)

    def test_id_and_created_at_are_read_only(self):
        # Providing these fields in input should not cause validation errors,
        # but the serializer must not honour them as writable.
        recipe = make_saved_recipe(
            user=self.user,
            title='Read Only Check',
            ingredients=SAMPLE_INGREDIENTS,
            steps=SAMPLE_STEPS,
        )
        original_id = recipe.pk
        data = {
            'id': 9999,
            'title': 'Read Only Check',
            'ingredients': SAMPLE_INGREDIENTS,
            'steps': SAMPLE_STEPS,
        }
        serializer = SavedRecipeSerializer(recipe, data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        updated = serializer.save()
        # State: id must not have been changed to the supplied value
        self.assertEqual(updated.pk, original_id)

    def test_missing_title_is_invalid(self):
        data = {'ingredients': SAMPLE_INGREDIENTS, 'steps': SAMPLE_STEPS}
        serializer = SavedRecipeSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('title', serializer.errors)

    def test_calories_is_optional(self):
        data = {
            'title': 'No Calorie Recipe',
            'ingredients': SAMPLE_INGREDIENTS,
            'steps': SAMPLE_STEPS,
        }
        serializer = SavedRecipeSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)


class RegisterEndpointTests(APITestCase):
    """
    State-based tests for POST /api/auth/register/.
    Verify DB state and response body rather than mock interactions.
    """

    def setUp(self):
        self.url = reverse('register')

    def test_register_creates_user_in_db(self):
        data = {'email': 'reg_new@example.com', 'password': 'password123'}
        response = self.client.post(self.url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # State: user genuinely exists in the database
        self.assertTrue(User.objects.filter(email='reg_new@example.com').exists())

    def test_register_returns_tokens_and_email(self):
        data = {'email': 'reg_token@example.com', 'password': 'password123'}
        response = self.client.post(self.url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)
        self.assertEqual(response.data['email'], 'reg_token@example.com')

    def test_duplicate_email_returns_400_and_no_extra_user_created(self):
        make_user(email='reg_dup@example.com')
        data = {'email': 'reg_dup@example.com', 'password': 'password123'}
        response = self.client.post(self.url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        # State: still exactly one user with that email
        self.assertEqual(User.objects.filter(email='reg_dup@example.com').count(), 1)

    def test_short_password_returns_400_and_no_user_created(self):
        data = {'email': 'reg_weak@example.com', 'password': 'abc'}
        response = self.client.post(self.url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        # State: no user was created in the DB
        self.assertFalse(User.objects.filter(email='reg_weak@example.com').exists())


class LoginEndpointTests(APITestCase):
    """
    State-based tests for POST /api/auth/login/.
    """

    def setUp(self):
        self.url = reverse('login')
        self.user = make_user(email='login_test@example.com', password='correctpass')

    def test_valid_credentials_return_tokens_and_email(self):
        data = {'email': 'login_test@example.com', 'password': 'correctpass'}
        response = self.client.post(self.url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)
        self.assertEqual(response.data['email'], 'login_test@example.com')

    def test_wrong_password_returns_401(self):
        data = {'email': 'login_test@example.com', 'password': 'wrongpass'}
        response = self.client.post(self.url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_unknown_email_returns_401(self):
        data = {'email': 'nobody@example.com', 'password': 'anypass'}
        response = self.client.post(self.url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class SavedRecipeAPITests(APITestCase):
    """
    State-based API tests for /api/recipes/ and /api/recipes/<pk>/.
    No mocks: every assertion checks real HTTP responses and real DB state.
    """

    def setUp(self):
        self.list_url = reverse('saved-recipes')
        self.user = make_user(email='api_recipes@example.com')
        self.other_user = make_user(email='api_other@example.com')

    def _auth(self, user=None):
        """Authenticate the test client as the given user (default: self.user)."""
        self.client.force_authenticate(user=user or self.user)

    # --- Access control ---

    def test_unauthenticated_get_returns_401(self):
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_unauthenticated_post_returns_401(self):
        data = {'title': 'T', 'ingredients': [], 'steps': []}
        response = self.client.post(self.list_url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    # --- GET list ---

    def test_authenticated_get_empty_list_returns_200(self):
        self._auth()
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_get_returns_only_own_recipes(self):
        self._auth()
        make_saved_recipe(
            user=self.user,
            title='Mine',
            ingredients=SAMPLE_INGREDIENTS,
            steps=SAMPLE_STEPS,
            calories=400,
        )
        make_saved_recipe(
            user=self.other_user,
            title='Theirs',
            ingredients=SAMPLE_INGREDIENTS,
            steps=SAMPLE_STEPS,
            calories=400,
        )
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = [r['title'] for r in response.data]
        # State: own recipe present, other user's recipe absent
        self.assertIn('Mine', titles)
        self.assertNotIn('Theirs', titles)

    # --- POST ---

    def test_post_recipe_returns_201_and_creates_db_record(self):
        self._auth()
        data = {
            'title': 'API Recipe',
            'ingredients': SAMPLE_INGREDIENTS,
            'steps': SAMPLE_STEPS,
            'calories': 500,
        }
        response = self.client.post(self.list_url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # State: record actually landed in the DB owned by the right user
        self.assertEqual(
            SavedRecipe.objects.filter(user=self.user, title='API Recipe').count(), 1
        )

    def test_post_recipe_appears_in_subsequent_get(self):
        self._auth()
        make_saved_recipe(
            user=self.user,
            title='Persistent Recipe',
            ingredients=SAMPLE_INGREDIENTS,
            steps=SAMPLE_STEPS,
            calories=600,
        )
        response = self.client.get(self.list_url)
        titles = [r['title'] for r in response.data]
        self.assertIn('Persistent Recipe', titles)

    def test_post_missing_title_returns_400(self):
        self._auth()
        data = {'ingredients': SAMPLE_INGREDIENTS, 'steps': SAMPLE_STEPS}
        response = self.client.post(self.list_url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('title', response.data)

    # --- DELETE ---

    def test_delete_removes_recipe_from_db(self):
        self._auth()
        recipe = make_saved_recipe(
            user=self.user,
            title='To Delete',
            ingredients=SAMPLE_INGREDIENTS,
            steps=SAMPLE_STEPS,
            calories=300,
        )
        detail_url = reverse('saved-recipe-detail', kwargs={'pk': recipe.pk})
        response = self.client.delete(detail_url)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        # State: record is actually gone from the DB
        self.assertFalse(SavedRecipe.objects.filter(pk=recipe.pk).exists())

    def test_delete_other_users_recipe_returns_404_and_leaves_record_intact(self):
        self._auth()
        recipe = make_saved_recipe(
            user=self.other_user,
            title='Not Mine',
            ingredients=SAMPLE_INGREDIENTS,
            steps=SAMPLE_STEPS,
            calories=300,
        )
        detail_url = reverse('saved-recipe-detail', kwargs={'pk': recipe.pk})
        response = self.client.delete(detail_url)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        # State: the record still exists — it must not have been deleted
        self.assertTrue(SavedRecipe.objects.filter(pk=recipe.pk).exists())

    def test_delete_nonexistent_recipe_returns_404(self):
        self._auth()
        detail_url = reverse('saved-recipe-detail', kwargs={'pk': 99999})
        response = self.client.delete(detail_url)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
