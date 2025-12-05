from django.urls import path
from .views import DetectIngredientsView, GenerateRecipeView

urlpatterns = [
    # Endpoint 1: Detect ingredients from photo (YOLO + Gemini)
    path('detect-ingredients/', DetectIngredientsView.as_view(), name='detect-ingredients'),
    
    # Endpoint 2: Generate recipe from list (Gemini)
    path('generate-recipe/', GenerateRecipeView.as_view(), name='generate-recipe'),
]