from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework import status

class ScanIngredientsView(APIView):
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, *args, **kwargs):
        # I access the image via request.FILES['image']
        # For the prototype, I assume the upload works and just return the mock data.
        
        mock_response = {
            "detected_ingredients": ["Tomato", "Egg", "Onion"],
            "recipe": {
                "title": "Simple Scrambled Eggs with Tomato",
                "ingredients": [
                    "2 Eggs",
                    "1 Tomato, diced",
                    "1/2 Onion, chopped",
                    "Salt and Pepper"
                ],
                "steps": [
                    "Crack eggs into a bowl and whisk.",
                    "Sauté onions and tomatoes in a pan.",
                    "Pour eggs into the pan and cook until fluffy.",
                    "Serve hot."
                ]
            }
        }
        
        return Response(mock_response, status=status.HTTP_200_OK)