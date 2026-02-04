import io
import json
from unittest.mock import MagicMock, patch
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status
from PIL import Image

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