import io
import json
from unittest.mock import MagicMock, patch
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status
from PIL import Image
from django.test import TestCase
from django.db import IntegrityError

from .models import User, UserProfile, SavedRecipe, MealPlan

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


class GenerateRecipeViewTests(APITestCase):
    def setUp(self):
        self.url = reverse('generate-recipe')

    @patch('api.views.gemini_model')
    def test_generate_recipe_success(self, mock_gemini):
        """
        Test successful recipe generation.
        """
        # Mock Gemini response
        mock_recipe = {
            "title": "Tomato Soup",
            "ingredients": ["Tomato", "Water", "Salt"],
            "steps": ["Boil water", "Add tomato", "Serve"]
        }
        mock_gemini_response = MagicMock()
        mock_gemini_response.text = json.dumps(mock_recipe)
        mock_gemini.generate_content.return_value = mock_gemini_response

        data = {"ingredients": ["tomato"]}
        response = self.client.post(self.url, data, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['title'], mock_recipe['title'])
        self.assertEqual(response.data['ingredients'], mock_recipe['ingredients'])

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





def make_user(email='user@example.com', password='testpass123'):
    return User.objects.create_user(email=email, password=password)


SAMPLE_INGREDIENTS = [
    {'name': 'pasta', 'amount': '200g'},
    {'name': 'tomatoes', 'amount': '3'},
    {'name': 'olive oil', 'amount': '2 tbsp'},
]

SAMPLE_STEPS = [
    'Boil a large pot of salted water.',
    'Cook pasta until al dente.',
    'Fry tomatoes in olive oil for 5 minutes.',
    'Combine and serve.',
]

SAMPLE_PLAN_DATA = {
    'day_1': {
        'breakfast': {'title': 'Porridge', 'calories': 300},
        'lunch':     {'title': 'Caesar Salad', 'calories': 420},
        'dinner':    {'title': 'Grilled Chicken & Rice', 'calories': 650},
    },
    'day_2': {
        'breakfast': {'title': 'Scrambled Eggs', 'calories': 350},
        'lunch':     {'title': 'Tomato Soup', 'calories': 280},
        'dinner':    {'title': 'Beef Stir-fry', 'calories': 700},
    },
}


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


# SavedRecipe model tests

class SavedRecipeModelTest(TestCase):

    def setUp(self):
        self.user = make_user(email='recipe@example.com')
        self.recipe = SavedRecipe.objects.create(
            user=self.user,
            title='Pasta Primavera',
            ingredients=SAMPLE_INGREDIENTS,
            steps=SAMPLE_STEPS,
            calories=450,
        )

    def test_recipe_fields_stored_correctly(self):
        self.assertEqual(self.recipe.title, 'Pasta Primavera')
        self.assertEqual(self.recipe.calories, 450)

    def test_ingredients_are_json_list(self):
        self.assertIsInstance(self.recipe.ingredients, list)
        self.assertEqual(self.recipe.ingredients[0]['name'], 'pasta')

    def test_steps_are_json_list(self):
        self.assertIsInstance(self.recipe.steps, list)
        self.assertEqual(len(self.recipe.steps), 4)

    def test_created_at_auto_populated(self):
        self.assertIsNotNone(self.recipe.created_at)

    def test_many_to_one_relationship(self):
        self.assertEqual(self.recipe.user, self.user)
        self.assertEqual(self.user.saved_recipes.count(), 1)

    def test_multiple_recipes_per_user(self):
        SavedRecipe.objects.create(
            user=self.user, title='Omelette',
            ingredients=[{'name': 'eggs', 'amount': '3'}],
            steps=['Crack eggs', 'Fry'], calories=210,
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
            plan_data=SAMPLE_PLAN_DATA,
        )

    def test_meal_plan_fields_stored_correctly(self):
        self.assertEqual(self.meal_plan.duration_days, 7)

    def test_plan_data_is_dict(self):
        self.assertIsInstance(self.meal_plan.plan_data, dict)

    def test_plan_data_contains_expected_days(self):
        self.assertIn('day_1', self.meal_plan.plan_data)
        self.assertIn('day_2', self.meal_plan.plan_data)

    def test_plan_data_daily_structure(self):
        day = self.meal_plan.plan_data['day_1']
        self.assertIn('breakfast', day)
        self.assertIn('lunch', day)
        self.assertIn('dinner', day)

    def test_many_to_one_relationship(self):
        self.assertEqual(self.meal_plan.user, self.user)
        self.assertEqual(self.user.meal_plans.count(), 1)

    def test_multiple_meal_plans_per_user(self):
        MealPlan.objects.create(
            user=self.user, duration_days=3, plan_data={'day_1': {}}
        )
        self.assertEqual(self.user.meal_plans.count(), 2)

    def test_meal_plan_deleted_when_user_deleted(self):
        plan_id = self.meal_plan.pk
        self.user.delete()
        self.assertFalse(MealPlan.objects.filter(pk=plan_id).exists())

    def test_str_contains_email_and_duration(self):
        result = str(self.meal_plan)
        self.assertIn('mealplan@example.com', result)
        self.assertIn('7', result)
