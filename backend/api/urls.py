from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    DetectIngredientsView, GenerateRecipeView,
    RegisterView, LoginView,
    SavedRecipeListView, SavedRecipeDetailView,
)

urlpatterns = [
    # AI endpoints
    path('detect-ingredients/', DetectIngredientsView.as_view(), name='detect-ingredients'),
    path('generate-recipe/', GenerateRecipeView.as_view(), name='generate-recipe'),

    # Auth endpoints
    path('auth/register/', RegisterView.as_view(), name='register'),
    path('auth/login/', LoginView.as_view(), name='login'),
    path('auth/token/refresh/', TokenRefreshView.as_view(), name='token-refresh'),

    # Saved recipes
    path('recipes/', SavedRecipeListView.as_view(), name='saved-recipes'),
    path('recipes/<int:pk>/', SavedRecipeDetailView.as_view(), name='saved-recipe-detail'),
]